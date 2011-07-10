
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
    charset: 'UTF-8',
    viewport: 'width=device-width,maximum-scale=1.0',
    webAppCapable: true,
    statusBarStyle: null,
    touchIcon: null,
    startupImage: null,
    favicon: null,
    deployments: [],
    configs: {
        development: {
            inlineScripts: false,
            inlineStyles: false,
            inlineImages: true,
            inlineContent: false,
            compress: false,
        },
        production: {
            inlineScripts: true,
            inlineStyles: true,
            inlineImages: true,
            inlineContent: false,
            compress: true,
        }
    }
};

function App(moduleName, configName) {
    this.moduleName = moduleName;
    this.configName = configName || defaultConfigName;
    this.loader = new Loader();
}
exports.App = App;

exports.loadApp = function(moduleName, configName, cb) {
    if (typeof(configName) == "function") { cb = configName; configName = undefined; }

    var app = new App(moduleName, configName);
    app.refresh(cb);
};

App.prototype = {
    refresh: function(cb) {
        this.loader.searchScript(this.moduleName, null, _.bind(function(err, findings) {
            assert(!err, "Unable to find module " + this.moduleName);

            this.moduleName = findings.name;

            this.loader.findPackageInfo(findings.path, _.bind(function(err, result) {
                assert(!err, "Unable to load package.json for " + this.moduleName);

                // Read each settings property from package.json or use its default value
                var settings = this.settings = {};
                var packageInfo = this.packageInfo = result.info;
                var debugConfig = process.env.NODE_ENV ||  "development";
                var configNames = [debugConfig, this.configName]
                readSettings(defaults, settings, configNames);
                readSettings(packageInfo['app.js'], settings, configNames);
                
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
            if (name == 'configs') {
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
