// Copyright (c) Microsoft Corporation. All rights reserved.

var fs = require('fs'),
    path = require('path'),
    replaceStream = require('replacestream'),
    cordovaServe = require('cordova-serve'),
    cspParse = require('csp-parse'),
    send = require('send-transform'),
    url = require('url'),
    Q = require('q'),
    dirs = require('./dirs'),
    log = require('./utils/log'),
    SimulationFiles = require('./sim-files'),
    SocketServer = require('./socket'),
    pluginSimulationFiles = require('./plugin-files'),
    utils = require('./utils/jsUtils');
// simulateGapPlugins can be called in customMiddleware File. 
// Creation of a global nodPlugins variable, stops the use of having to do a process.simulateGapPluginsCall in the middleware file.
// eslint-disable-next-line no-undef
simulateGapPlugins = require('./node-plugins');

/**
 * Maximum length of <meta> tag we search for when modifying CSP properties
 * Needed for when a tag crosses multiple chunk boundaries.
 * @const
 */
var MAX_CSP_TAG_LENGTH = 1024;

/**
 * The simulation server that encapsulates the HTTP server instance and
 * Web Socket server. It enables to start and stop the server to listening
 * for new connections.
 * @param {object} simulatorProxy
 * @param {object} project
 * @param {object} hostRoot
 * @constructor
 */
function SimulationServer(simulatorProxy, project, hostRoot, _config) {
    this._simulatorProxy = simulatorProxy;
    this._project = project;
    this._hostRoot = hostRoot;
    this._simulationFiles = new SimulationFiles(hostRoot);
    this._simSocket = new SocketServer(simulatorProxy, project);
    this._cordovaServer = null;
    this._urls = null;
    this._config = _config;
}

Object.defineProperties(SimulationServer.prototype, {
    cordovaServer: {
        get: function () {
            return this._cordovaServer;
        }
    },
    server: {
        get: function () {
            return this._cordovaServer ? this._cordovaServer.server : null;
        }
    },
    simSocket: {
        get: function () {
            return this._simSocket;
        }
    },
    urls: {
        get: function () {
            return this._urls;
        }
    }
});

SimulationServer.prototype.start = function (platform, opts) {
    var config = this._simulatorProxy.config;

    this._cordovaServer = cordovaServe();

    /* attach simulation host middleware */
    var middlewarePath = path.join(config.simHostOptions.simHostRoot, 'server', 'server.js');
    var simHostMiddleware = null;
    if (fs.existsSync(middlewarePath)) {
        simHostMiddleware = require(middlewarePath);
        simHostMiddleware.attach(this._cordovaServer.app, dirs, this._hostRoot);
    }

    /* attach custom middleware */
    if (this._config.middleware) {
        var customiddlewarePath = path.join(process.cwd(), this._config.middleware);
        if (!fs.existsSync(customiddlewarePath)) {
            throw new Error('middleware could not be found');
        }
        this._cordovaServer.app.use(require('body-parser').json());
        this._cordovaServer.app.use(require(customiddlewarePath));
    }

    /* attach CORS proxy middleware */
    if (config.xhrProxy) {
        require('./xhr-proxy').attach(this._cordovaServer.app);
    }

    this._prepareRoutes(simHostMiddleware);

    var serverOpts = {
        port: opts.port,
        root: opts.dir,
        noServerInfo: true
    };

    if (this._config.middleware) {
        serverOpts.middleware = this._config.middleware;
    }

    return this._cordovaServer.servePlatform(platform, serverOpts)
        .then(function () {
            this._trackServerConnections();
            this._simSocket.init(this._cordovaServer.server);

            // setup simulation URLs
            var projectRoot = this._cordovaServer.projectRoot,
                urlRoot = 'http://localhost:' + this._cordovaServer.port + '/';

            this._urls = {
                root: urlRoot,
                app: urlRoot + parseStartPage(projectRoot),
                simHost: urlRoot + 'simulator/index.html'
            };

            log.log('Server started:\n- App running at: ' + this._urls.app + '\n- Sim host running at: ' + this._urls.simHost);

            return {
                urls: this._urls,
                projectRoot: projectRoot,
                root: this._cordovaServer.root
            };
        }.bind(this));
};

