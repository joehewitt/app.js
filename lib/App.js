
var path = require('path'),
    fs = require('fs'),
    _ = require('underscore'),
    assert = require('assert').ok,
    Loader = require('./Loader').Loader;

// *************************************************************************************************

var defaultConfigName = require('os').type();

var defaults = {
    title: '',
    language: 'en',
    charset: 'utf8',
    offline: false,
    viewport: null,
    webAppCapable: false,
    statusBarStyle: null,
    favicon: null,
    touchIcon: null,
    startupImage: null,
    deployments: [],
    jsHeader: '/* To view the original source of this page, add ?viewsource to the URL. */',
    configs: {
        development: {
            js: 'source',
            css: 'source',
            images: 'source',
            icons: 'source',
            content: 'source',
        },
        production: {
            js: 'inline',
            css: 'inline',
            images: 'inline',
            icons: 'source',
            content: 'source',
        }
    }
};

function App(moduleName, configName) {
    this.moduleName = moduleName;
    this.configName = configName || defaultConfigName;
    this.loader = new Loader();
    this.startupTime = new Date().getTime();
}
exports.App = App;

exports.loadApp = function(moduleName, configName, options, cb) {
    if (typeof(configName) == "function") { cb = configName; configName = undefined; }

    var app = new App(moduleName, configName);
    app.refresh(options, cb);
};

App.prototype = {
    refresh: function(options, cb) {
        this.loader.searchScript(this.moduleName, null, _.bind(function(err, findings) {
            assert(!err, "Unable to find module " + this.moduleName);

            this.moduleName = findings.name;
            this.modulePath = findings.path;
            
            // Add the parent directory of the module to the search path so it can be
            // required by name without the full path
            var packagePath = findings.path;
            var backCount = findings.name.split('/').length;
            for (var i = 0; i < backCount; ++i) {
                packagePath = path.join(packagePath, '..');
            }
            require.paths.unshift(path.resolve(packagePath));

            this.loader.findPackageInfo(findings.path, _.bind(function(err, result) {
                assert(!err, "Unable to load package.json for " + this.moduleName);

                // Read each settings property from package.json or use its default value
                var settings = this.settings = {};
                var packageInfo = this.packageInfo = result.info;
                var debugConfig = process.env.NODE_ENV ||  "development";
                var configNames = [debugConfig, this.configName];
                readSettings(defaults, settings, configNames);
                readSettings(packageInfo['app.js'], settings, configNames);
                if (options) {
                    readSettings(options, settings);
                }
                
                // Find the absolute name of the client module
                if (settings.client) {
                    var clientPath = path.resolve(path.dirname(result.path), settings.client);
                    this.loader.shortenModulePath(clientPath, _.bind(function(err, clientPath) {
                        this.clientModuleName = clientPath;
                        cb(0, this);
                    }, this));  
                } else {
                    this.clientModuleName = this.moduleName;
                    cb(0, this);
                }
            }, this));
        }, this));
    }
};

function readSettings(appSettings, settings, configNames) {
    if (appSettings) {
        for (var name in appSettings) {
            if (name == 'configs' && configNames) {
                var configs = appSettings[name];
                configNames.forEach(function(configName) {
                    var subsettings = configs[configName];
                    if (subsettings) {
                        for (var subname in subsettings) {
                            settings[subname] = subsettings[subname];
                        }
                    }
                });
            } else {
                settings[name] = appSettings[name];
            }
        }
    }
    return settings;
}
