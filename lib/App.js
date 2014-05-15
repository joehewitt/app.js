
var path = require('path'),
    fs = require('fs'),
    url = require('url'),
    _ = require('underscore'),
    vm = require('vm'),
    async = require('async'),
    assert = require('assert').ok,
    dandy = require('dandy/errors'),
    abind = require('dandy/errors').abind,
    ibind = require('dandy/errors').ibind,
    Cache = require('diskcache').Cache,
    cacheware = require('express-store'),
    hascan = require('hascan'),
    mime = require('mime'),
    pkg = require('./pkg');
    Renderer = require('./Renderer').Renderer;

// *************************************************************************************************

var defaults = {
    title: '',
    client: null,
    cdn: null,
    repo: null,
    api: null,
    apiCache: null,
    cache: null,
    base: "/",
    resources: "app.js",
    language: 'en',
    charset: 'utf8',
    offline: false,
    viewport: null,
    rss: null,
    appcache: null,
    inlineContent: true,
    stripFeatures: true,
    webAppCapable: false,
    statusBarStyle: null,
    inlineImageMaxSize: 1000,
    htmlHeader: '<!-- To view the original source of this page, add ?viewsource to the URL. -->',
    jsHeader: '/* To view the original source of this page, add ?viewsource to the URL. */',
    socket: null,
    configs: {
        development: {
            loader: 'dynamic',
            js: 'source',
            css: 'source',
            images: 'source',
            icons: 'source',
            content: 'source',
        },
        production: {
            loader: 'static',
            js: 'inline',
            css: 'inline',
            images: 'inline',
            icons: 'source',
            content: 'inline',
        }
    }
};

var defaultMimeType = 'text/plain';
var htmlMimeType = 'text/html';

var reCrawlers = /googlebot|bingbot|slurp/i;
var reCDNs = /Amazon\sCloudFront/i;

var reRootFiles = /(robots\.txt)|(favicon\.ico)|(apple-touch-icon(.*?)\.png)/;

// *************************************************************************************************

function App(conf) {
    this.paths = process.env.NODE_PATH ? process.env.NODE_PATH.split(';') : [];

    this._assignConfig(conf);

    if (this.repo) {
        this.repo = this.repo.replace(/^~/, process.env.HOME);
    }

    this.base = addTrailingSlash(this.base);
    this.baseLength = this.base.split("/").length-2;
    this.startupTime = new Date().getTime();

    this.renderer = new Renderer(this, this.api, this.apiCache, this.base);

    if (!this.cache) {
        this.cache = new Cache(null, false, true, true);
    }
}

exports.App = App;

