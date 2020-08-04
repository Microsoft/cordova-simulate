// Copyright (c) Microsoft Corporation. All rights reserved.

var Q = require('q'),
    log = require('./utils/log'),
    LiveReload = require('./live-reload/live-reload'),
    simulateGapPlugins = require('./node-plugins');

// make variable match the literal
var APP_HOST = 'APP_HOST',
    SIM_HOST = 'SIM_HOST',
    DEBUG_HOST = 'DEBUG_HOST';

/**
 * It creates a Web Socket server to enable RPC communication between simulation hosts
 * running in different process. This object implements the server part of the communication
 * protocol as described at
    https://github.com/Microsoft/cordova-simulate/wiki/The-cordova-simulate-bootstrap-protocol
 * with a limitation that only single app-host is supported per server (and sim-host).
 * @param {object} simulatorProxy
 * @param {object} project
 * @constructor
 */
function SocketServer(simulatorProxy, project) {
    this._simulatorProxy = simulatorProxy;
    this._io;
    this._hostSockets = {};
    this._pendingEmits = {};
    this._pendingEmits[APP_HOST] = [];
    this._pendingEmits[SIM_HOST] = [];
    this._pendingEmits[DEBUG_HOST] = [];

    /* Deferred are used to delay the actions until an event happens.
     * Two major events are kept track of:
     *      - When app-host connects (sends initial message)
     *      - When sim-host notifies it's ready to serve an app-host.
     */
    this._whenAppHostConnected = Q.defer();
    this._whenSimHostReady     = Q.defer();

    var config = this._simulatorProxy.config,
        telemetry = this._simulatorProxy.telemetry;

    this._liveReload = new LiveReload(project, telemetry, config.forcePrepare);
}

SocketServer.prototype.init = function (server) {
    var that = this,
        config = this._simulatorProxy.config;

    this._io = require('socket.io')(server);

    this._io.on('connection', function (socket) {
        // Debug messages can be sent to the external debug-host before the app and the simulator are fully ready (for
        // example, during a plugin initialization). For that reason, the debug-message handler should be subscribed to
        // immediately, regardless of which socket type has just connected.
        socket.on('debug-message', function (data) {
            that._emitTo(DEBUG_HOST, data.message, data.data);
        });

        socket.on('register-app-host', function () {
            log.log('APP_HOST connected to the server');
            if (that._hostSockets[APP_HOST]) {
                log.log('Overriding previously connected APP_HOST');
                that._resetAppHostState();
            }
            that._hostSockets[APP_HOST] = socket;
            that._whenSimHostReady.promise
                .then(that._onSimHostReady.bind(that));
            that._whenAppHostConnected.resolve();
        });

        socket.on('register-simulation-host', function () {
            log.log('SIM_HOST connected to the server');
            if (that._hostSockets[SIM_HOST]) {
                log.log('Overriding previously connected SIM_HOST');
                that._resetSimHostState();
            }
            that._hostSockets[SIM_HOST] = socket;
            that._handleSimHostRegistration(socket);
        });

        socket.on('register-debug-host', function (data) {
            log.log('DEBUG_HOST registered with server.');

            // It only makes sense to have one debug host per server. If more than one tries to connect, always take
            // the most recent.
            that._hostSockets[DEBUG_HOST] = socket;

            if (data && data.handlers) {
                config.debugHostHandlers = data.handlers;
            }

            that._handlePendingEmits(DEBUG_HOST);
        });

        socket.on('disconnect', function () {
            var type;
            Object.keys(that._hostSockets).forEach(function (t) {
                if (that._hostSockets[t] === socket) {
                    type = t;
                }
            });
            if (!type) {
                log.log('Disconnect for an inactive socket');
                return;
            }
            that._hostSockets[type] = undefined;
            log.log(type + ' disconnected from the server');
            switch (type) {
                case APP_HOST:
                    that._resetAppHostState();
                    break;
                case SIM_HOST:
                    that._resetSimHostState();
                    break;
                case DEBUG_HOST:
                    config.debugHostHandlers = null;
                    break;
            }
        });
    });
};

SocketServer.prototype.reloadSimHost = function () {
    this._emitTo(SIM_HOST, 'refresh');
};

SocketServer.prototype.rethemeSimHost = function () {
    this._emitTo(SIM_HOST, 'retheme');
};

SocketServer.prototype.closeConnections = function () {
    // stop watching file changes
    if (this._simulatorProxy.config.liveReload) {
        this._liveReload.stop();
    }

    Object.keys(this._hostSockets).forEach(function (hostType) {
        var socket = this._hostSockets[hostType];
        if (socket) {
            socket.disconnect(true);
        }
    }.bind(this));

    // not need to close the server, since it is closed
    // by the SimulationServer instance
    this._io = null;
    this._hostSockets = {};
    this._pendingEmits = {};
    this._pendingEmits[APP_HOST] = [];
    this._pendingEmits[SIM_HOST] = [];
    this._pendingEmits[DEBUG_HOST] = [];
    this._whenAppHostConnected = Q.defer();
    this._whenSimHostReady = Q.defer();
};

SocketServer.prototype._resetAppHostState = function () {
    this._whenAppHostConnected = Q.defer();
    this._whenAppHostConnected.promise
        .then(this._onAppHostConnected.bind(this));
};

SocketServer.prototype._resetSimHostState = function () {
    this._whenSimHostReady = Q.defer();
    this._whenSimHostReady.promise
        .then(this._onSimHostReady.bind(this));
};

