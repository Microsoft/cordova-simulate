# Cordova-Simulate [![Build Status](https://dev.azure.com/vscode-webdiag-extensions/VS%20Code%20WebDiag%20extensions/_apis/build/status/cordova-simulate%20%5Bmaster%5D?branchName=master)](https://dev.azure.com/vscode-webdiag-extensions/VS%20Code%20WebDiag%20extensions/_build/latest?definitionId=64&branchName=master)

Simulates your Apache Cordova application in the browser.

# Installation

```
npm install -g cordova-simulate
```


# Usage

## CLI
From the command line anywhere within a Cordova project, enter the following:

```
simulate [<platform>] [--target=<browser>]
```

Where:

* **platform** is any Cordova platform that has been added to your project. Defaults to `browser`.
* **browser** is the name of the browser to launch your app in. Can be any of the following: `default`, `chrome`, `chromium`, `edge`, `firefox`, `ie`, `opera`, `safari`.

## API
Use `require('cordova-simulate')` to launch a simulation via the API:

```JavaScript
var simulate = require('cordova-simulate');
simulate(opts);
```

Where `opts` is an object with the following properties (all optional):

* **platform** - any Cordova platform that has been added to your project. Defaults to `browser`.
* **device** - specify the id of a device to start with instead of a platform (the platform will be determined by the
  device). Supported `android` devices are `Nexus4`, `Nexus6`, `Nexus7`, `Nexus10`, `OptimusL70`, `G5`, `GalaxyNote7`
  and `GalaxyS5`. Supported `ios` devices are `iPhone4`, `iPhone5`, `iPhone6`, `iPhone6Plus`, `iPad` and `iPadPro`.
  Supported `windows` devices are `Lumia930`, `Lumia950` and `SurfacePro`. Supported generic devices (which will use the
  `browser` platform) are `Generic320x480`, `Generic320x568`, `Generic360x640`, `Generic384x640`, `Generic412x732`,
  `Generic768x1024`, `Generic800x1280` and `Generic1920x1080`.
* **target** - the name of the browser to launch your app in. Can be any of the following: `default`, `chrome`, `chromium`, `edge`, `firefox`, `ie`, `opera`, `safari`.
* **port** - the desired port for the server to use. Defaults to `8000`.
* **lang** - the language to display in the interface (does not impact console output). Supported values (case-insensitive)
  are `cs` (Czech), `de` (German), `es` (Spanish), `fr` (French), `it` (Italian), `ja` (Japanese), `ko` (Korean), `pl` (Polish),
  `pt` (Portuguese), `ru` (Russian), `tr` (Turkish), `zh-Hans` (Simplified Chinese) and `zh-Hant` (Traditional Chinese).
   Additional tags are ignored (for example, `de-DE` is treated as `de`).
* **dir** - the directory to launch from (where it should look for a Cordova project). Defaults to cwd.
* **simhostui** - the directory containing the UI specific files of the simulation host. Defaults to the bundled simulation host files, found in `src/sim-host/ui`.
* **livereload** - A boolean. Set to `false` to disable live reload. Defaults to `true`.
* **forceprepare** - A boolean. Set to `true` to force a `cordova prepare` whenever a file changes during live reload. If this is `false`, the server will simply copy the changed file to the platform rather than doing a `cordova prepare`. Ignored if live reload is disabled. Defaults to `false`.
* **corsproxy** - Boolean indicating if XMLHttpRequest is proxied through the simulate server. This is useful for working around CORS issues at development time. Defaults to `true`.
* **touchevents** - A boolean. Set to `false` to disable the simulation of touch events in App-Host. Defaults to `true`.
* **simulationpath** - the directory where temporary simulation files are hosted. Defaults to `projectRoot/simulate`.
* **simhosttitle** - specifies the title of the simulation window. Defaults to `Plugin Simulation`.
* **middleware** - A path that points to express middleware. This can be used to write custom plugins that deal with manipulating request data from your app. Further, the middleware has access to all of your `simulate_gap.js` plugins mentioned below using the simulateGapPlugins object. For more detail see the sampleMiddleware file in the docs folder.
* **generateids** - A boolean that generates unique ids for simulated devices at startup. Defaults to `false`.


# What it does

Calling `simulate()` will launch your app in the browser, and open a second browser window displaying UI (the simulation host) that allows you to configure how plugins in your app respond.

## Features

* Allows the user to configure plugin simulation through a UI.
* Launches the application in a separate browser window so that it's not launched within an iFrame, to ease up debugging.
* Allows user to persist the settings for a plug-in response.
* Allows plugins to customize their own UI.
* Reloads the simulated app as the user makes changes to source files.

