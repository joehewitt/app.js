
var fs = require('fs'),
    path = require('path'),
    url = require('url'),
    uglify = require('uglify-js'),
    mime = require('mime'),
    crypto = require('crypto'),
    _ = require('underscore'),
    async = require('async'),
    abind = require('dandy/errors').abind;

var reRequire = /require\s*\(\s*["'](.*?)["']\s*\)/g;
var reStyle = /^\s*"style\s+(.*?)\s*"\s*;?\s*$/gm;
var rePragma = /^\s*"pragma\s+(.*?)\s*"\s*;?\s*$/gm;

var reCSSImport = /@import\s+(url\s*\()?"(.*?)"\)?/g;
var reCSSURL = /url\("?(.*?)"?\)/g;

var reAppJSPrefix = /^app.js(\.\d+)?$/;

var reRootFiles = /(robots\.txt)|(favicon\.ico)|(apple-touch-icon(.*?)\.png)/;
var reIconFiles = /(favicon\.ico)|(apple-touch-icon(.*?)\.png)/;

function Loader() {
    this.transientExtensions = [];
}
exports.Loader = Loader;

Loader.prototype = {
    loadURL: function(URL, renderer, options, cb) {
        var u = url.parse(URL);
        var parts = u.pathname.split('/');
        if (reAppJSPrefix.test(parts[1])) {
            if (parts.length == 2) {
                this.loadAppjs(renderer, options, cb);
            } else {
                if (parts[2] == 'static') {
                    this.loadStatic(URL, parts.slice(3).join('/'), renderer, options, cb);
                } else if (parts[2] == 'js') {
                    this.loadJS(parts.slice(3).join('/'), renderer, options, cb);
                } else if (parts[2] == 'css') {
                    this.loadCSS(renderer, options, cb);
                } else if (parts[2] == 'cache.manifest') {
                    this.loadManifest(renderer, options, cb);
                } else {
                    cb("Not found");
                }
            }
        } else if (reRootFiles.exec(parts[1])) {
            var newURL = '/app.js/static/' + renderer.app.packageInfo.name + '/' + parts[1];
            this.loadURL(newURL, renderer, options, cb);
        } else {
            this.loadPage(URL, renderer, options, cb);
        }
    },

    loadPage: function(url, renderer, options, cb) {
        renderer.renderPage(url, options, abind(function(err, source) {
            cb(0, {body: source, permanent: options.js == "inline" && options.css == "inline"});
        }, cb));        
    },

    loadAppjs: function(renderer, options, cb) {
        var appjsPath = path.resolve(__dirname, '..', 'client', "appjs.js");
        renderer.renderScript(appjsPath, '', options, false,
            abind(function(err, result) {
                cb(0, {path: appjsPath, body: result.source, dependencies: result.dependencies});
            }, cb)
        );
    },

    loadStatic: function(url, staticPath, renderer, options, cb) {
        this.searchStatic(staticPath, abind(function(err, filePath) {
            if (filePath) {
                fs.lstat(filePath, abind(function(err, stat) {
                    var dependencies = [{path: filePath, mtime: stat.mtime.getTime()}];
                    fs.readFile(filePath, abind(function(err, source) {
                        if (mime.lookup(filePath) == 'text/css') {
                            renderer.compressCSS(source+'', staticPath, options, function(err, source) {
                                cb(0, {path: filePath, body: source, dependencies: dependencies});
                            });
                        } else {
                            cb(0, {path: filePath, body: source, raw: true, dependencies: dependencies});
                        }
                    }, cb, this));                  
                }, cb, this));
            }
        }, cb, this));
    },

    loadJS: function(basePath, renderer, options, cb) {
        var scriptPath = basePath
            ? path.join(path.dirname(basePath), path.basename(basePath, '.js'))
            : renderer.app.clientModuleName;

        this.searchScript(scriptPath, abind(function(err, findings) {
            if (findings) {
                renderer.renderScript(findings.path, findings.name, options, true,
                    abind(function(err, result) {
                        cb(0, {path: findings.path, name: findings.name, body: result.source,
                               dependencies: result.dependencies, permanent: true});
                    }, cb)
                );
            }
        }, cb, this));
    },

    loadCSS: function(renderer, options, cb) {
        renderer.renderStylesheet(options,
            abind(function(err, result) {
                cb(0, {path: result.path, body: result.source, dependencies: result.dependencies,
                       permanent: true});
            }, cb)
        );
    },

    loadManifest: function(renderer, options, cb) {
        renderer.renderManifest(options,
            abind(function(err, result) {
                cb(0, {
                    body: result.source,
                    mimeType: 'text/cache-manifest',
                    permanent: options.js == "inline" && options.css == "inline"
                });
            }, cb)
        );
    },

    searchScript: function(modulePath, basePath, cb) {
        if (typeof(basePath) == 'function') { cb = basePath; basePath = null; }

        try {
            if (basePath && modulePath[0] == '.') {
                var baseScriptPath = require.resolve(basePath);
                modulePath = path.resolve(path.dirname(baseScriptPath), modulePath);
            }

            // if (basePath && modulePath[0] == '.') {
            //  // XXXjoe I'd prefer not to have to require these scripts
            //  require(basePath);
            //  var baseScriptPath = require.resolve(basePath);
                
            //  // XXXjoe These are private APIs. I need to lobby for Node to make this public
            //  var baseInfo = require('module')._cache[baseScriptPath];
            //  var scriptPath = require('module')._resolveFilename(modulePath, baseInfo)[0];

            //  this.shortenModulePath(scriptPath, function(err, shortModulePath) {
            //      cb(0, {path: scriptPath, name: shortModulePath});
            //  });
            // } else {
                var scriptPath = require.resolve(modulePath);
                            
                this.shortenModulePath(scriptPath, function(err, shortModulePath) {
                    cb(0, {path: scriptPath, name: shortModulePath});
                });
            // }
        } catch (exc) {
            if (cb) cb(exc);
        }
    },

    searchStatic: function(modulePath, basePath, isURL, cb) {
        if (typeof(isURL) == 'function') { cb = isURL; isURL = false; }
        if (typeof(basePath) == 'function') { cb = basePath; basePath = null; }

        try {
            modulePath = this._securePath(modulePath);
            if (!modulePath) { cb("Illegal path"); return; }
            
            var absolutePath = this._normalizeName(modulePath, basePath, isURL);
            var parts = absolutePath.split('/');
            if (!parts.length) {
                return cb(0, '');
            }

            var rootModuleName = parts[0];
            var baseScriptPath = require.resolve(rootModuleName);
            this.findPackageStaticPath(baseScriptPath, abind(function(err, staticPath) {
                var filePath = path.join(staticPath, parts.slice(1).join('/'));
                cb(0, filePath);
            }, cb));            
        } catch (exc) {
            console.error(exc.stack)
            cb(exc);
        }
    },

    traceDependencies: function(rootModuleName, skipDebug, cb) {
        var moduleMap = {};
        var styleMap = {};
        var iconMap = {};
        var imageMap = {};
        var results = {js: moduleMap, css: styleMap, icons: iconMap, images: imageMap};
        var depth = 0;

        traceIcons.apply(this, [rootModuleName]);
        traceScript.apply(this, [rootModuleName]);

        function traceScript(modulePath, basePath, sourceLine) {
            ++depth;

            this.searchScript(modulePath, basePath, tbind(function(err, findings) {
                if (modulePath in moduleMap) {
                    complete();
                } else {
                    fs.lstat(findings.path, tbind(function(err, stat) {
                        fs.readFile(findings.path, tbind(function(err, source) {
                            var pragmas = moduleMap[findings.name] = {
                                debug: !this._shouldTrace(modulePath),
                                path: findings.path,
                                source: source+'',
                                sourceLine: sourceLine,
                                mtime: stat.mtime.getTime()
                            };

                            var m;
                            while ((m = rePragma.exec(source))) {
                                pragmas[m[1]] = 1;
                            }

                            if (!skipDebug || !pragmas.debug) {
                                while(m = reRequire.exec(source)) {
                                    var depName = m[1];
                                    traceScript.apply(this, [depName, findings.name, m[0]]);
                                }
                            }

                            while (m = reStyle.exec(source)) {
                                var stylesheetPath = this._normalizeName(m[1], findings.name);
                                traceStylesheet.apply(this, [stylesheetPath, m[0]]);
                            }

                            complete();
                        }, this));
                    }, this));
                }
            }, this));
        }

        function traceStylesheet(stylesheetPath, sourceLine) {
            if (!(stylesheetPath in styleMap)) {
                ++depth;

                this.traceStylesheet(stylesheetPath, true, null, sourceLine, tbind(function(err, res) {
                    _.extend(results.css, res.css);
                    _.extend(results.images, res.images);

                    complete();
                }, this));
            }
        }

        function traceIcons(modulePath, basePath) {
            ++depth;

            this.searchScript(modulePath, basePath, tbind(function(err, findings) {
                this.findPackageStaticPath(findings.path, tbind(function(err, staticPath) {
                    fs.readdir(staticPath, tbind(function(err, paths) {
                        _.each(paths, function(fileName) {
                            var m = reIconFiles.exec(fileName);
                            if (m) {
                                var filePath = path.join(staticPath, fileName);
                                fs.lstat(filePath, abind(function(err, stat) {
                                    iconMap[fileName] = {path: filePath, mtime: stat.mtime.getTime()};
                                }, this));
                            }
                        }, this);

                        complete();
                    }));
                }, this));
            }, this));
        }

        function tbind(fn, self) {
            return function(err, obj) {
                if (err) {
                    if (!--depth) {
                        cb(0, results);
                    }
                } else {
                    fn.apply(self, [0, obj]);
                }
            }
        }

        function complete() {
            if (!--depth) {
                cb(0, results);
            }
        }
    },

    traceStylesheet: function(modulePath, recursive, source, sourceLine, cb) {
        var styleMap = {};
        var imageMap = {};
        var results = {css: styleMap, images: imageMap};
        var depth = 0;

        if (recursive) {
            traceStylesheet.apply(this, [modulePath, sourceLine]);
        } else {
            scanSource.apply(this, [source, path.dirname(modulePath)]);
        }

        function scanSource(source, basePath) {
            ++depth;

            var m;
            while ((m = reCSSImport.exec(source)) && m[2]) {
                var stylesheetPath = this._normalizeName(m[2], basePath, true);
                traceStylesheet.apply(this, [stylesheetPath, m[1], m[0]]);
            }

            while ((m = reCSSURL.exec(source)) && m[1]) {
                var imagePath = this._normalizeName(m[1], basePath, true);
                traceImage.apply(this, [imagePath, m[1], m[0]]);
            }

            if (!--depth) {
                cb(0, results);
            }
        }

        function traceStylesheet(stylesheetPath, sourceURL, sourceLine) {
            if (!(stylesheetPath in styleMap)) {
                ++depth;

                this.searchStatic(stylesheetPath, null, false, _.bind(function(err, stylesheetPath) {
                    if (err) { if (!--depth) cb(0, results); return; }

                    fs.lstat(stylesheetPath, _.bind(function(err, stat) {
                        if (err) { if (!--depth) cb(0, results); return; }

                        fs.readFile(stylesheetPath, _.bind(function(err, source) {
                            if (err) { if (!--depth) cb(0, results); return; }

                            this.shortenStaticPath(stylesheetPath, _.bind(function(err, absolutePath) {
                                if (err) { if (!--depth) cb(0, results); return; }

                                styleMap[absolutePath] = {
                                    path: stylesheetPath,
                                    sourceURL: sourceURL,
                                    sourceLine: sourceLine,
                                    mtime: stat.mtime.getTime()
                                };

                                if (recursive) {
                                    scanSource.apply(this, [source, path.dirname(absolutePath), true]);
                                }

                                if (!--depth) {
                                    cb(0, results);
                                }
                            }, this));
                        }, this));
                    }, this));          
                }, this));          
            }
        }

        function traceImage(modulePath, sourceURL, sourceLine) {
            if (!(modulePath in styleMap)) {
                ++depth;

                this.searchStatic(modulePath, null, true, _.bind(function(err, imagePath) {
                    if (err) { if (!--depth) cb(0, results); return; }

                    fs.lstat(imagePath, _.bind(function(err, stat) {
                        if (err) { if (!--depth) cb(0, results); return; }

                        imageMap[modulePath] = {
                            path: imagePath,
                            sourceURL: sourceURL,
                            sourceLine: sourceLine,
                            mtime: stat.mtime.getTime()
                        };

                        if (!--depth) {
                            cb(0, results);
                        }
                    }, this));          
                }, this));          
            }           
        }
    },

    findPackagePath: function(scriptPath, cb) {
        var dirName = path.dirname(scriptPath);
        checkForPackage(dirName);

        function checkForPackage(dirName) {
            if (!dirName) { cb("Not found"); return; }

            var packagePath = path.join(dirName, "package.json");
            fs.stat(packagePath, function(err, stat) {
                if (err || !stat.isFile()) {
                    // Keep searching upwards until we find directory containing package.json
                    var nextPath = path.dirname(dirName);
                    if (nextPath != dirName) {
                        checkForPackage(nextPath);
                    } else {
                        cb("Not found");
                    }
                } else {
                    cb(0, packagePath);
                }
            });
        }
    },

    findPackageInfo: function(scriptPath, cb) {
        this.findPackagePath(scriptPath, abind(function(err, packagePath) {
            fs.readFile(packagePath, abind(function(err, packageJSON) {
                var packageInfo = JSON.parse(packageJSON);
                cb(0, {path: packagePath, info: packageInfo});
            }, cb));
        }, cb));
    },

    findPackageStaticPath: function(scriptPath, cb) {
        this.findPackageInfo(scriptPath, abind(function(err, result) {
            var staticPath = this._readStaticPath(result);
            if (staticPath) {
                cb(0, staticPath);          
            } else {
                cb("No static path");
            }
        }, cb, this));
    },

    _readStaticPath: function(result) {
        var appInfo = result.info['app.js'];
        if (appInfo && appInfo['static']) {
            return path.resolve(path.dirname(result.path), appInfo['static']);
        }
    },

    shortenModulePath: function(scriptPath, cb) {
        this.findPackageInfo(scriptPath, abind(function(err, result) {
            // Read the package.json so we can use info contained within
            var dirName = path.dirname(result.path);
            var mainPath = path.resolve(dirName, result.info.main);
            if (!path.extname(mainPath)) {
                mainPath += '.js';
            }
            if (mainPath == scriptPath) {
                // If it's the main script, shorten it to the package name
                cb(0, result.info.name);
            } else {
                // Remove the directories above the package directory
                var relativePath = scriptPath.substr(dirName.length+1);
                var relativeName = path.join(result.info.name, relativePath);

                // Remove .js extension if there is one
                var ext = path.extname(relativeName);
                if (ext) {
                    relativeName = path.join(path.dirname(relativeName),
                                             path.basename(relativeName, ext));
                }
                cb(0, relativeName);
            }
        }, cb));
    },

    shortenStaticPath: function(resourcePath, cb) {
        this.findPackageInfo(resourcePath, abind(function(err, result) {
            var staticPath = this._readStaticPath(result);
            if (staticPath) {
                // Remove the directories above the package directory
                var relativePath = resourcePath.substr(staticPath.length+1);
                var relativeName = path.join(result.info.name, relativePath);
                cb(0, relativeName);
            } else {
                cb(0, null);
            }
        }, cb, this));
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    _ensureModuleDirectory: function(basePath, rootFileName, rootModuleName, cb) {
        var scriptPath = path.join(basePath, rootFileName);
        fs.stat(filePath, function(err, stat) {
            if (err || !stat.isFile()) {
                var dirPath = path.join(basePath, rootModuleName);
                fs.stat(dirPath, function(err, stat) {
                    if (stat.isDirectory()) {
                        cb(0, dirPath);
                    } else {
                        cb(0, null);
                    }               
                });
            } else {
                cb(0, basePath);
            }
        })
    },

    _normalizeName: function(name, baseName, isURL) {
        if (isURL) {
            if (!baseName || (name && name[0] == '/')) {
                return name;
            } else {
                return path.join(baseName, name);
            }
        } else {
            if (baseName && name && name[0] == '.') {
                // Relative paths inside of root modules are contained within the module, not its parent
                if (baseName.indexOf('/') == -1) {
                    baseName += '/';
                }
                return path.normalize(path.join(baseName, name));
            } else {
                return name;
            }
        }
    },

    _securePath: function(insecurePath) {
        var parts = insecurePath.split('/');
        // Upwards paths are illegal
        if (parts.indexOf('..') != -1 ) {
            return '';      
        } else {
            return insecurePath;
        }
    },

    _shouldTrace: function(name) {
        return !(path.extname(name) in this.transientExtensions);
    }
};
