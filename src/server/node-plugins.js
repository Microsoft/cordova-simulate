/* eslint-env es6 */
let fs = require('fs');
let path = require('path');

// iife to allow plugin gathering when module is required
// Intentional use of synchronous fs calls to stop plugins from being exported until all plugins are checked
let plugins = {};
(function () {
    let cordovaPlugins = fs.readdirSync(path.join(process.cwd(), 'plugins'));
    for(let cordovaPlugin of cordovaPlugins) {
        try {
            let temp = require(path.join(process.cwd(), 'plugins', cordovaPlugin, 'src/simulation/simulate_gap.js'));
            let services = Object.keys(temp);
            for(let service of services) {
                plugins[service] = temp[service];
            }
        // eslint-disable-next-line no-empty
        } catch(e) { } // Just catches plugins that don't have a simulate_gap file
    }
})();

module.exports = plugins;