> **Note for live reload:**
Changes to files such as images, stylesheets and other resources are propagated to the running app without a full page reload. Other changes, such as those to scripts and HTML files, trigger a full page reload.

## Supported plugins

This preview version currently includes built-in support for the following Cordova plugins:

* [cordova-plugin-battery-status](https://github.com/apache/cordova-plugin-battery-status)
* [cordova-plugin-camera](https://github.com/apache/cordova-plugin-camera)
* [cordova-plugin-console](https://github.com/apache/cordova-plugin-console)
* [cordova-plugin-contacts](https://github.com/apache/cordova-plugin-contacts)
* [cordova-plugin-device](https://github.com/apache/cordova-plugin-device)
* [cordova-plugin-device-motion](https://github.com/apache/cordova-plugin-device-motion)
* [cordova-plugin-device-orientation](https://github.com/apache/cordova-plugin-device-orientation)
* [cordova-plugin-dialogs](https://github.com/apache/cordova-plugin-dialogs)
* [cordova-plugin-file](https://github.com/apache/cordova-plugin-file)
* [cordova-plugin-geolocation](https://github.com/apache/cordova-plugin-geolocation)
* [cordova-plugin-globalization](https://github.com/apache/cordova-plugin-globalization)
* [cordova-plugin-inappbrowser](https://github.com/apache/cordova-plugin-inappbrowser)
* [cordova-plugin-media](https://github.com/apache/cordova-plugin-media)
* [cordova-plugin-network-information](https://github.com/apache/cordova-plugin-network-information)
* [cordova-plugin-vibration](https://github.com/apache/cordova-plugin-vibration)

## Adding simulation support to plugins

It also allows for plugins to define their own UI. To add simulation support to a plugin, follow these steps:

1. Clone this repository (`git clone https://github.com/microsoft/cordova-simulate.git`), as it contains useful example code (see `src/plugins`).
2. Add your plugin UI code to your plugin in `src/simulation`. Follow the file naming conventions seen in the built-in plugins.

### Detailed steps

In your plugin project, add a `simulation` folder under `src`, then add any of the following files:

```
sim-host-panels.html
sim-host-dialogs.html
sim-host.js
sim-host-handlers.js
app-host.js
app-host-handlers.js
app-host-clobbers.js
```

#### Simulation Host Files

*sim-host-panels.html*

This defines panels that will appear in the simulation host UI. At the top level, it should contain one or more
`cordova-panel` elements. The `cordova-panel` element should have an `id` which is unique to the plugin (so the plugin
name is one possibility, or the shortened version for common plugins (like just `camera` instead of
`cordova-plugin-camera`). It should also have a `caption` attribute which defines the caption of the panel.

The contents of the `cordova-panel` element can be regular HTML, or the various custom elements which are supported
(see the existing plugin files for more details).

This file shouldn't contain any JavaScript (including inline event handlers), nor should it link any JavaScript files.
Any JavaScript required can be provided in the standard JavaScript files described below, or in additional JavaScript
files that can be included using `require()`.

*sim-host-dialogs.html*

This defines any dialogs that will be used (dialogs are simple modal popups - such as used for the Camera plugin). At
the top level it should contain one or more `cordova-dialog` elements. Each of these must have `id` and `caption`
attributes (as for `sim-host-panels.html`). The `id` will be used in calls to `dialog.showDialog()` and
`dialog.hideDialog()` (see [cordova-simulate/src/plugins/cordova-plugin-camera/sim-host.js](https://github.com/Microsoft/cordova-simulate/blob/master/src/plugins/cordova-plugin-camera/sim-host.js)
for example code).

Other rules for this file are the same as for `sim-host-panels.html`.

*sim-host.js*

This file should contain code to initialize your UI. For example - attach event handlers, populate lists etc. It should
set `module.exports` to one of the following:

1. An object with an `initialize` method, like this:

``` js
module.exports = {
    initialize: function () {
        // Your initialization code here.
    }
};
```

2. A function that returns an object with an `initialize` method. This function will be passed a single parameter -
`messages` - which is a plugin messaging object that can be used to communicate between `sim-host` and `app-host`.
This form is used when the plugin requires that `messages` object - otherwise the simple form can be used. For example:

``` js
module.exports = function (messages) {
    return {
        initialize: function () {
            // Your initialization code here.
        }
    };
};
```

In both cases, the code *currently* executes in the context of the overall simulation host HTML document. You can use
`getElementById()` or `querySelector()` etc to reference elements in your panel to attach events etc. In the future,
this will change and there will be a well defined, limited, asynchronous API for manipulating elements in your
simulation UI.

*sim-host-handlers.js*

This file defines handlers for plugin `exec` calls. It should return an object in the following form:

``` js
{
    service1: {
        action1: function (success, error, args) {
            // exec handler
        },
        action2: function (success, error, args) {
            // exec handler
        }
    },
    service2: {
        action1: function (success, error, args) {
            // exec handler
        },
        action2: function (success, error, args) {
            // exec handler
        }
    }
}
```

It can define handlers for any number of service/action combinations. As for `sim-host.js`, it can return the object
either by;

1. Setting module.exports to this object.
2. Setting module.exports to a function that returns this object (in which case the messages parameter will be passed to that function).

#### App Host Files

*app-host.js*

This file is injected into the app itself (as part of a single, combined, `app-host.js` file). Typically, it would
contain code to respond to messages from `sim-host` code, and as such `module.exports` should be set a function that
takes a single `messages` parameter. It doesn't need to return anything.

*app-host-handlers.js*

This file is to provide `app-host` side handling of `exec` calls (if an `exec` call is handled on the `app-host` side,
then it doesn't need to be handled on the `sim-host` side, and in fact any `sim-host` handler will be ignored). The
format is the same as `sim-host-handlers.js`.

*app-host-clobbers.js*

This file provides support for "clobbering" built in JavaScript objects. It's form is similar to `app-host-handlers.js`,
expect that the returned object defines what you are clobbering. For example, the built-in support for the `geolocation`
plugin uses this to support simulating geolocation even when the plugin isn't present in the app (just like `Ripple`
does), by returning the following:

``` js
{
    navigator: {
        geolocation: {
            getCurrentPosition: function (successCallback, errorCallback, options) {
                // Blah blah blah
            },
            watchPosition: function (successCallback, errorCallback, options) {
                // Blah blah blah
            }
        }
    }
}
```

#### The "messages" Object

A `messages` object is provided to all standard JavaScript files on both the `app-host` and `sim-host` side of things.
It provides the following methods:

`messages.call(method, param1, param2 ...)`: Calls a method implemented on "the other side" (that were registered by
calling `messages.register()`) and returns a promise for the return value, that is fulfilled when the method returns.

`messages.register(method, handler)`: Registers a method handler, which can be called via `messages.call()`.

`messages.emit(message, data)`: Emits a message with data (scalar value or JavaScript object) which will be received by
any code that registers for it (in both `app-host` and `sim-host`).

`messages.on(message, handler)`: Register interest in a particular message.

`messages.off(message, handler)`: Un-register interest in a particular message.

Note that:
* All the above methods are isolated to the plugin - that is, they can only be used to communicate within the plugin's
  own code. For example, when you emit a message, it will only be received by code for the same plugin that registers to
  hear it. So different plugins can use the same method and message names without conflict.
* A method call is always sent from `app-host` to `sim-host` or vice versa (that is, a call from `app-host` can only be
  handled by a method registered on `sim-host`, and vice versa).
* Emitted messages, on the other hand, are sent both "locally" and across to the "other side".

#### Simulate Gap Files

*simulate_gap.js*

This file sits between the `app-host-handlers` and `sim-host-handlers`. The key difference between it and the previous two is that it runs in a nodejs context and has access to all the features that node provides(including NPM modules). This allows you to write any plugin for cordova simulate that you could write for a native device. Cordova_gap files are written in the same service-method style that the other plugin files are written in. Finally, simulate_gap plugins have access to all other simulate_gap plugins through the simulateGapPlugins object. Other plugins can be called by using simulateGapPlugins[`service`][`method`] syntax.

NOTE: Cordova-Simulate will first look for a exec handler in the app-host before checking a `simulate_gap.js` file. This means if you have a duplicate handler in `app-host-handlers.js` it will be run instead.

Below is an example of a basic `simulate_gap.js` file written for [cordova-plugin-secure-storage](https://www.npmjs.com/package/cordova-plugin-secure-storage). While this use is a little silly with the availability of local-storage, it shows the power that these plugins provide.

```js
const nodePersist = require('node-persist');
let storageBuckets = {}

module.exports = {
    SecureStorage:{
        init:async(success,failure,args,simulateGapPlugins) => {
            let [bucket] = args
            storageBuckets[bucket] = nodePersist.create({dir: `.node-persist/${bucket}`})
            try{
                await storageBuckets[bucket].init();
                success()
            } catch(e) {
                failure(e)
            }
        },
        set:async(success,failure,args,simulateGapPlugins) => {
            let [bucket,key,value] = args
            try{
                await storageBuckets[bucket].setItem(key,value)
                success(key)
            } catch(e) {
                failure(e)
            }
        },
        get:async(success,failure,args,simulateGapPlugins) => {
            let[bucket,key] = args
            try{
                let value = await storageBuckets[bucket].getItem(key)
                success(value)
            } catch(e) {
                failure(e)
            }
        }
    }
}
```

# Code of conduct
This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
