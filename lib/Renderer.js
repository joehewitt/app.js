var path = require('path'),
    fs = require('fs'),
    url = require('url'),
    _ = require('underscore'),
    async = require('async'),
    jsdom = require('jsdom').jsdom,
    domToHtml = require('jsdom/lib/jsdom/browser/domtohtml').domToHtml,
    cssmin = require('cssmin').cssmin,
    mime = require('mime'),
    abind = require('dandy/errors').abind,
    ibind = require('dandy/errors').ibind,
    transformjs = require('transformjs'),
    hascan = require('hascan'),
    pkg = require('./pkg');

// *************************************************************************************************

const docType = '<!DOCTYPE html>';
const defaultHost = '127.0.0.1';
const defaultPort = 8080;

const loadTimeout = 30000;

var reRequire = /require\s*\(\s*["'](.*?)["']\s*\)/g;
var reCSSURL = /url\("?(.*?)"?\)/g;

// *************************************************************************************************

exports.Renderer = function(app, api, apiCache, baseURLPath) {
    this.app = app;
    this.api = api;
    this.apiCache = apiCache;
    this.baseURLPath = addTrailingSlash(baseURLPath);
    this.builtinScripts = [app.resourceBase];
}

exports.Renderer.prototype = {
    renderPage: function(URL, options, cb) {
        this._renderPage({}, options, abind(function(err, html) {
            this.renderContent(URL, html, options, abind(function(err, html) {
                cb(0, {source: html, dependencies: this.app.dependencies.js});
            }, cb, this));
        }, cb, this));
    },

    renderHas: function(options, cb) {
        var deps = this.app.dependencies;
        hascan.buildHasWithTests(_.keys(deps.has), abind(function(err, source) {
            cb(0, {path: 'has.js', source: source, dependencies: _.values(deps.js)});
        }, cb, this))
    },

    renderPolyfills: function(options, cb) {
        var deps = [];
        var features = this.app.dependencies ? _.keys(this.app.dependencies.has) : [];

        async.map(features,
            _.bind(function(feature, cb2) {
                var featureMap = options.userAgent
                                 ? this.app.featureDB.getFeatureMap(options.userAgent, true)
                                 : {};
                if (featureMap && !featureMap[feature]) {
                    var polyfillPath = path.join(__dirname, '..', 'client', 'polyfills', feature+'.js');
                    fs.lstat(polyfillPath, function(err, stat) {
                        if (!err && stat.isFile()) {
                            deps.push[{path: polyfillPath, mtime: stat.mtime.getTime()}];
                            fs.readFile(polyfillPath, 'utf8', abind(function(err, data) {
                                 cb2(0, data+'');
                            }, cb, this))
                        } else {
                            cb2(0, '');
                        }
                    });
                } else {
                    cb2(0, '');
                }
            }, this),
            abind(function(err, polyfills) {
                var source = polyfills.join('');
                cb(0, {path: 'polyfills.js', source: source, dependencies: _.values(deps.js)});
            }, cb, this)
        );
    },

    renderScript: function(scriptPath, modulePath, options, relink, cb) {
        if ((options.js == "inline" || options.js == "standalone") && relink) {
            return this.renderScriptInline(scriptPath, modulePath, options, cb);
        } else if (relink) {
            return this.renderScriptDebug(scriptPath, modulePath, options, cb);
        } else {
            return this.renderScriptRaw(scriptPath, modulePath, options, cb);            
        }
    },

    renderScriptRaw: function(scriptPath, modulePath, options, cb) {
        fs.stat(scriptPath, abind(function(err, stat) {
            var deps = [{path: scriptPath, mtime: stat.mtime.getTime()}];
            fs.readFile(scriptPath, 'utf8', abind(function(err, data) {
                var source = data+'';
                cb(0, {path: 'all.js', source: source, dependencies: deps});
            }, cb, this));            
        }, cb, this));
    },

    renderScriptDebug: function(scriptPath, modulePath, options, cb) {
        fs.stat(scriptPath, abind(function(err, stat) {
            var deps = [{path: scriptPath, mtime: stat.mtime.getTime()}];

            fs.readFile(scriptPath, 'utf8', abind(function(err, data) {
                var compress = options.js == "compress";
                this.wrapScript(modulePath, data, options, abind(function(err, result) {
                    var headers = [result.header];
                    var bodies = [result.body];
                    var source = this._concatScript(modulePath, [], headers, bodies, options);
                    cb(0, {path: 'all.js', source: source, dependencies: deps});
                }, cb, this));
            }, cb, this));            
        }, cb, this));
    },

    renderScriptInline: function(scriptPath, modulePath, options, cb) {
        var sandbox = [];
        var headers = [];
        var bodies = [];
        var deps = [];

        async.waterfall([
            ibind(function(next) {
                options.featureMap = options.userAgent && this.app.featureDB
                    // For client-side rendering, attempt to find a precomputed feature map
                    ? this.app.featureDB.getFeatureMap(options.userAgent, true)
                    // For server-side rendering, the only feature supported is "appjs"
                    : {appjs: 1};

                this._loadURL(this.app.polyfillsPath, options, next);
            }, cb, this),

            ibind(function(polyfillsData, next) {
                deps.push.apply(deps, polyfillsData.dependencies);

                sandbox.push(polyfillsData.body);

                this._loadURL(this.app.resourceBase, options, next);
            }, cb, this),

            ibind(function(appjsData, next) {
                deps.push.apply(deps, appjsData.dependencies);

                sandbox.push(appjsData.body);

                if (!options.featureMap) {
                    this._loadURL(this.app.hasPath, options, next);
                } else {
                    next(0, '');
                }
            }, cb, this),

            ibind(function(hasjsData, next) {
                if (hasjsData) {
                    deps.push.apply(deps, hasjsData.dependencies);
                    sandbox.push(hasjsData.body);
                }

                this._inlineScript(scriptPath, modulePath, deps, options, next);
            }, cb, this),

            ibind(function(result, next) {
                bodies.push(result.source);

                if (options.js == "standalone") {
                    this.renderStylesheet({css: "inline", images: options.images}, abind(function(err, result) {
                        sandbox.push(""
                            + "(function() {"
                            + "var ss = document.createElement('style');"
                            + "ss.innerHTML = " + JSON.stringify(result.source) + ";"
                            + "document.head.appendChild(ss);"
                            + "})();");
                        next(0);
                    }, cb, this));
                } else {
                    next(0);
                }
            }, cb, this),
        ],
        abind(function(err, result) {

            var source = this._concatScript(modulePath, sandbox, headers, bodies, options);
            cb(0, {path: 'all.js', source: source, dependencies: deps});
        }, cb, this));
    },

    renderStylesheet: function(options, cb) {
        var sections = [];
        var deps = [];

        var cssMap = this.app.dependencies.css||{};
        async.map(_.keys(cssMap),
            _.bind(function(depPath, cb2) {
                pkg.searchStatic(depPath, null, false, abind(function(err, filePath) {
                    deps.push({path: filePath, mtime: cssMap[depPath].mtime});

                    fs.readFile(filePath, 'utf8', abind(function(err, data) {
                        if (options.css == "inline" || options.css == "compress") {
                            this.compressCSS(data+'', depPath, options,
                                function(err, data) {
                                    sections.push(data);
                                    cb2(0);
                                }
                            );                              
                        } else {
                            sections.push(data+'');
                            cb2(0);
                        }
                    }, cb, this));
                }, cb, this));
            }, this),
            abind(function(err) {
                var source = sections.join('');
                cb(0, {path: 'all.css', source: source, dependencies: deps});
            }, cb, this)
        );
    },

    renderAppcache: function(options, cb) {
        cb(0, {
            source: [
            'CACHE MANIFEST',
            '/favicon.ico',
            this._renderURL(this.app.jsPath, 'js'),
            this._renderURL(this.app.cssPath, 'css'),
            ((this.app.appcache||{})['CACHE']||[]).join('\n'),
            '',
            'NETWORK:',
            ((this.app.appcache||{})['NETWORK']||[]).join('\n'),
            '*',
            '',

            'FALLBACK:',
            ((this.app.appcache||{})['FALLBACK']||[]).join('\n'),

            ].join('\n')
        });
    },

    renderContent: function(URL, html, options, cb) {
        if (options.content == "inline") {
            this.app.getContentScript(this, abind(function(err, script) {
                this._runInSandbox(script, URL, html, cb);
            }, cb, this));
        } else {
            cb(0, html);
        }
    },

    compressJavaScript: function(source, options) {
        try {
            // XXXjoe Don't use filters if we already stripped has calls when inlining
            var filters = options.featureMap ? [hascan.getHasFilter(options.featureMap)] : [];
            var minify = 'minify' in options ? options.minify : true;
            var beautify = 'beautify' in options ? options.beautify : false;
            var ast = transformjs.transform(source, filters);
            return transformjs.generate(ast, minify, beautify);
        } catch (exc) {
            D&&D('PARSE ERROR', exc);
            return source;
        }
    },
    
    compressCSS: function(source, baseURL, options, cb) {
        pkg.traceStylesheet(baseURL, false, source, null, abind(inlineImages, cb, this));

        function inlineImages(err, deps) {
            async.map(_.keys(deps.images),
                _.bind(function(imagePath, cb2) {
                    var imageURL = this._renderURL(this.app.staticPath + '/' + imagePath, 'images');
                    var sourceURL = deps.images[imagePath].sourceURL;
                    if (options.images == "inline") {
                        this._loadURL(imageURL, {}, _.bind(function(err, result) {
                            var maxSize = this.app.inlineImageMaxSize;
                            if (!err && maxSize && result.body && result.body.length > maxSize) {
                                // Load the image externally if it's too large
                                source = source.replace(sourceURL, imageURL); 
                            } else {
                                // Inline the image if it is less than the maximum size
                                var dataURL = err ? imageURL : encodeDataURL(result.path, result.body);
                                source = source.replace(sourceURL, dataURL); 
                            }
                            cb2(0);
                        }, this));
                    } else if (options.images == "source") {
                        source = source.replace(sourceURL, imageURL);    
                        cb2(0);
                    } else {
                        cb2(0);
                    }
                }, this),
                _.bind(function(err) {
                    inlineStylesheets.apply(this, [deps]);
                }, this)
            );
        }

        function inlineStylesheets(deps) {
            if (options.css == "inline") {
                async.map(_.keys(deps.css),
                    _.bind(function(stylesheetPath, cb2) {
                        // Remove the @import line, since renderStylesheet inlines the imported contents
                        source = source.replace(deps.css[stylesheetPath].sourceLine, '');   
                        cb2(0);
                    }, this),
                    _.bind(function(err) {
                        complete.apply(this);       
                    }, this)
                );
            } else {
                complete.apply(this);
            }
        }

        function complete() {
            if (options.css == "inline" || options.css == "compress") {
                source = cssmin(source);
            }
            cb(0, source);
        }
    },

    /**
     * Inlines the script with all of its dependencies, found recursively.
     */
    _inlineScript: function(scriptPath, modulePath, deps, options, cb) {
        var absoluteModulePath = require.resolve(modulePath);
        var modules = {};

        this._inlineModule(scriptPath, modulePath, modules, deps, options,
            abind(function(err, result) {
                var sources = _.values(modules);

                if (options.js == "inline") {
                    var requirer = 'require("' + modulePath + '");';
                    sources.push(requirer);
                }

                var inlinedSource = sources.join('\n');
                cb(0, {source: inlinedSource, dependencies: deps});            
            }, cb, this)
        );
    },

    _inlineModule: function(scriptPath, modulePath, modules, deps, options, cb) {
        var required = {};
        var ast;

        async.waterfall([
            ibind(function(next) {
                fs.lstat(scriptPath, next);
            }, cb, this),
            
            ibind(function(stat, next) {
                deps.push({path: scriptPath, mtime: stat.mtime.getTime()});

                fs.readFile(scriptPath, 'utf8', next);
            }, cb, this),

            ibind(function(data, next) {
                // Search for require calls and remember 
                ast = transformjs.transform(data+'', [
                    hascan.getHasFilter(options.featureMap),
                    _.bind(function(node, next) {
                        var pathNode = findRequireNode(node);
                        if (pathNode) {
                            required[pathNode.value] = '';                            
                        }
                        return next();
                    }, this)
                ]);

                async.map(_.keys(required), ibind(function(requiredPath, cb2) {
                    pkg.searchScript(requiredPath, scriptPath, abind(function(err, result) {
                        // Remember absolute name of module so we can make it absolute later
                        required[requiredPath] = result.name;
                        cb2(0, result);
                    }, cb, this));  
                }, cb, this), next);
            }, cb, this),

            ibind(function(results, next) {
                ast = transformjs.transform(ast, [
                    _.bind(function(node, next) {
                        var pathNode = findRequireNode(node);
                        if (pathNode) {
                            // Convert potentially relative require paths to their normalized form so
                            // that they can be found in the module cache
                            pathNode.value = required[pathNode.value];
                        }
                        return next();
                    }, this)
                ]);

                var newSource = transformjs.generate(ast, false, true);

                if (options.js == "standalone") {
                    modules[scriptPath] =
                        '(function(require, exports, module) {'
                        + newSource + '})({ready: function(cb) { cb() }}, window, {exports: window});';
                } else {
                    modules[scriptPath] =
                        'define("' + modulePath + '", function(require, exports, module) {' + newSource + '});';
                }

                async.forEach(results, ibind(function(info, cb2) {
                    if (info.path in modules) {
                        cb2(0);
                    } else {
                        this._inlineModule(info.path, info.name, modules, deps, options, cb2);
                    }
                }, cb, this), cb);
            }, cb, this)
        ], cb);
    },

    _concatScript: function(modulePath, sandbox, headers, bodies, options) {
        var inlined = options.js == "inline" || options.js == "standalone";

        var source = 
            sandbox.join('\n')
            + '(function() {'
                + headers.join('\n') + bodies.join('\n')
            + '})();';

        if (inlined || options.js == "compress") {
            source = this.compressJavaScript(source, options);
        }

        if (inlined && this.app.jsHeader) {
            source = this.app.jsHeader + '\n' + source;
        }

        return source;
    },

    _scriptTags: function(urlPaths, options, cb) {
        var params = [];
        if (options.js != this.app.js) {
            params.push("js=" + options.js);
        }

        var q = (params.length ? '?' + params.join('&') : '');

        var tags = [];
        if (options.js == "inline") {
            tags.push(scriptTagForURL(this._renderURL(this.app.jsPath, 'js')));
        } else {
            tags.push(scriptTagForSource('window.appjsBase=' + JSON.stringify(this.app.jsPath)));

            tags.push(scriptTagForURL(this.app.polyfillsPath));
            tags.push(scriptTagForURL(this.app.hasPath));

            tags.push.apply(tags, _.map(urlPaths, scriptTagForURL));

            var mainModuleName = this.app.jsPath + '/' + this.app.client;
            tags.push(scriptTagForURL(mainModuleName));
        }

        cb(0, tags.join('\n'));

        function scriptTagForURL(urlPath) {
            if (options.js == "inline") {
                // Inject the user-agent into the url so it can pass through CDN and bust caches
                return scriptTagForSource(
                    'document.write('
                    + '\'<script type="text/javascript" src="\' + \''
                    + urlPath + q
                    + '\'.replace(/(app\\.js(\\.\\d+)?)/, \'$1:\' + '
                    + 'navigator.userAgent.replace(/\\//g, "%2f")' + 
                    ') + "\\"></" + "script>")');
            } else {
                return '<script type="text/javascript" src="' + urlPath + q + '"></script>';
            }
        }

        function scriptTagForSource(src) {
            return '<script type="text/javascript">' + src + '</script>';
        }
    },

    _processedScriptTags: function(items) {
        // XXXjoe So far we only support processed stylesheets
        return '';
    },

    _styleTags: function(options, cb) {
        var params = [];
        if (options.css != this.app.css) {
            params.push('css=' + options.css);          
        }
        if (options.images != this.app.images) {
            params.push('images=' + options.images);
        }
        var q = (params.length ? '?' + params.join('&') : '');

        if (options.css == "inline") {
            var stylesheetURL = this._renderURL(this.app.cssPath + q, 'css');
            var tag = '<link rel="stylesheet" href="' + stylesheetURL + '">';
            cb(0, tag);
        } else {
            var tags = _.map(this.app.dependencies.css, _.bind(function(dep, urlPath) {
                var stylesheetPath = this.app.staticPath + '/' + urlPath;
                var stylesheetURL = stylesheetPath + q;
                return '<link rel="stylesheet" href="' + stylesheetURL + '">';
            }, this)).join('\n');
            cb(0, tags);
        }
    },

    _iconTags: function(options, cb) {
        if (options.icons == "source") {
            var tags = _.map(this.app.dependencies.icons, _.bind(function(dep, iconName) {
                var iconPath = this.app.staticPath + '/' + this.app.packageName +'/' + iconName;
                var iconURL = this._renderURL(iconPath, 'icons');
                return this._tagForIconURL(iconName, iconURL);
            }, this)).join('\n');
            cb(0, tags);
        } else if (options.icons == "inline") {
            async.map(_.keys(this.app.dependencies.icons),
                _.bind(function(iconName, cb2) {
                    var iconPath = this.app.staticPath + '/' + this.app.packageName + '/' + iconName;
                    var iconURL = this._renderURL(iconPath, 'url');
                    this._loadURL(iconURL, {}, abind(function(err, result) {
                        var dataURL = err
                            ? iconURL
                            : encodeDataURL(result.path, result.body);
                        cb2(0, this._tagForIconURL(iconName, dataURL));
                    }, cb, this));                      
                }, this),
                abind(function(err, iconTags) {
                    cb(0, iconTags.join('\n'));     
                })
            );                  
        } else {
            cb(0, '');
        }
    },

    _processedStyleTags: function(items) {
        return '';      
    },

    _runInSandbox: function(script, URL, html, cb) {
        var pending = 0;
        var finished = false;

        var document = jsdom(html, null, {
            features: {
                FetchExternalResources: false,
                ProcessExternalResources: false,
                MutationEvents: false,
                QuerySelector: ['1.0']
            }
        });

        var window = document.createWindow();

        window.appjs = {
            moduleName: this.app.client,
            href: URL,

            lookup: function(moduleName, baseName, cache) {
                if (baseName && moduleName[0] == '.') {
                    var basePath = require.resolve(baseName);
                    moduleName = path.resolve(path.dirname(basePath), moduleName);
                }

                var scriptPath = require.resolve(moduleName);
                if (scriptPath in cache) {
                    return cache[scriptPath];
                } else {
                    var source = fs.readFileSync(scriptPath, 'utf8');
                    return cache[scriptPath] = {name: moduleName, path: scriptPath, source: source};
                }
            },

            load: _.bind(function(href, method, headers, params, cbLoaded) {
                ++pending;

                var hrefParsed = url.parse(href, true);
                if (hrefParsed.hostname != document.location.hostname) {
                    fail({error: 500, body: "Only local hosts can be reached."});
                } else {
                    var options = {
                      host: hrefParsed.hostname || defaultHost,
                      port: hrefParsed.port || defaultPort,
                      path: hrefParsed.pathname + hrefParsed.search,
                    };

                    // If loadURL doesn't return fast enough we stop waiting for it and move on...
                    var timedOut = false;
                    var timeout = setTimeout(function() {
                        timedOut = true;
                        if (!--pending) {
                            finish(window.appjs.html);
                        }
                    }, loadTimeout);

                    process.nextTick(ibind(function() {
                        this._loadFromAPI(hrefParsed.pathname, method, headers, hrefParsed.query, params,
                            ibind(function(err, result) {
                                cbLoaded(err, result);
                                completeRequest();
                            }, cb, this)
                        );
                    }, cb, this));

                    function completeRequest() {
                        clearTimeout(timeout);
                        if (!timedOut && !--pending) {
                            var body = docType + '\n' + domToHtml(document, true);
                            finish(body);
                        }
                    }
                }
            }, this),
        };

        function finish(body) {
            finished = true;
            if (!document.statusCode || document.statusCode == 200) {
                cb(0, body);
            } else {
                cb({error: document.statusCode, body: body});
            }
        }

        window.document.baseURI = this.baseURLPath;
        // Yay, url.parse returns object with same properties as window.location object
        _.extend(window.location, URL);

        // XXXjoe Seems the console built into window does not log to stdout
        window.console = console;

        // XXXjoe These are buggy as of jsdom 0.2.0
        window.addEventListener = function() {}
        window.removeEventListener = function() {}

        var context = script.runInNewContext(window);
        
        // If no requests are pending, the page is done!
        if (!pending && !finished) {
            cb(0, window.appjs.html);
        }
    },

    _loadURL: function(URL, options, cb) {
        this.app.loadURL(URL, this, options, cb);
    },

    _loadFromAPI: function(href, method, headers, query, params, cb) {
        if (this.apiCache && (!method || method.toUpperCase() == "GET")) {
            this.apiCache.load(href, ibind(function(err, entry) {
                if (err || !entry || !entry.body || !entry.body.length) {
                    callAPI.apply(this);
                } else {
                    var body = typeof(entry.body) == 'object' ? entry.body+'' : entry.body;
                    cb(0, body);
                }
            }, cb, this));        
        } else {
            callAPI.apply(this);
        }

        function callAPI() {
            this.api.call(method, href, headers, query, params, {},
                ibind(function(err, result) {
                    if (err) {
                        cb(err);
                    } else {
                        var body = result.body;
                        body = (query.callback || '') + '(' + body + ')';
                        
                        var entry = {
                            key: href,
                            headers: {
                                etag: result.etag,
                                cacheControl: result.cacheControl
                            },
                            mimeType: "application/x-javascript; charset=UTF-8",
                            body: body
                        };

                        if (this.apiCache) {
                            this.apiCache.store(href, entry,
                                ibind(function(err) {
                                    cb(0, body);
                                }, this)
                            );
                        } else {
                            cb(0, body);
                        }
                    }
                }, cb, this)
            );            
        }
    },

    _renderPage: function(processedMap, options, cb) {
        this._scriptTags(this.builtinScripts, options, _.bind(function(err, scriptTags) {
            this._styleTags(options, _.bind(function(err, styleTags) {
                this._iconTags(options, _.bind(function(err, iconTags) {
                    if (options.content == "inline") {
                        scriptTags = '';
                    } else {
                        scriptTags += this._processedScriptTags(processedMap);
                    }

                    cb(0, 
                        docType+'\n'+
                        '<html'+
                        (this.app.language
                            ? ' lang="'+this.app.language+'"' : '')+
                        (this.app.offline && options.content != "inline"
                            ? ' manifest="' + this._renderURL(this.app.appcachePath) + '"' : '')+
                        '>\n'+
                        '<head>\n'+
                        (this.app.charset
                            ? '<meta charset="'+this.app.charset+'">\n'
                            : '')+
                        (this.app.title
                            ? '<title>'+this.app.title+'</title>\n'
                            : '')+
                        '<base href="'+this.baseURLPath+'">\n'+
                        iconTags+'\n'+
                        (this.app.viewport
                            ? '<meta name="viewport" content="'+this.app.viewport+'">\n'
                            : '')+
                        (this.app.webAppCapable
                            ? '<meta name="apple-mobile-web-app-capable" content="true">\n'
                            : '')+
                        (this.app.statusBarStyle
                            ? '<meta name="apple-mobile-web-app-status-bar-style" '+
                              'content="'+this.app.statusBarStyle+'">\n'
                            : '')+
                        (this.app.rss
                            ? '<link rel="alternate" type="application/rss+xml" title="RSS" href="'
                              + this.app.rss + '">\n' : '')+
                        scriptTags+'\n'+
                        styleTags+'\n'+
                        this._processedStyleTags(processedMap)+
                        (this.app.htmlHeader
                            ? this.app.htmlHeader+'\n'
                            : '')+
                        '</head>\n'+
                        '<body>\</body>\n'+
                        '</html>'
                    );
                }, this));
            }, this));
        }, this));
    },

    /**
     * Wraps a script in an AMD define call that will load each dependency in a separate request.
     *
     * require calls are found with a regex, which will pull in requires that are commented out
     * or inside of has('feature') branches that are never called.  Since this outputs code meant
     * for debugging, the imprecision is forgivable.
     */
    wrapScript: function(modulePath, source, options, cb) {
        var m, deps = [], depPaths = [];
        source = source+'';
        while (m = reRequire.exec(source)) {
            depPaths.push(m[1]);
            deps.push(m);
        }

        async.map(depPaths,
            _.bind(function(depPath, cb2) {
                pkg.searchScript(depPath, modulePath, cb2);
            }, this),
            abind(function(err, absolutePaths) {
                // Replace require statements with argument names of modules
                var depStrings = [];
                for (var i = 0; i < deps.length; ++i) {
                    var name = absolutePaths[i].name;
                    source = source.replace(deps[i][0], 'require("'+name+'")');
                    depStrings.push('"' + name + '"');
                }

                var params = ["require", "exports", "module"];

                source = '(function(' + params.join(', ') + ') {' + source + '})';

                var body = 'define("' + modulePath + '", ['
                           + depStrings.join(', ') + '], ' + source + ');';
                cb(0, {header: '', body: body});
            }, cb, this)
        );          
    },
    
    _getLatestTimestamp: function(category) {
        if (!category) {
            return this.app.startupTime;
        } else if (category in this.app.dependencies) {
            var maxTime = 0;
            _.each(this.app.dependencies[category], function(dep) {
                if (dep.mtime > maxTime) {
                    maxTime = dep.mtime;
                }
            });
            return maxTime;
        } else {
            return 0;
        }
    },

    _urlForCDN: function(URL, category) {
        var parsed = url.parse(URL);
        var timestamp = this._getLatestTimestamp(category);
        var path = parsed.pathname.replace(/\/app\.js\//,
                                           this.app.resourceBase + (timestamp ? "." + timestamp : "") + "/");
        parsed.protocol = 'http';
        parsed.host = this.app.cdn;
        parsed.pathname = path;

        return url.format(parsed);
    },

    _renderURL: function(URL, category) {
        if (this.app.cdn) {
            return this._urlForCDN(URL, category);
        } else {
            return URL;
        }
    },

    _tagForIconURL: function(iconName, iconURL) {
        var m;
        if (iconName == "favicon.ico") {
            return '<link rel="shortcut icon" href="' + iconURL + '">';
        } else if (m = /apple-touch-icon(-(\d+x\d+))?-precomposed\.png/.exec(iconName)) {
            var sizesAttr = m[2] ? ' sizes="'+m[2]+'"' : '';
            return '<link rel="apple-touch-icon-precomposed"'+sizesAttr+' href="' + iconURL + '">';
        } else if (m = /apple-touch-icon(-(\d+x\d+))?\.png/.exec(iconName)) {
            var sizesAttr = m[2] ? ' sizes="'+m[2]+'"' : '';
            return '<link rel="apple-touch-icon"'+sizesAttr+' href="' + iconURL + '">';
        } else if (m = /apple-touch-startup-image(-(\d+x\d+))?\.png/.exec(iconName)) {
            var sizesAttr = m[2] ? ' sizes="'+m[2]+'"' : '';
            return '<link rel="apple-touch-startup-image"'+sizesAttr+' href="' + iconURL + '">';
        } else {
            return '';
        }
    }
};

// *************************************************************************************************

function findRequireNode(node) {
    if (node.type == 'call' && node.left.type == 'name' && node.left.name == 'require') {
        var args = node.args;
        if (args.length == 1) {
            var pathNode = args[0];
            if (pathNode.type == 'string') {
                return pathNode;
            }
        }
    }        
}

function addTrailingSlash(s) {
    if (s && s.substr(s.length-1) == '/') {
        return s;
    } else {
        return s + '/';
    }
}

function encodeDataURL(sourcePath, source) {
    var mimeType = sourcePath ? mime.lookup(sourcePath) : '';
    var buf = new Buffer(source, 'binary');
    var b64 = buf.toString('base64');
    return '"data:'+mimeType+';base64,'+b64+'"';
}
