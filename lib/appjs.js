
var fs = require('fs'),
    path = require('path'),
    ncp = require('ncp').ncp,
    mkdirsSync = require('mkdir').mkdirsSync,
    http = require('http'),
    _ = require('underscore'),
    async = require("async"),
    dandy = require("dandy/errors"),
    abind = require("dandy/errors").abind,
    ibind = require("dandy/errors").ibind,
    assert = require('assert').ok,
    express = require('express'),
    logger = require('express-logger'),
    rewriter = require('express-rewrite'),
    Cache = require('diskcache').Cache,
    App = require('./App').App,
    pkg = require('./pkg'),
    utils = require('./utils');

// *************************************************************************************************

var defaultPort = 8080;

// *************************************************************************************************

exports.run = function(argv) {
    if (argv.pack) {
        process.env.NODE_ENV = 'production';
        process.env.APPJSPACK = true;
    }

    createServersFromConf(argv, function(err, servers) {
        if (err || !servers.length) {
            dandy.logException("No sites loaded.");
        } else {
            if (argv.pack) {
                var port = 8081;
                var server = getPackServer(servers, argv.pack);
                var httpServer = server.listen(port);

                if (server.appVersion) {
                    server.appVersion = incrementRepoVersion(server.appVersion);
                } else {
                    server.appVersion = 'v0.0';
                }

                console.log('Creating version', server.appVersion);

                saveRepoVersion(server.repoPath, server.appVersion);
                server.appjsApp.appVersion = server.appVersion;

                packServer(server, port, function(err) {
                    if (err) {
                        console.log(err);
                    } else {
                        console.log('done.');
                    }
                    process.exit(0);
                });
            } else {
                var port = argv.port || defaultPort;
                var server = getMainServer(servers, argv);
                server.listen(port);
                console.log("App.js server listening on port %d (%s)", server.address().port,
                            new Date());
            }
        }       
    });
}

exports.route = function(conf) {
    var app = new App(conf);
    return app.route(); 
}

exports.App = App;
exports.searchScript = pkg.searchScript;
exports.searchStatic = pkg.searchStatic;
exports.shortenStaticPath = pkg.shortenStaticPath;

// *************************************************************************************************

function createServersFromConf(argv, cb) {
    var confs = readConf(argv);
    async.map(confs, ibind(function(conf, cb2) {
        createSiteServer(conf, argv, cb2);
    }), cb);
}

function readConf(argv) {
    if (argv._[0]) {
        try {
            var confPath = argv._[0];
            var content = fs.readFileSync(confPath, 'utf8');
            var confs = JSON.parse(content);
            if (!(confs instanceof Array)) {
                confs = [confs];
            }
            return confs;
        } catch (exc) {
            console.error("Unable to read conf at %s", confPath);
        }
    } else {
        return [argv];
    }
}

function getMainServer(servers) {
    if (servers.length == 1) {
        return servers[0];
    } else {
        var hub = express.createServer();

        servers.forEach(function(server) {
            hub.use(express.vhost(server.host, server));
            hub.use(express.vhost('*.' + server.host, server));
        });
        hub.use(hub.router);
        hub.get("*", function(req, res) {
            res.send('Nothing to see here.', {'Content-Type': 'text/plain'}, 200);
        });
        return hub;
    }   
}

function getPackServer(servers, host) {
    for (var i = 0, l = servers.length; i < l; ++i) {
        var server = servers[i];
        if (server.host == host) {
            return server;
        }
    }
}