App.prototype = {
    get resourceBase() {
        return this.base + this.resources;
    },

    get staticPath() {
        return this.resourceBase + "/static";    
    },

    get jsPath() {
        return this.resourceBase + "/js";    
    },

    get cssPath() {
        return this.resourceBase + "/css";    
    },

    get hasPath() {
        return this.resourceBase + "/has";    
    },

    get polyfillsPath() {
        return this.resourceBase + "/polyfills";    
    },

    get repoPath() {
        return path.join(this.repo, this.appVersion);
    },

    get appcachePath() {
        return this.resourceBase + "/cache.manifest";    
    },

    get appjsPrefix() {
        if (!this.reResourcePrefix) {
            return this.reResourcePrefix = new RegExp("^" + this.resources + "(\\.\\d+)?(:.*?)?$");
        } else {
            return this.reResourcePrefix;
        }
    },

    route: function() {
        function handler(req, res, next) {
            var urlOptions = readOptions(req.query, this);
            if (isCrawler(req)) {
                urlOptions.content = 'inline';
            }
            urlOptions.userAgent = req.header('user-agent');

            // Note that the URL matching is done in the prepware middleware function
            this._loadURL(req.urlParsed, req.appjsParts, req.appjsMatch, this.renderer, urlOptions,
            function(err, result) {
                if (err) {
                    dandy.logException(err);
                    send(err, true);
                } else {
                    send(result);
                }
            });

            function send(result, isError) {
                if (result.dependencies) {
                    res.dependencies = _.pluck(result.dependencies, 'path');
                }

                var mimeType = result.mimeType || (result.path
                    ? mime.lookup(result.path) || defaultMimeType
                    : htmlMimeType);

                if (isTextMimeType(mimeType)) {
                    mimeType += '; charset=UTF-8'
                }

                res.header('Content-Type', mimeType);

                if (!isError) {
                    var latestTime = findLatestMtime(result.dependencies || []);
                    if (latestTime) {
                        res.header('ETag', latestTime);
                    }

                    // if (result.permanent || isCDN(req)) {
                    //     res.header('Cache-Control', 'public, max-age=31536000');
                    // } else {
                        res.header('Cache-Control', 'public, max-age=0');
                    // }               
                }

                res.send(result.body, result.error || 200);
            }
        }

        if (this.cache) {
            this.cache.on('unmonitor', _.bind(function(URL) {
                this.invalidate(URL);
            }, this));
        }

        if (this.socket) {
            this._listenToSocket();            
        }
        var cacheMiddleware = this.cache ? cacheware(this.cache) : noware;
        return [prepware(this), uaware(this), cacheMiddleware, _.bind(handler, this)];
    },

    staticRoute: function() {
        function handler(req, res, next) {
            var filePath;
            if (!req.appjsMatch) {
                filePath = 'index.html';
            } else {
                filePath = req.appjsParts.slice(1).join('/');
            }

            filePath = path.join(this.repoPath, filePath);
            fs.stat(filePath, abind(function(err, stat) {
                var dependencies = [{path: filePath, mtime: stat.mtime.getTime()}];
                fs.readFile(filePath, abind(function(err, source) {
                    send.call(this, {path: filePath, body: source, error: err}, !!err);
                }, next, this));                  
            }, next, this));

            function send(result, isError) {
                var mimeType = result.mimeType || (result.path
                    ? mime.lookup(result.path) || defaultMimeType
                    : htmlMimeType);

                if (isTextMimeType(mimeType)) {
                    mimeType += '; charset=UTF-8'
                }

                res.header('Content-Type', mimeType);

                if (!isError) {
                    res.header('ETag', this.appVersion);

                    // if (result.permanent || isCDN(req)) {
                    //     res.header('Cache-Control', 'public, max-age=31536000');
                    // } else {
                        res.header('Cache-Control', 'public, max-age=0');
                    // }               
                }

                res.send(result.body, result.error || 200);
            }
        }

        if (this.cache) {
            this.cache.on('unmonitor', _.bind(function(URL) {
                this.invalidate(URL);
            }, this));
        }

        var cacheMiddleware = this.cache ? cacheware(this.cache) : noware;
        return [prepware(this), cacheMiddleware, _.bind(handler, this)];
    },

    loadURL: function(URL, renderer, options, cb) {
        var req = parseAppjsURL(this, URL, {});
        return this._loadURL(req.urlParsed, req.appjsParts, req.appjsMatch, renderer, options, cb)
    },

    loadResources: function(req, cb) {
        var options = readOptions(req, this);
        this._prepare(abind(function(err) {
            this.renderer.renderResources(options, cb);            
        }, cb, this));
    },

    _loadURL: function(urlParsed, parts, m, renderer, options, cb) {
        if (m) {
            if (parts.length == 2) {
                this._loadAppjs(renderer, options, cb);
            } else {
                if (parts[2] == 'static') {
                    this._loadStatic(parts.slice(3).join('/'), renderer, options, cb);
                } else if (parts[2] == 'js') {
                    var userAgent = m[2] ? unescape(m[2].substr(1)) : '';
                    if (userAgent) {
                        options.userAgent = userAgent;
                    }

                    if (parts.length > 3) {
                        options.js = 'source';
                        options.css = 'included';
                    }
                    this._loadJS(parts.slice(3).join('/'), renderer, options, cb);
                } else if (parts[2] == 'css') {
                    this._loadCSS(renderer, options, cb);
                } else if (parts[2] == 'cache.manifest') {
                    this._loadAppcache(renderer, options, cb);
                } else if (parts[2] == 'has') {
                    this._loadHas(renderer, options, cb);
                } else if (parts[2] == 'polyfills') {
                    this._loadPolyfills(renderer, options, cb);
                } else {
                    cb("Not found");
                }
            }
        } else if (reRootFiles.exec(parts[1])) {
            var newURL = this.staticPath + '/' + this.packageName + '/' + parts[1];
            this.loadURL(newURL, renderer, options, cb);
        } else {
            this._loadPage(urlParsed, renderer, options, cb);
        }
    },

    getContentScript: function(renderer, cb) {
        if (!this.contentScript) {
            this.loadURL(this.jsPath, renderer, {loader: 'static', js: 'inline', beautify: true},
            abind(function(err, js) {
                this.contentScript = vm.createScript(js.body, 'document.js');
                cb(0, this.contentScript);
            }, cb, this));
        } else {
            cb(0, this.contentScript);
        }
    },

    invalidate: function(dependentURL) {
        delete this.contentScript;
        delete this.featureDB;
        delete this.dependencies;

        if (this.socketServer) {
            this.socketServer.broadcast(JSON.stringify({
                name: 'invalidate',
                URL: this.normalizeURL(dependentURL.url)
            }));
        }
    },

    reloadPage: function() {
        if (this.socketServer) {
            this.socketServer.broadcast(JSON.stringify({
                name: 'reload'
            }));
        }
    },

    normalizeURL: function(URL, category, timestamp) {
        return this.renderer.renderURL(URL, category, true, timestamp);
    },

    // ---------------------------------------------------------------------------------------------

    _assignConfig: function(conf) {
        for (var name in defaults) {
            if (name == "configs") {
                var branch = process.env.NODE_ENV == "production"
                             ? defaults.configs.production
                             : defaults.configs.development;
                for (var name in branch) {
                    this[name] = name in conf ? conf[name] : branch[name];
                }
            } else {
                this[name] = name in conf ? conf[name] : defaults[name];
            }
        }        
    },

    _loadPage: function(URL, renderer, options, cb) {
        renderer.renderPage(URL, options, abind(function(err, result) {
            cb(0, {
                body: result.source,
                permanent: options.js == "inline" && options.css == "inline",
                dependencies: result.dependencies,
            });
        }, cb));        
    },

    _loadStatic: function(staticPath, renderer, options, cb) {
        pkg.searchStatic(staticPath, this.paths, abind(function(err, filePath) {
            if (filePath) {
                fs.stat(filePath, abind(function(err, stat) {
                    var dependencies = [{path: filePath, mtime: stat.mtime.getTime()}];
                    fs.readFile(filePath, abind(function(err, source) {
                        if (mime.lookup(filePath) == 'text/css') {
                            renderer.compressCSS(source+'', staticPath, options,
                            function(err, source) {
                                cb(0, {path: filePath, body: source, dependencies: dependencies});
                            });
                        } else {
                            cb(0, {path: filePath, body: source, raw: true,
                                   dependencies: dependencies});
                        }
                    }, cb, this));                  
                }, cb, this));
            }
        }, cb, this));
    },

    _loadJS: function(modulePath, renderer, options, cb) {
        var scriptPath = this._cleanJSPath(modulePath, renderer);
        var basePath = scriptPath == this.client ? null : this.client;

        var searchPaths = [basePath];
        if (this.paths.length) {
            searchPaths.push.apply(searchPaths, this.paths);
        }

        pkg.searchScript(scriptPath, searchPaths, abind(function(err, findings) {
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

    _loadAppjs: function(renderer, options, cb) {
        var scriptName;
        if (options.loader == "static" || options.js == "worker") {
            scriptName = "appjs-static.js";
        } else if (options.loader == "dynamic") {
            scriptName = "appjs-dynamic.js";            
        } else if (options.loader == "standalone") {
            scriptName = "appjs-standalone.js";            
        }
        if (scriptName) {
            var appjsPath = path.resolve(__dirname, '..', 'client', scriptName);
            renderer.renderScriptRaw(appjsPath, '', options,
                abind(function(err, result) {
                    cb(0, {path: appjsPath, body: result.source, dependencies: result.dependencies});
                }, cb)
            );
        } else {
            cb(new Error("Loader unspecified"));
        }
    },

    _loadHas: function(renderer, options, cb) {
        renderer.renderHas(options, abind(function(err, result) {
            cb(0, {path: result.path, body: result.source, dependencies: result.dependencies});
        }, cb));
    },

    _loadPolyfills: function(renderer, options, cb) {
        renderer.renderPolyfills(options, abind(function(err, result) {
            cb(0, {path: result.path, body: result.source, dependencies: result.dependencies});
        }, cb));
    },

    _loadCSS: function(renderer, options, cb) {
        renderer.renderStylesheet(options,
            abind(function(err, result) {
                cb(0, {path: result.path, body: result.source, dependencies: result.dependencies,
                       permanent: true});
            }, cb)
        );
    },

    _loadAppcache: function(renderer, options, cb) {
        renderer.renderAppcache(options,
            abind(function(err, result) {
                cb(0, {
                    body: result.source,
                    mimeType: 'text/cache-manifest',
                    permanent: options.js == "inline" && options.css == "inline"
                });
            }, cb)
        );
    },

    _prepare: function(cb) {
        if (!this.dependencies) {
            var searchPaths = this.paths;
            pkg.traceScript(this.client, this.paths, false, abind(function(err, deps) {
                this.dependencies = deps;

                async.parallel([
                    ibind(function(next) {
                        hascan.getFeatureDB(_.keys(deps.has), abind(function(err, featureDB) {
                            this.featureDB = featureDB;
                            next(0);
                        }, next, this));                        
                    }, cb, this),

                    ibind(function(next) {
                        if (!this.packageName) {
                            pkg.searchScript(this.client, searchPaths, abind(function(err, findings) {
                                pkg.findPackageInfo(findings.path, abind(function(err, result) {
                                    this.packageName = result.info.name;
                                    next(0);
                                }, cb, this));
                            }, cb, this));
                        } else {
                            next(0);
                        }
                    }, cb, this),

                    ibind(function(next) {
                        if (!this.polyfills) {
                            var polyfillsDirPath = path.join(__dirname, '..', 'client', 'polyfills');
                            this.polyfills = {};
                            fs.readdir(polyfillsDirPath, abind(function(err, names) {
                                if (!err) {
                                    _.each(names, ibind(function(name) {
                                        var feature = path.basename(name, '.js');
                                        this.polyfills[feature] = true;
                                    }, cb, this));
                                }
                                next(0, deps);
                            }, cb, this));
                        } else {
                            next(0);
                        }
                    }, cb, this),
                ], abind(function(err, results) {
                    cb(0, deps);
                }, cb, this));
            }, cb, this));
        } else {
            cb(0, this.dependencies);
        }        
    },

    _cleanJSPath: function(jsPath, renderer) {
        return jsPath
            ? path.join(path.dirname(jsPath), path.basename(jsPath, '.js'))
            : this.client;        
    },

    _listenToSocket: function() {
        var u = url.parse('ws://' + this.socket);
        var ws = require("websocket-server");
        this.socketServer = ws.createServer();
        this.socketServer.listen(u.port);
    }
};

// *************************************************************************************************

function parseAppjsURL(app, URL, ret) {
    var u = ret.urlParsed = url.parse(URL);

    // Remove the : symbol used to append a timestamp purely for caching purposes
    var timestampIndex = u.pathname.lastIndexOf(':');
    if (timestampIndex >= 0) {
        u.pathname = u.pathname.substr(0, timestampIndex);
    }

    var parts = ret.appjsParts = u.pathname.split('/').slice(app.baseLength);
    ret.appjsMatch = app.appjsPrefix.exec(parts[1]);
    return ret;
}

function prepware(app) {
    return function(req, res, next) {
        parseAppjsURL(app, req.url, req);

        app._prepare(function(err, deps) {
            if (err) {
                console.error(err.stack || err);
            } else {
                next();
            }
        });
    }
}

/**
 * Switches to content=inline if user agent is unknown or if no polyfills available for its
 * missing features.
 */
function uaware(app) {
    return function(req, res, next) {
        if (!req.appjsMatch && app.inlineContent) {
            var featureMap = app.featureDB.getFeatureMap(req.header('user-agent'), true);
            if (!featureMap) {
                forceContentInline();
            } else {
                for (var name in featureMap) {
                    var isRequired = app.dependencies.has[name];
                    if (isRequired && !featureMap[name] && !app.polyfills[name]) {
                        forceContentInline();
                        break;
                    }
                }
            }
        }

        function forceContentInline() {
            var U = url.parse(req.url, true);
            U.query['content'] = 'inline';
            req.url = url.format(U);
            req.query = U.query;
        }
        next();    
    }
}

function noware(req, res, next) {
    next();
}

function readOptions(query, defaults) {
    var viewSource = 'viewsource' in query;
    return {
        loader: (viewSource ? 'dynamic' : 'loader' in query ? query.loader : defaults.loader),
        js: (viewSource ? 'source' : 'js' in query ? query.js : defaults.js),
        css: (viewSource ? 'source' : 'css' in query ? query.css : defaults.css),
        images: (viewSource ? 'source' : 'images' in query ? query.images : defaults.images),
        content: (viewSource ? 'source' : 'content' in query ? query.content : defaults.content),
        icons: (viewSource ? 'source' : 'icons' in query ? query.icons : defaults.icons),
    };
}

function findLatestMtime(deps) {
    var maxTime = 0;
    _.each(deps, function(dep) {
        if (dep.mtime > maxTime) {
            maxTime = dep.mtime;
        }
    });
    return maxTime;
}

function isCrawler(req) {
    var userAgent = req.headers['user-agent'];
    return !!reCrawlers.exec(userAgent);
}

function isCDN(req) {
    var userAgent = req.headers['user-agent'];
    return !!reCDNs.exec(userAgent);
}

function isTextMimeType(mimeType) {
    return mimeType.indexOf('text/') == 0
        || mimeType == 'application/json'
        || mimeType == 'application/javascript'
        || mimeType == 'application/x-javascript';
}

function addTrailingSlash(s) {
    if (s && s.substr(s.length-1) == '/') {
        return s;
    } else {
        return s + '/';
    }
}
