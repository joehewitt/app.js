
var fs = require('fs'),
    path = require('path'),
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
    createServersFromConf(argv, function(err, servers) {
        if (err || !servers.length) {
            dandy.logException("No sites loaded.");
        } else {
            var server = getMainServer(servers, argv);
            server.listen(argv.port || defaultPort);
            console.log("App.js server listening on port %d (%s)", server.address().port, new Date());
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

function getMainServer(servers, argv) {
    if (servers.length == 1) {
        return servers[0];
    } else {
        var hub = express.createServer();

        servers.forEach(function(server) {
            hub.use(express.vhost('*.' + server.host, server));
        });
        hub.use(hub.router);
        hub.get("*", function(req, res) {
            res.send('Nothing to see here.', {'Content-Type': 'text/plain'}, 200);
        });
        return hub;
    }   
}

function createSiteServer(conf, argv, cb) {
    assert(conf.host, "No host specified.");
    assert(conf.app, "No app module specified.");

    var server = express.createServer();
    server.conf = conf;

    server.host = conf.host;
    server.appPath = fixPath(conf.app);
    server.logsPath = fixPath(conf.logs);
    server.cachesPath = fixPath(conf.caches);

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

        // Add the parent directory of the module to the search path so it can be
        // required by name without the full path
        require.paths.unshift(path.resolve(result.path, '..', '..'));

        var app = require(server.appPath);
        app(server, conf);

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
    return thePath.replace(/^~/, process.env.HOME);
}