/**
 * Stop the simulation server by closing the server and destroy active connections.
 * @return {Promise} A promise that is resolved once the server has been closed.
 */
SimulationServer.prototype.stop = function () {
    if (!this._isServerReady()) {
        return Q.resolve();
    }

    var deferred = Q.defer(),
        promise = deferred.promise;

    try {
        this._cordovaServer.server.close(function () {
            deferred.resolve();
        });
    } catch (error) {
        // calling server.close when the server was already closed
        // throws an exception, so let's handle it, resolve the
        // promise and continue cleaning up the state
        deferred.resolve();
    }

    for (var id in this._connections) {
        var socket = this._connections[id];
        socket && socket.destroy();
    }

    this._simSocket.closeConnections();

    this._connections = {};

    return promise;
};

/**
 * Define the routes for the current express app to the simulation files.
 * @private
 */
SimulationServer.prototype._prepareRoutes = function (simHostMiddleware) {
    var app = this._cordovaServer.app;

    var streamSimHostHtml = this._streamSimHostHtml.bind(this),
        streamAppHostHtml = this._streamAppHostHtml.bind(this);

    app.get('/simulator/', streamSimHostHtml);
    app.get('/simulator/*.html', streamSimHostHtml);
    app.get('/', streamAppHostHtml);
    app.get('/*.html', streamAppHostHtml);
    app.get('/simulator/app-host.js', function (request, response) {
        this._sendHostJsFile(request, response, 'app-host');
    }.bind(this));
    app.get('/simulator/sim-host.js', function (request, response) {
        this._sendHostJsFile(request, response, 'sim-host');
    }.bind(this));
    app.get('/simulator/sim-host-theme.css', function (request, response, next) {
        this._sendSimHostThemeCssFile(request, response, next, simHostMiddleware);
    }.bind(this));
    app.use(this._project.getRouter());
    app.use('/simulator', cordovaServe.static(this._hostRoot['sim-host']));
    app.use('/simulator/thirdparty', cordovaServe.static(dirs.thirdParty));
};

/**
 * @param {Request} request
 * @param {Stream} response
 * @param {string} hostType
 * @private
 */
SimulationServer.prototype._sendHostJsFile = function (request, response, hostType) {
    var config = this._simulatorProxy.config,
        hostJsFile = this._simulationFiles.getHostJsFile(hostType, config.simulationFilePath);

    if (!hostJsFile) {
        throw new Error('Path to ' + hostType + '.js has not been set.');
    }

    if (hostType === 'app-host') {
        // Provide current user agent
        send(request, hostJsFile, {
            transform: function (stream) {
                return stream
                    .pipe(replaceStream('/** USER-AGENT **/', config.deviceInfo.userAgent));
            }
        }).pipe(response);
    } else {
        response.sendFile(hostJsFile);
    }
};

/**
 * @param {object} request
 * @param {object} response
 * @private
 */