function createSiteServer(conf, argv, cb) {
    assert(conf.host, "No host specified.");
    assert(conf.app, "No app module specified.");

    var server = express.createServer();
    server.conf = conf;

    server.host = conf.host;
    server.repoPath = fixPath(conf.repo); 
    server.appPath = fixPath(conf.app);
    server.logsPath = fixPath(conf.logs);
    server.cachesPath = fixPath(conf.caches);

    if (server.repoPath) {
        server.appVersion = loadRepoVersion(server.repoPath);
    }

    server.rewrite = _.bind(rewriter.rewrite, server);

    server.configure(function() {
        server.use(rewriter);
        server.use(defaultMiddleware);
        server.use(express.query());
        server.use(express.bodyParser());
        server.use(express.cookieParser());
    
        if (server.logsPath) {
            server.use(logger({path: server.logsPath}));
        }

        server.use(server.router);
    });

    server.configure('development', function() {
        server.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
    });

    server.configure('production', function() {
        server.use(express.errorHandler()); 
    });

    if (server.cachesPath && !argv.disableCache) {
        server.diskCache = new Cache(server.cachesPath, !!server.cachesPath, true, true);
    }

    var appPath = require.resolve(server.appPath);
    pkg.findPackageInfo(appPath, abind(function(err, result) {
        server.appName = result.info.name;
        server.appPackage = result.info;

        var app = require(server.appPath);
        app(server, conf);

        if (server.appjsApp) {
            server.appjsApp.appVersion = server.appVersion;            
        }

        cb(0, server);
    }, cb, this));
           
    // blog.configure(server);

    // var middleware = options.disableCache ? null : [cacheware(blog.cache)];

    // syndicate.route(server, blog, middleware);
    // blog.api.route(server, middleware);
    // appjs.route(server, blog.app, blog.api, blog.cache, options || {});
}

function defaultMiddleware(req, res, next) {
    res.setHeader('Date', new Date()+'');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Server', 'App.js');
    
    res.sendSafely = utils.sendSafely;
    next();    
}

function fixPath(thePath) {
    return thePath ? thePath.replace(/^~/, process.env.HOME) : '';
}

// *************************************************************************************************

function packServer(server, port, cb) {
    var app = server.appjsApp;
    var urlBase = 'http://localhost:' + port;
    var urls = [
        '/favicon.ico',
        '/app.js/cache.manifest',
        '/app.js/js',
        '/app.js/css',
    ];

    var remaining = urls.length+1;
    var urlMap = {
        '/': '/index.html',
    };
    for (var i = 0, l = urls.length; i < l; ++i) {
        var url = urls[i];
        urlMap[url] = url;
    }

    var versionPath = path.join(server.repoPath, server.appVersion);
    mkdirsSync(versionPath);

    for (var urlPath in urlMap) {
        var destPathFragment = urlMap[urlPath];
        var destPath = path.join(versionPath, destPathFragment);
        var url = urlBase + urlPath;
        downloadFile(url, destPath, function(err) {
            if (--remaining == 0) {
                downloadStaticFiles(server, function(err) {
                    cb(err);
                });
            }
        });
    }
}

function downloadStaticFiles(server, cb) {
    var app = server.appjsApp;

    pkg.searchStatic(app.packageName, app.paths, abind(function(err, staticPath) {
        var destStaticPath = path.join(server.repoPath, server.appVersion, 'app.js', 'static',
                                       app.packageName);
        mkdirsSync(destStaticPath);
        ncp(staticPath, destStaticPath, function(err) {
            cb(err);
        })
    }, cb, this));
}

function downloadFile(url, destPath, cb) {
    var chunks = [];
    http.get(url, function(res) {
        res.on('data', function (chunk) {
            chunks[chunks.length] = chunk;
        });
        res.on('end', function () {
            var data = chunks.join('');

            var dirPath = path.dirname(destPath);
            mkdirsSync(dirPath);

            fs.writeFile(destPath, data, function(err) {
                console.log('Downloaded', url, 'to', destPath);
                cb(err);
            });
        });
    }).on('error', function(e) {
      cb(e);
    });
}

function loadRepoVersion(repoPath) {
    var versionPath = path.join(repoPath, 'version.json');
    try {
        var versionJson = fs.readFileSync(versionPath);
        if (versionJson) {
            return JSON.parse(versionJson).version;
        }        
    } catch (exc) {
        return null;
    }
}

function saveRepoVersion(repoPath, version) {
    var versionPath = path.join(repoPath, 'version.json');
    var json = JSON.stringify({version: version});
    fs.writeFileSync(versionPath, json);
}

function incrementRepoVersion(version) {
    var parts = version.split('.');
    parts[parts.length-1] = parseInt(parts[parts.length-1]) + 1;
    return parts.join('.');
}
