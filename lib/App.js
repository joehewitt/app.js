
var path = require('path'),
    fs = require('fs'),
    _ = require('underscore');

var defaults = {
    'title': '',
    'language': 'en',
    'charset': 'UTF-8',
    'viewport': 'width=device-width,maximum-scale=1.0',
    'webAppCapable': true,
    'statusBarStyle': null,
    'touchIcon': null,
    'startupImage': null,
    'favicon': null,
    'deployments': []
};

function App(moduleName, loader) {
    this.moduleName = moduleName;
    this.loader = loader;
}
exports.App = App;

exports.loadApp = function(moduleName, loader, cb) {
    var app = new App(moduleName, loader);    
    app.refresh(function(err, meta) {
        cb(0, app);
    });
};

App.prototype = {
    refresh: function(cb) {
        this.loader.searchScript(this.moduleName, null, _.bind(function(err, appPath) {
            this.appPath = appPath;

            this.packageJSON(_.bind(function(err, data) {
               if (err) { cb(err); return; }
               
               for (var name in defaults) {
                    if (!(name in data)) {
                        data[name] = defaults[name];
                    }
               }

               this.meta = data;
               cb(0, data);
            }, this));
        }, this));
    },

    appDirPath: function() {
        if (this.appPath) {
            return path.dirname(this.appPath);
        }
    },

    packageJSONPath: function() {
        if (this.appPath) {
            // XXXjoe This is not the right path
            var base = path.dirname(this.appPath, '.js');
            return base + '.json';
        }
    },

    packageJSON: function(cb) {
        // XXXjoe This concept doesn't really translate over to npm
        cb(0, {});
        return;

        if (this.appPath) {
            var jsonPath = this.packageJSONPath();
            fs.lstat(this.appPath, _.bind(function(err, stat) {
                if (!err && stat.isFile()) {
                    fs.readFile(this.appPath, function(err, data) {
                        if (err) return cb ? cb(err) : 0;

                        var json = JSON.parse(data);
                        cb(0, json);
                    });
                } else {
                    cb(new Error('File not found'));
                }
            }, this));
        }
    },
};
