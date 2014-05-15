
var fs = require('fs'),
    path = require('path'),
    abind = require('dandy/errors').abind,
    _ = require('underscore'),
    hascan = require('hascan');
    
// *************************************************************************************************

// XXXjoe Need a public way to add file extensions to this list
var transientExtensions = [];
var packageCache = {};

var reRequire = /require\s*\(\s*["'](.*?)["']\s*\)/g;
var reStyle = /^\s*"style\s+(.*?)\s*"\s*;?\s*$/gm;
var rePragma = /^\s*"pragma\s+(.*?)\s*"\s*;?\s*$/gm;

var reCSSImport = /@import\s+(url\s*\()?"(.*?)"\)?/g;
var reCSSURL = /url\("?(.*?)"?\)/g;
var reIconFiles = /(favicon\.ico)|(apple-touch-icon(.*?)\.png)/;

// *************************************************************************************************

exports.searchScript = function(modulePath, searchPaths, cb) {
    if (typeof(searchPaths) == 'function') { cb = searchPaths; searchPaths = null; }

    if (!(searchPaths instanceof Array)) {
        searchPaths = [searchPaths];
    } else {
        searchPaths = searchPaths.slice();
        searchPaths.push(null);
    }

    if (process.env.NODE_PATH) {
        searchPaths.push.apply(searchPaths, process.env.NODE_PATH.split(';'));
    }

    if (modulePath[0] == '/') {
        complete(modulePath);
    } else {
        searchBasePath(searchPaths.shift());
    }

    function searchBasePath(basePath) {
        var baseScriptPath;
        if (basePath) {
            try {
                baseScriptPath = path.dirname(require.resolve(basePath));
            } catch (exc) {
                baseScriptPath = basePath;
            }
        }
        if (baseScriptPath) {
            var absolutePath = path.resolve(baseScriptPath, modulePath);
            try {
                var scriptPath = require.resolve(absolutePath);
                return complete(scriptPath);
            } catch (exc) {

            }
        }

        if (baseScriptPath) {
            var baseDir = baseScriptPath;
            findInNodeModules(baseDir);
        } else {
            complete(modulePath);
        }        
    }

    /**
     * require.resolve unfortunately can't be given a relative base path, so we have
     * to simulate its behavior ourself.  This here does the node_modules search.
     */
    function findInNodeModules(containerPath) {
        fs.stat(containerPath, abind(function(err, stat) {
            if (stat.isDirectory()) {
                var foundPath = path.resolve(containerPath, 'node_modules', modulePath);
                try {
                    foundPath = require.resolve(foundPath);
                    complete(foundPath);
                } catch (exc) {
                    if (containerPath != '/') {
                        findInNodeModules(path.dirname(containerPath));
                    } else {
                        tryNext();
                    }
                }
            } else {
                tryNext();
            }
        }, fail, this));
    }

    function complete(foundPath) {
        try {
            var scriptPath = require.resolve(foundPath);
            exports.shortenModulePath(scriptPath, abind(function(err, shortModulePath) {
                cb(0, {path: scriptPath, name: shortModulePath});
            }, fail, this));            
        } catch (exc) {
            fail();
        }
    }

    function tryNext() {
        if (!searchPaths.length) {
            fail();
        } else {
            var nextPath = searchPaths.shift();
            searchBasePath(nextPath);
        }
    }

    function fail() {
        cb(new Error("Module '" + modulePath + "' not found."));
    }
}

exports.searchStatic = function(modulePath, searchPaths, isURL, cb) {
    if (typeof(isURL) == 'function') { cb = isURL; isURL = false; }
    if (typeof(searchPaths) == 'function') { cb = searchPaths; searchPaths = null; }

    modulePath = securePath(modulePath);
    if (!modulePath) { cb("Illegal path"); return; }

    findBasePath(abind(function(err, basePath) {
        try {            
            var parts = modulePath.split('/');
            if (!parts.length) {
                cb(0, '');
            }

            exports.findPackageStaticPath(basePath, abind(function(err, staticPath) {
                var filePath = path.join(staticPath, parts.slice(1).join('/'));
                cb(0, filePath);
            }, cb, this));
        } catch (exc) {
            console.error(exc.stack)
            cb(exc);
        }
    }, cb, this));

    function findBasePath(cb) {
        if (modulePath[0] == '.') {
            cb(0, searchPaths[0]);
        } else {
            var baseModule = modulePath.split('/')[0];
            exports.searchScript(baseModule, searchPaths, abind(function(err, findings) {
                if (isURL) {
                    cb(0, findings.path);
                } else {
                    cb(0, findings.path);
                }
            }, cb, this));
        }
    }
}

exports.traceStylesheets = function(rootModuleName, searchPaths, cb) {
    var styleMap = {};
    var depth = 0;

    traceScript.apply(this, [rootModuleName]);

    function traceScript(modulePath, basePath, sourceLine) {
        ++depth;

        exports.searchScript(modulePath, basePath, tbind(function(err, findings) {
            fs.stat(findings.path, tbind(function(err, stat) {
                fs.readFile(findings.path, tbind(function(err, source) {
                    var m;
                    while (m = reStyle.exec(source)) {
                        var stylesheetPath = exports.normalizeName(m[1], findings.name);
                        traceStylesheet.apply(this, [stylesheetPath, m[0]]);
                    }

                    complete();
                }, this));
            }, this));
        }, this));
    }

    function traceStylesheet(stylesheetPath, sourceLine) {
        if (!(stylesheetPath in styleMap)) {
            ++depth;

            exports.traceStylesheet(stylesheetPath, searchPaths, true, null, sourceLine,
            tbind(function(err, res) {
                _.extend(styleMap, res.css);

                complete();
            }, this));
        }
    }

    function tbind(fn, self) {
        return function(err, obj) {
            if (err) {
                if (!--depth) {
                    cb(0, styleMap);
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
            cb(0, styleMap);
        }
    }
};

exports.traceScript = function(rootModuleName, searchPaths, skipDebug, cb) {
    var moduleMap = {};
    var styleMap = {};
    var iconMap = {};
    var imageMap = {};
    // XXXjoe array-indexof is used in appjs.js, so I should just trace appjs.js too!
    var hasMap = {"array-indexof": true};
    var results = {js: moduleMap, css: styleMap, icons: iconMap, images: imageMap, has: hasMap};
    var depth = 0;
    var queue = [];


    enqueue(traceIcons, [rootModuleName]);
    enqueue(traceScript, [rootModuleName]);

    next();

    function traceScript(modulePath, basePath, sourceLine) {
        ++depth;

        var localPaths = searchPaths ? searchPaths.slice() : [];
        localPaths.push(basePath);
        exports.searchScript(modulePath, localPaths, tbind(function(err, findings) {
            if (findings.name in moduleMap) {
                next();
            } else {
                fs.stat(findings.path, tbind(function(err, stat) {
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
                                enqueue(traceScript, [depName, findings.name, m[0]]);
                            }
                        }

                        while (m = reStyle.exec(source)) {
                            var stylesheetPath = exports.normalizeName(m[1], findings.name);
                            enqueue(traceStylesheet, [stylesheetPath, m[0]]);
                        }

                        next();
                    }, this));
                }, this));
            }
        }, this));
    }

    function traceStylesheet(stylesheetPath, sourceLine) {
        if (!(stylesheetPath in styleMap)) {
            ++depth;

            var localPaths = searchPaths ? searchPaths.slice() : [];
            // localPaths.push(basePath);

            exports.traceStylesheet(stylesheetPath, localPaths, true, null, sourceLine,
            tbind(function(err, res) {
                _.extend(results.css, res.css);
                _.extend(results.images, res.images);

                next();
            }, this));
        }
    }

    function traceIcons(modulePath, basePath) {
        ++depth;

        var localPaths = searchPaths ? searchPaths.slice() : [];
        localPaths.push(basePath);

        exports.searchScript(modulePath, localPaths, tbind(function(err, findings) {
            exports.findPackageStaticPath(findings.path, tbind(function(err, staticPath) {
                fs.readdir(staticPath, tbind(function(err, paths) {
                    _.each(paths, function(fileName) {
                        var m = reIconFiles.exec(fileName);
                        if (m) {
                            var filePath = path.join(staticPath, fileName);
                            fs.stat(filePath, function(err, stat) {
                                if (!err) {
                                    iconMap[fileName] = {path: filePath, mtime: stat.mtime.getTime()};
                                }
                            });
                        }
                    }, this);

                    next();
                }));
            }, this));
        }, this));
    }

    function enqueue(fn, args) {
        queue.push(function() { fn.apply(this, args)});
    }

    function next() {
        if (queue.length) {
            var fn = queue.shift();
            fn();
        } else {
            cb(0, results);
        }
    }
    function tbind(fn, self) {
        return function(err, obj) {
            if (err) {
                next();
            } else {
                try {
                    fn.apply(self, [0, obj]);
                } catch (exc) {
                    next();
                }
            }
        }
    }
},

