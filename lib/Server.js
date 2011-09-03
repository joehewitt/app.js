
var express = require('express'),
	mime = require('mime'),
	url = require('url'),
	spawn = require('child_process').spawn,
	path = require('path'),
	fs = require('fs'),
	_ = require('underscore'),
	dandy = require('dandy/errors'),
	appjs = require('./appjs'),
	Renderer = require('./Renderer').Renderer,
	Loader = require('./Loader').Loader,
	dandy = require('dandy/errors'),
	abind = require('dandy/errors').abind,
	cacheware = require('diskcache').middleware;

var defaultPort = 8081;
var localHost = 'localhost';
var baseURL = '/';
var defaultMimeType = 'text/plain';
var htmlMimeType = 'text/html';

var reCrawlers = /googlebot|bingbot|slurp/i;
var reCDNs = /Amazon\sCloudFront/i;

// *************************************************************************************************

exports.listen = function(app, port, options) {
	var server = express.createServer();
    server.configure('development', function() {
        server.use(express.errorHandler({dumpExceptions: true, showStack: true})); 
    });
	exports.route(server, app, options);
	server.listen(port || defaultPort);
	D&&D('Listening on port %d', server.address().port);
}

exports.route = function(server, app, api, apiCache, options) {
	var localURL = url.format({protocol: 'http', hostname: localHost, port:defaultPort});
	var renderer = new Renderer(app, api, apiCache, localURL, baseURL);
	app.cache.on('unmonitor', function() {
		renderer.invalidateContentScript();
	});

	var cacheMiddleware = options.disableCache ? noop : cacheware(app.cache);
	server.get('*', cacheMiddleware, serveApp);

	function noop(req, res, next) {
		next();	
	}

	function serveApp(req, res) {
		var URL = url.parse(req.url, true);
		var urlOptions = readOptions(URL.query, app.settings);
		if (isCrawler(req)) {
			urlOptions.content = 'inline';
		}

		urlOptions.userAgent = req.headers['user-agent'];

		app.loader.loadURL(req.url, renderer, urlOptions, function(err, result) {
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

				if (result.permanent || isCDN(req)) {
					res.header('Cache-Control', 'public, max-age=31536000');
				} else {
					res.header('Cache-Control', 'public, max-age=0');
				}				
			}

			res.send(result.body, result.error || 200);
		}
	}

	return server;
}

function readOptions(query, defaults) {
	var viewSource = 'viewsource' in query;
	return {
		js: 'js' in query ? query.js : (viewSource ? 'source' : defaults.js),
		css: 'css' in query ? query.css : (viewSource ? 'source' : defaults.css),
		images: 'images' in query ? query.images : (viewSource ? 'source' : defaults.images),
		content: 'content' in query ? query.content : (viewSource ? 'source' : defaults.content),
		icons: 'icons' in query ? query.icons : (viewSource ? 'source' : defaults.icons),
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

/**
 * Defers render to a child process. Not currently used.
 */
// function render(requestURL, options, app, cb) {
// 	var URL = url.parse(requestURL, true);
// 	var urlPath = URL.pathname;
// 	var urlOptions = readOptions(URL.query, options);

// 	var args = [app.modulePath, '--render', urlPath];
// 	for (var key in urlOptions) {
// 		if (urlOptions[key] !== undefined) {
// 			args.push('--' + key, urlOptions[key]);
// 		}
// 	}

// 	var output = [];
// 	var error = false;

// 	var appjsPath = path.normalize(path.join(__dirname, '..', 'bin', 'appjs'));
// 	var command = spawn(appjsPath, args);
// 	command.stdout.on('data', function(data) {
// 		output.push(data);	
// 	});
// 	command.stderr.on('data', function(data) {
// 		error = true;
// 		output.push(data);	
// 	});
// 	command.on('exit', function(code) {
// 		if (error) {
// 			cb(output.join(''));
// 		} else {
// 			var js = output.join('');
// 			try {
// 				var obj = js && js != 'undefined' ? JSON.parse(js) : null;
// 				if (obj && obj.raw) {
// 					fs.readFile(obj.path, abind(function(err, source) {
// 						obj.body = source;
// 						cb(0, obj);
// 					}, cb, this));
// 				} else {
// 					cb(0, obj);
// 				}
// 			} catch (exc) {
// 				dandy.logException("Error parsing " + js);
// 				cb(exc);
// 			}
// 		}
// 	});
// }
