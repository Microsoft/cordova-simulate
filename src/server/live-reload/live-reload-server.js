// Copyright (c) Microsoft Corporation. All rights reserved.

var ncp = require('ncp');
var path = require('path');
var Q = require('q');
// TODO var telemetry = require('../telemetry-helper');
var Watcher = require('./watcher').Watcher;

/**
 * @constructor
 */
function LiveReload(project, forcePrepare) {
    this._project = project;
    this._forcePrepare = forcePrepare;
    this._watcher = null;
    this._socket = null;
}

LiveReload.prototype.start = function (socket) {
    if (!this._watcher) {
        this._watcher = new Watcher(this._project.projectRoot, this._project.platform, this._onFileChanged.bind(this));
        this._watcher.startWatching();
    }

    this._socket = socket;
    this._socket.emit('start-live-reload');
};

LiveReload.prototype.stop = function () {
    if (this._watcher) {
        this._watcher.stopWatching();
        this._watcher = null;
    }
};

/**
 * @private
 */
LiveReload.prototype._onFileChanged = function (fileRelativePath, parentDir) {
    fileRelativePath = fileRelativePath.replace(/\\/g, '/');

    // Propagate the change to the served platform folder (either via "cordova prepare", or by copying the file
    // directly).
    var propagateChangePromise;

    if (this._forcePrepare) {
        // Sometimes, especially on Windows, prepare will fail because the modified file is locked for a short duration
        // after modification, so we try to prepare twice.
        propagateChangePromise = retryAsync(this._project.prepare.bind(this._project), 2).then(function () {
            return false;
        });
    } else {
        var sourceAbsolutePath = path.join(this._project.projectRoot, parentDir, fileRelativePath);
        var destAbsolutePath = path.join(this._project.platformRoot, fileRelativePath);

        propagateChangePromise = copyFile(sourceAbsolutePath, destAbsolutePath).then(function () {
            return true;
        });
    }

    // Notify app-host. The delay is needed as a workaround on Windows, because shortly after copying the file, it is
    // typically locked by the Firewall and can't be correctly sent by the server.
    propagateChangePromise.delay(125).then(function (shouldUpdateModifTime) {
        var props = { fileType: path.extname(fileRelativePath) };

        if (shouldUpdateModifTime) {
            this._project.updateTimeStampForFile(fileRelativePath, parentDir);
        }

        this._socket.emit('lr-file-changed', { fileRelativePath: fileRelativePath });
        // TODO telemetry.sendTelemetry('live-reload', props);
    }.bind(this)).done();
};

function copyFile(src, dest) {
    return Q.nfcall(ncp, src, dest);
}

function retryAsync(promiseFunc, maxTries, delay, iteration) {
    delay = delay || 100;
    iteration = iteration || 1;

    return promiseFunc().catch(function (err) {
        if (iteration < maxTries) {
            return Q.delay(delay).then(function () {
                return retryAsync(promiseFunc, maxTries, delay, iteration + 1);
            });
        }

        return Q.reject(err);
    });
}

module.exports = LiveReload;