exports.traceStylesheet = function(modulePath, searchPaths, recursive, source, sourceLine, cb) {
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

            exports.searchStatic(stylesheetPath, searchPaths, false, _.bind(function(err, stylesheetPath) {
                if (err) { if (!--depth) cb(0, results); return; }
                fs.stat(stylesheetPath, _.bind(function(err, stat) {
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

            exports.searchStatic(modulePath, searchPaths, true, _.bind(function(err, imagePath) {
                if (err) { if (!--depth) cb(0, results); return; }

                fs.stat(imagePath, _.bind(function(err, stat) {
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
    if (scriptPath in packageCache) {
        return cb(0, packageCache[scriptPath]);
    }
    exports.findPackagePath(scriptPath, abind(function(err, packagePath) {
        fs.readFile(packagePath, abind(function(err, packageJSON) {
            var packageInfo = JSON.parse(packageJSON);
            var payload = {path: packagePath, info: packageInfo};
            packageCache[scriptPath] = payload;
            cb(0, payload);
        }, cb));
    }, cb));
}

exports.shortenModulePath = function(scriptPath, cb) {
    exports.findPackageInfo(scriptPath, abind(function(err, result) {
        // Read the package.json so we can use info contained within
        var dirName = path.dirname(result.path);
        var mainPath = path.resolve(dirName, result.info.main||'');
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