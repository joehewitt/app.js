
var fs = require('fs'),
    path = require('path'),
    abind = require('dandy/errors').abind,
    _ = require('underscore'),
	hascan = require('hascan');
    
// *************************************************************************************************

// XXXjoe Need a public way to add file extensions to this list
var transientExtensions = [];

var reRequire = /require\s*\(\s*["'](.*?)["']\s*\)/g;
var reStyle = /^\s*"style\s+(.*?)\s*"\s*;?\s*$/gm;
var rePragma = /^\s*"pragma\s+(.*?)\s*"\s*;?\s*$/gm;

var reCSSImport = /@import\s+(url\s*\()?"(.*?)"\)?/g;
var reCSSURL = /url\("?(.*?)"?\)/g;
var reIconFiles = /(favicon\.ico)|(apple-touch-icon(.*?)\.png)/;

// *************************************************************************************************

exports.searchScript = function(modulePath, basePath, cb) {
    if (typeof(basePath) == 'function') { cb = basePath; basePath = null; }

    if (modulePath[0] == '/') {
        complete(modulePath);
    } else {
        var baseScriptPath = basePath ? require.resolve(basePath) : null;
        if (baseScriptPath && modulePath[0] == '.') {
            var absolutePath = path.resolve(path.dirname(baseScriptPath), modulePath);
            complete(absolutePath);
        } else if (baseScriptPath) {
            var baseDir = path.dirname(baseScriptPath);
            findInNodeModules(baseDir)
        } else {
            complete(modulePath);
        }
    }

    /**
     * require.resolve unfortunately can't be given a relative base path, so we have
     * to simulate its behavior ourself.  This here does the node_modules search.
     */
    function findInNodeModules(containerPath) {
        fs.lstat(containerPath, abind(function(err, stat) {
            if (stat.isDirectory()) {
                var foundPath = path.resolve(containerPath, 'node_modules', modulePath);
                try {
                    foundPath = require.resolve(foundPath);
                    complete(foundPath);
                } catch (exc) {
                    if (containerPath != '/') {
                        findInNodeModules(path.dirname(containerPath));
                    } else {
                        fail();
                    }
                }
            } else {
                fail();
            }
        }, cb, this));
    }

    function complete(modulePath) {
        var scriptPath = require.resolve(modulePath);

        exports.shortenModulePath(scriptPath, abind(function(err, shortModulePath) {
            cb(0, {path: scriptPath, name: shortModulePath});
        }, cb, this));            
    }

    function fail() {
        cb(new Error("Module '" + modulePath + "' not found."));            
    }
}

exports.searchStatic = function(modulePath, basePath, isURL, cb) {
    if (typeof(isURL) == 'function') { cb = isURL; isURL = false; }
    if (typeof(basePath) == 'function') { cb = basePath; basePath = null; }

    try {
        modulePath = securePath(modulePath);
        if (!modulePath) { cb("Illegal path"); return; }
        
        var absolutePath = exports.normalizeName(modulePath, basePath, isURL);
        var parts = absolutePath.split('/');
        if (!parts.length) {
            return cb(0, '');
        }

        var rootModuleName = parts[0];
        var baseScriptPath = require.resolve(rootModuleName);
        exports.findPackageStaticPath(baseScriptPath, abind(function(err, staticPath) {
            var filePath = path.join(staticPath, parts.slice(1).join('/'));
            cb(0, filePath);
        }, cb));            
    } catch (exc) {
        console.error(exc.stack)
        cb(exc);
    }
}

exports.traceScript = function(rootModuleName, skipDebug, cb) {
    var moduleMap = {};
    var styleMap = {};
    var iconMap = {};
    var imageMap = {};
    // XXXjoe array-indexof is used in appjs.js, so I should just trace appjs.js too!
    var hasMap = {"array-indexof": true};
    var results = {js: moduleMap, css: styleMap, icons: iconMap, images: imageMap, has: hasMap};
    var depth = 0;

    traceIcons.apply(this, [rootModuleName]);
    traceScript.apply(this, [rootModuleName]);

    function traceScript(modulePath, basePath, sourceLine) {
        ++depth;

        exports.searchScript(modulePath, basePath, tbind(function(err, findings) {
            if (modulePath in moduleMap) {
                complete();
            } else {
                fs.lstat(findings.path, tbind(function(err, stat) {
                    fs.readFile(findings.path, tbind(function(err, source) {
                        var pragmas = moduleMap[findings.name] = {
                            debug: !shouldTrace(modulePath),
                            path: findings.path,
                            source: source+'',
                            sourceLine: sourceLine,
                            mtime: stat.mtime.getTime()
                        };

                        var m;
                        while ((m = rePragma.exec(source))) {
                            pragmas[m[1]] = 1;
                        }
                        _.each(hascan.findFeatureTests(source+''), function(required, feature) {
                            hasMap[feature] = required;
                        });

                        if (!skipDebug || !pragmas.debug) {
                            while(m = reRequire.exec(source)) {
                                var depName = m[1];
                                traceScript.apply(this, [depName, findings.name, m[0]]);
                            }
                        }

                        while (m = reStyle.exec(source)) {
                            var stylesheetPath = exports.normalizeName(m[1], findings.name);
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

            exports.traceStylesheet(stylesheetPath, true, null, sourceLine, tbind(function(err, res) {
                _.extend(results.css, res.css);
                _.extend(results.images, res.images);

                complete();
            }, this));
        }
    }

    function traceIcons(modulePath, basePath) {
        ++depth;

        exports.searchScript(modulePath, basePath, tbind(function(err, findings) {
            exports.findPackageStaticPath(findings.path, tbind(function(err, staticPath) {
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
                try {
                    fn.apply(self, [0, obj]);
                } catch (exc) {
                    cb(exc);
                }
            }
        }
    }

    function complete() {
        if (!--depth) {
            cb(0, results);
        }
    }
},

exports.traceStylesheet = function(modulePath, recursive, source, sourceLine, cb) {
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
            var stylesheetPath = exports.normalizeName(m[2], basePath, true);
            traceStylesheet.apply(this, [stylesheetPath, m[1], m[0]]);
        }

        while ((m = reCSSURL.exec(source)) && m[1]) {
            var imagePath = exports.normalizeName(m[1], basePath, true);
            traceImage.apply(this, [imagePath, m[1], m[0]]);
        }

        if (!--depth) {
            cb(0, results);
        }
    }

    function traceStylesheet(stylesheetPath, sourceURL, sourceLine) {
        if (!(stylesheetPath in styleMap)) {
            ++depth;

            exports.searchStatic(stylesheetPath, null, false, _.bind(function(err, stylesheetPath) {
                if (err) { if (!--depth) cb(0, results); return; }

                fs.lstat(stylesheetPath, _.bind(function(err, stat) {
                    if (err) { if (!--depth) cb(0, results); return; }

                    fs.readFile(stylesheetPath, _.bind(function(err, source) {
                        if (err) { if (!--depth) cb(0, results); return; }

                        exports.shortenStaticPath(stylesheetPath, _.bind(function(err, absolutePath) {
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

            exports.searchStatic(modulePath, null, true, _.bind(function(err, imagePath) {
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

exports.findPackagePath = function(scriptPath, cb) {
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
}

exports.findPackageStaticPath = function(scriptPath, cb) {
    exports.findPackageInfo(scriptPath, abind(function(err, result) {
        var staticPath = readStaticPath(result);
        if (staticPath) {
            cb(0, staticPath);          
        } else {
            cb("No static path for " + scriptPath);
        }
    }, cb, this));
}

exports.findPackageInfo = function(scriptPath, cb) {
    exports.findPackagePath(scriptPath, abind(function(err, packagePath) {
        fs.readFile(packagePath, abind(function(err, packageJSON) {
            var packageInfo = JSON.parse(packageJSON);
            cb(0, {path: packagePath, info: packageInfo});
        }, cb));
    }, cb));
}

exports.shortenModulePath = function(scriptPath, cb) {
    exports.findPackageInfo(scriptPath, abind(function(err, result) {
        // Read the package.json so we can use info contained within
        var dirName = path.dirname(result.path);
        var mainPath = path.resolve(dirName, result.info.main);
        if (path.extname(mainPath) != '.js') {
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
            if (ext == '.js') {
                relativeName = path.join(path.dirname(relativeName),
                                         path.basename(relativeName, ext));
            }
            cb(0, relativeName);
        }
    }, cb));
}

exports.shortenStaticPath = function(resourcePath, cb) {
    exports.findPackageInfo(resourcePath, abind(function(err, result) {
        var staticPath = readStaticPath(result);
        if (staticPath) {
            // Remove the directories above the package directory
            var relativePath = resourcePath.substr(staticPath.length+1);
            var relativeName = path.join(result.info.name, relativePath);
            cb(0, relativeName);
        } else {
            cb(0, null);
        }
    }, cb, this));
}

exports.normalizeName = function(name, baseName, isURL) {
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
}

// *************************************************************************************************

function readStaticPath(result) {
    var appInfo = result.info['app.js'];
    if (appInfo && appInfo['static']) {
        return path.resolve(path.dirname(result.path), appInfo['static']);
    }
}

function securePath(insecurePath) {
    var parts = insecurePath.split('/');
    // Upwards paths are illegal
    if (parts.indexOf('..') != -1 ) {
        return '';      
    } else {
        return insecurePath;
    }
}

function shouldTrace(name) {
    return !(path.extname(name) in transientExtensions);
}    
