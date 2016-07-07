// Copyright (c) Microsoft Corporation. All rights reserved.

var Q = require('q'),
    fs = require('fs'),
    path = require('path'),
    log = require('./utils/log'),
    dirs = require('./dirs'),
    utils = require('./utils/jsUtils'),
    Configuration = require('./config'),
    Project = require('./project'),
    SimulationServer = require('./server'),
    Telemetry = require('./telemetry');

/**
 * @param {object} opts Configuration for the current simulation.
 * @constructor
 */
function Simulator(opts) {
    opts = opts || {};

    this._config = parseOptions(opts);
    this._opts = { port: opts.port, dir: opts.dir };
    this._state = Simulator.State.IDLE;

    this.hostRoot = {
        'app-host':  path.join(dirs.root, 'app-host')
    };

    var that = this;
    Object.defineProperty(this.hostRoot, 'sim-host', {
        get: function () {
            // Get dynamically so simHostOptions is initialized
            return that._config.simHostOptions.simHostRoot;
        }
    });

    var platform = opts.platform || 'browser';

    var telemetry = new Telemetry(this, this._config.telemetry);

    // create an intermediate object that expose only the
    // required public API for the simulation objects
    var simulatorProxy = {
        config: this.config,
        telemetry: telemetry
    };

    this._project = new Project(simulatorProxy, platform);
    this._server = new SimulationServer(simulatorProxy, this._project, this.hostRoot);
}

Object.defineProperties(Simulator.prototype, {
    'project': {
        get: function () {
            return this._project;
        }
    },
    'config': {
        get: function () {
            return this._config;
        }
    }
});

Simulator.State = {
    IDLE: 'IDLE',
    STARTING: 'STARTING',
    RUNNING: 'RUNNING',
    STOPPING: 'STOPPING'
};

/**
 * Check if the simulation is any active state.
 * @return {boolean} True if it is active, otherwise false.
 */
Simulator.prototype.isActive = function () {
    return this._state !== Simulator.State.IDLE;
};

/**
 * Check if the simulation is not active.
 * @return {boolean} True if it is not active, otherwise false.
 */
Simulator.prototype.isIdle = function () {
    return this._state === Simulator.State.IDLE;
};

/**
 * @return {string|null}
 */
Simulator.prototype.urlRoot = function () {
    var urls = this._server.urls;

    return urls ? urls.root : null;
};

/**
 * @return {string|null}
 */
Simulator.prototype.appUrl = function () {
    var urls = this._server.urls;

    return urls ? urls.app : null;
};

/**
 * @return {string|null}
 */
Simulator.prototype.simHostUrl = function () {
    var urls = this._server.urls;

    return urls ? urls.simHost : null;
};

/**
 * Start the simulation for the current project with the provided information at the
 * time of creating the instance.
 * @param {object} opts Optional configuration, such as port number, dir and simulation path.
 * @return {Promise} A promise that is fullfilled when the simulation starts and the server
 * is ready listeninig for new connections. If something fails, it is rejected.
 */
Simulator.prototype.startSimulation = function () {
    if (this.isActive()) {
        return Q.reject('Simulation is active');
    }

    this._state = Simulator.State.STARTING;

    return this._server.start(this._project.platform, this._opts)
        .then(function (data) {
            // configure project
            this._project.projectRoot = data.projectRoot;
            this._project.platformRoot = data.root;

            // configure simulation file path
            var simPath = this._config.simulationFilePath || path.join(this._project.projectRoot, 'simulation'),
                simulationFilePath = path.resolve(simPath);

            this._config.simulationFilePath = simulationFilePath;

            if (!fs.existsSync(simulationFilePath)) {
                utils.makeDirectoryRecursiveSync(simulationFilePath);
            }

            this._state = Simulator.State.RUNNING;
        }.bind(this))
        .fail(function (error) {
            log.warning('Error starting the simulation');
            log.error(error);

            this._state = Simulator.State.IDLE;
        }.bind(this));
};

/**
 * Stops the current simulation if any.
 * @return {Promise} A promise that is fullfilled when the simulation stops and the server
 * release the current connections. If something fails, it is rejected.
 */
Simulator.prototype.stopSimulation = function () {
    if (!this.isActive()) {
        return Q.reject('Simulation is not active');
    }

    this._state = Simulator.State.STOPPING;

    return this._server.stop()
        .then(function () {
            this._project.reset();
            this._state = Simulator.State.IDLE;
        }.bind(this));
};

/**
 * Parse the options provided and create the configuration instance for the current
 * simulation.
 * @param {object} opts Configuration provided for the simulator.
 * @return {Configuration} A configuration instance.
 * @private
 */
function parseOptions(opts) {
    opts = opts || {};

    var simHostOpts,
        config = new Configuration();

    if (opts.simhostui && fs.existsSync(opts.simhostui)) {
        simHostOpts = { simHostRoot: opts.simhostui };
    } else {
        /* use the default simulation UI */
        simHostOpts = { simHostRoot: path.join(__dirname, '..', 'sim-host', 'ui') };
    }

    config.simHostOptions = simHostOpts;
    config.simulationFilePath = opts.simulationpath;
    config.telemetry = opts.telemetry;
    config.liveReload = opts.hasOwnProperty('livereload') ? !!opts.livereload : true;
    config.forcePrepare = !!opts.forceprepare;
    config.xhrProxy = opts.hasOwnProperty('corsproxy') ? !!opts.corsproxy : true;
    config.touchEvents = opts.hasOwnProperty('touchevents') ? !!opts.touchevents : true;

    return config;
}

module.exports = Simulator;