SocketServer.prototype._setupAppHostHandlers = function () {
    log.log('Setup handlers for APP_HOST');

    var config = this._simulatorProxy.config;

    this._subscribeTo(APP_HOST, 'exec', function (data) {
        //checks node plugins to see if there is a handler available. If not the exec is sent to the sim-host.
        try {
            // The individual plugin is given the nodePlugin object to allow plugins to call each other
            simulateGapPlugins[data.service][data.action](
                function(result) {
                    this._emitTo(APP_HOST, 'exec-success', {index: data.index, result: result});
                }.bind(this), 
                function(result) {
                    this._emitTo(APP_HOST, 'exec-failure', {index: data.index, result: result});
                }.bind(this),
                data.args, simulateGapPlugins);
        } catch(e) {
            this._emitTo(SIM_HOST, 'exec', data);
        }
    }.bind(this));

    this._subscribeTo(APP_HOST, 'plugin-message', function (data) {
        this._emitTo(SIM_HOST, 'plugin-message', data);
    }.bind(this));

    this._subscribeTo(APP_HOST, 'plugin-method', function (data, callback) {
        this._emitTo(SIM_HOST, 'plugin-method', data, callback);
    }.bind(this));

    // Set up live reload if necessary.
    if (config.liveReload) {
        log.log('Starting live reload.');
        this._liveReload.start(this._hostSockets[APP_HOST]);
    }

    // Set up telemetry if necessary.
    if (config.telemetry) {
        this._subscribeTo(APP_HOST, 'telemetry', function (data) {
            this._simulatorProxy.telemetry.handleClientTelemetry(data);
        }.bind(this));

        this._emitTo(APP_HOST, 'init-telemetry');
    }

    // Set up xhr proxy
    if (config.xhrProxy) {
        this._emitTo(APP_HOST, 'init-xhr-proxy');
    }

    // setup touch events support
    if (config.touchEvents) {
        this._emitTo(APP_HOST, 'init-touch-events');
    }

    this._handlePendingEmits(APP_HOST);
};

SocketServer.prototype._handleSimHostRegistration = function () {
    this._subscribeTo(SIM_HOST, 'ready', this._handleSimHostReady.bind(this), true);

    this._emitTo(SIM_HOST, 'init', this._simulatorProxy.config.deviceInfo);
};

SocketServer.prototype._onAppHostConnected = function () {
    this._whenSimHostReady.promise
        .then(function () {
            this._subscribeTo(APP_HOST, 'app-plugin-list', this._handleAppPluginList.bind(this), true);
            this._emitTo(APP_HOST, 'init');
        }.bind(this));
};

SocketServer.prototype._onSimHostReady = function () {
    this._setupAppHostHandlers();
};

SocketServer.prototype._handleSimHostReady = function () {
    // Resolve the deferred
    this._whenSimHostReady.resolve();

    this._setupSimHostHandlers();

    this._whenAppHostConnected.promise
        .then(this._onAppHostConnected.bind(this));
};

SocketServer.prototype._handleAppPluginList = function (data) {
    this._whenSimHostReady.promise
        .then(function () {
            this._subscribeTo(SIM_HOST, 'start', this._handleStart.bind(this), true);
            this._emitTo(SIM_HOST, 'app-plugin-list', data);
        }.bind(this));
};

SocketServer.prototype._handleStart = function () {
    this._emitTo(APP_HOST, 'start');
};

SocketServer.prototype._setupSimHostHandlers = function () {
    log.log('Setup handlers for SIM_HOST');

    this._subscribeTo(SIM_HOST, 'exec-success', function (data) {
        this._emitTo(APP_HOST, 'exec-success', data);
    }.bind(this));

    this._subscribeTo(SIM_HOST, 'exec-failure', function (data) {
        this._emitTo(APP_HOST, 'exec-failure', data);
    }.bind(this));

    this._subscribeTo(SIM_HOST, 'plugin-message', function (data) {
        this._emitTo(APP_HOST, 'plugin-message', data);
    }.bind(this));

    this._subscribeTo(SIM_HOST, 'plugin-method', function (data, callback) {
        this._emitTo(APP_HOST, 'plugin-method', data, callback);
    }.bind(this));

    this._subscribeTo(SIM_HOST, 'refresh-app-host', function (device) {
        this._simulatorProxy.updateDevice(device);
        this._emitTo(APP_HOST, 'refresh');
    }.bind(this));

    // Set up telemetry if necessary.
    if (this._simulatorProxy.config.telemetry) {
        this._subscribeTo(SIM_HOST, 'telemetry', function (data) {
            this._simulatorProxy.telemetry.handleClientTelemetry(data);
        }.bind(this));

        this._emitTo(SIM_HOST, 'init-telemetry');
    }

    this._handlePendingEmits(SIM_HOST);
};

/**
 * @private
 */
SocketServer.prototype._handlePendingEmits = function (host) {
    log.log('Handling pending emits for ' + host);
    this._pendingEmits[host].forEach(function (pendingEmit) {
        this._emitTo(host, pendingEmit.msg, pendingEmit.data, pendingEmit.callback);
    }.bind(this));
    this._pendingEmits[host] = [];
};

/**
 * @private
 */
SocketServer.prototype._emitTo = function (host, msg, data, callback) {
    var socket = this._hostSockets[host];
    if (socket) {
        log.log('Emitting \'' + msg + '\' to ' + host);
        socket.emit(msg, data, callback);
    } else {
        log.log('Emitting \'' + msg + '\' to ' + host + ' (pending connection)');
        this._pendingEmits[host].push({ msg: msg, data: data, callback: callback });
    }
};

/**
 * @private
 */
SocketServer.prototype._subscribeTo = function (host, msg, handler, once) {
    var socket = this._hostSockets[host],
        method = once ? 'once' : 'on';
    if (socket) {
        socket.removeListener(msg, handler);
        socket[method](msg, handler);
    } else {
        log.log('Subscribing to a disconnected ' + host + ' wanting \'' + msg + '\'');
    }
};

module.exports = SocketServer;