SimulationServer.prototype._streamAppHostHtml = function (request, response) {
    var config = this._simulatorProxy.config;
    var filePath = path.join(this._project.platformRoot, url.parse(request.url).pathname);

    if (request.query && request.query['cdvsim-enabled'] === 'false') {
        response.sendFile(filePath);
        return;
    }

    // Always prepare before serving up app HTML file, so app is up-to-date,
    // then create the app-host.js (if it is out-of-date) so it is ready when it is requested.
    var simFiles = this._simulationFiles;

    this._project.prepare()
        .then(function () {
            return simFiles.createAppHostJsFile(this._project, config.simulationFilePath);
        }.bind(this))
        .then(function (pluginList) {
            // Sim host will need to be refreshed if the plugin list has changed.
            if (simFiles.pluginsChanged(pluginList, config.simulationFilePath)) {
                this._simSocket.reloadSimHost();
            }

            // Inject plugin simulation app-host <script> references into *.html
            log.log('Injecting app-host into ' + filePath);
            var scriptSources = [
                '/simulator/thirdparty/socket.io.js',
                '/simulator/app-host.js'
            ];
            var scriptTags = scriptSources.map(function (scriptSource) {
                return '<script src="' + scriptSource + '"></script>';
            }).join('');

            // Note we add "connect-src 'self' ws:" and "img-src 'blob:' (in Content Security Policy) so that
            // websocket connections are allowed and the camera plugin works (this relies on a custom version
            // of send that supports a 'transform' option).
            var metaTagRegex = /<\s*meta[^>]*>/g;
            var cspRegex = /http-equiv\s*=\s*(['"])Content-Security-Policy\1/;
            var cspContent = /(content\s*=\s*")([^"]*)"/;
            send(request, filePath, {
                transform: function (stream) {
                    return stream
                        .pipe(replaceStream(/(<\s*head\b[^>]*>)/, '$1' + scriptTags))
                        .pipe(replaceStream(metaTagRegex, function (metaTag) {
                            if (!cspRegex.test(metaTag)) {
                                // Not a CSP tag; return unchanged
                                return metaTag;
                            }
                            return metaTag.replace(cspContent, function (match, preamble, csp) {
                                var policy = new cspParse(csp);
                                var defaultCsp = policy.get('default-src');
                                if (!policy.get('connect-src')) {
                                    policy.add('connect-src', defaultCsp);
                                }
                                policy.add('connect-src', '\'self\' ws:');
                                if (!policy.get('img-src')) {
                                    policy.add('img-src', defaultCsp);
                                }
                                policy.add('img-src', 'blob:');
                                return preamble + policy.toString() + '"';
                            });
                        }, {maxMatchLen: MAX_CSP_TAG_LENGTH}));
                }
            }).pipe(response);
        }.bind(this))
        .done();
};

/**
 * @param {object} request
 * @param {object} response
 * @private
 */
SimulationServer.prototype._streamSimHostHtml = function (request, response) {
    // If we haven't ever prepared, do so before we try to generate sim-host, so we know our list of plugins is up-to-date.
    // Then create sim-host.js (if it is out-of-date) so it is ready when it is requested.
    var project = this._project;
    var config = this._simulatorProxy.config;

    project.prepare()
        .then(function () {
            var simulationFilePath = config.simulationFilePath;

            return this._simulationFiles.createSimHostJsFile(project, simulationFilePath);
        }.bind(this))
        .then(function () {
            // Inject references to simulation HTML files
            var panelsHtmlBasename = pluginSimulationFiles['sim-host']['panels'];
            var dialogsHtmlBasename = pluginSimulationFiles['sim-host']['dialogs'];
            var panelsHtml = [];
            var dialogsHtml = [];

            var pluginList = project.getPlugins();

            Object.keys(pluginList).forEach(function (pluginId) {
                var pluginPath = pluginList[pluginId];
                if (pluginPath) {
                    var lang = config.lang;

                    var panelsHtmlFile = path.join(pluginPath, panelsHtmlBasename);
                    if (fs.existsSync(panelsHtmlFile)) {
                        panelsHtml.push(processPluginHtml(panelsHtmlFile, pluginId, lang));
                    }

                    var dialogsHtmlFile = path.join(pluginPath, dialogsHtmlBasename);
                    if (fs.existsSync(dialogsHtmlFile)) {
                        dialogsHtml.push(processPluginHtml(dialogsHtmlFile, pluginId, lang));
                    }
                }
            });

            // Note that this relies on a custom version of send that supports a 'transform' option.
            var that = this;
            send(request, path.join(this._hostRoot['sim-host'], 'sim-host.html'), {
                transform: function (stream) {
                    return stream
                        .pipe(replaceStream('<!-- TITLE -->', that._simulatorProxy.config.simHostOptions.title))
                        .pipe(replaceStream('<!-- PANELS -->', panelsHtml.join('\n')))
                        .pipe(replaceStream('<!-- DIALOGS -->', dialogsHtml.join('\n')));
                }
            }).pipe(response);
        }.bind(this))
        .done();
};

/**
 * Serves the CSS file for the current theme, if there is one.
 * @param {object} request
 * @param {object} response
 * @param {Function} next
 * @param simHostMiddleware
 * @private
 */
SimulationServer.prototype._sendSimHostThemeCssFile = function (request, response, next, simHostMiddleware) {
    if (this._simulatorProxy.config.theme) {
        var themeCssFileName = this._simulatorProxy.config.theme.getCssFileName();
        if (simHostMiddleware && simHostMiddleware.cssTransform) {
            send(request, themeCssFileName, {
                transform: simHostMiddleware.cssTransform(request)
            }).pipe(response);
        } else {
            send(request, themeCssFileName).pipe(response);
        }
    } else {
        next();
    }
};

/**
 * Keep track of the clients connected to the server. When a new client is connected,
 * assign an ID and listen for the close event, to remove it from the tracked active
 * connections.
 * The connections are tracked in order to force to close the active ones, when the
 * server is closed.
 * @private
 */
SimulationServer.prototype._trackServerConnections = function () {
    var nextId = 0;
    this._connections = {};

    this._cordovaServer.server.on('connection', function (socket) {
        var id = nextId++;
        this._connections[id] = socket;

        socket.on('close', function () {
            delete this._connections[id];
        }.bind(this));
    }.bind(this));
};

/**
 * Check if the HTTP server instance is available.
 * @return {boolean}
 * @private
 */
SimulationServer.prototype._isServerReady = function () {
    // Cordova-serve assign the new HTTP Server instance after the call
    // to servePlatform.
    return !!this.server;
};

var parseStartPage = function (projectRoot) {
    // Start Page is defined as <content src="some_uri" /> in config.xml
    var configFile = path.join(projectRoot, 'config.xml');
    if (!fs.existsSync(configFile)) {
        throw new Error('Cannot find project config file: ' + configFile);
    }

    var startPageRegexp = /<content\s+src\s*=\s*"(.+)"\s*\/>/ig,
        configFileContent = fs.readFileSync(configFile);

    var match = startPageRegexp.exec(configFileContent);
    if (match) {
        return match[1];
    }

    return 'index.html'; // default uri
};

function processPluginHtml(htmlFile, pluginId, lang) {
    if (lang) {
        var localizedHtmlFile = getLocalizedHtmlFile(htmlFile, lang);
        if (localizedHtmlFile) {
            htmlFile = localizedHtmlFile;
        }
    }

    var html = fs.readFileSync(htmlFile, 'utf8');


    var tags = [
        /<script[^>]*src\s*=\s*"([^"]*)"[^>]*>/g,
        /<link[^>]*href\s*=\s*"([^"]*)"[^>]*>/g
    ];

    return tags.reduce(function (result, regex) {
        // Ensures plugin path is prefixed to source of any script and link tags
        return result.replace(regex, function (match, p1) {
            return match.replace(p1, 'plugin/' + pluginId + '/' + p1.trim());
        });
    }, html).replace(/<!\-\-(.|\s)*?\-\->(\s)*/g, function () {
        // Remove comments
        return '';
    });
}

function getLocalizedHtmlFile(htmlFile, lang) {
    // For built-in plugins, look under src/i18n/lang for the localized file
    var localizedHtmlFile = htmlFile.split(path.sep);
    var pos = localizedHtmlFile.indexOf('src');
    localizedHtmlFile.splice(pos + 1, 0, 'i18n', lang);
    localizedHtmlFile = localizedHtmlFile.join(path.sep);
    if (utils.existsSync(localizedHtmlFile)) {
        return localizedHtmlFile;
    }

    // If didn't find that, look under directory that contains the source html files, which will be the case for plugins
    // that define their own simulation.
    localizedHtmlFile = path.join(path.dirname(htmlFile), 'i18n', lang, path.basename(htmlFile));
    return utils.existsSync(localizedHtmlFile) ? localizedHtmlFile : null;
}

module.exports = SimulationServer;
