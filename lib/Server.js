
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
	DiskCache = require('diskcache').DiskCache;

var defaultPort = 8081;
var localHost = 'localhost';
var baseURL = '/';
var defaultMimeType = 'text/plain';
var pageMimeType = 'text/html';

var reCrawlers = /googlebot|bingbot|slurp/i;

exports.listen = function(app, port, options) {
	var server = express.createServer();
    server.configure('development', function() {
        server.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
    });
	exports.configure(server, app, options);
	server.listen(port || defaultPort);
	D&&D('Listening on port %d', server.address().port);
}

exports.configure = function(server, app, options) {
	var localURL = url.format({protocol: 'http', hostname: localHost, port:defaultPort});
	var renderer = new Renderer(app, localURL, baseURL);
	var diskCache = new DiskCache(null, false, true, true);

	server.get('*', function getPage(req, res) {
		try {
			var cacheKey = req.url;//url.parse(req.url).pathname;
			cacheLoad(cacheKey, function(err, entry, initial) {
				if (err || !entry || !entry.body || !entry.body.length) {
					var URL = url.parse(req.url, true);
					var urlOptions = readOptions(URL.query, app.settings);
					if (isCrawler(req)) {
						urlOptions.content = 'inline';
					}

					urlOptions.userAgent = req.headers['user-agent'];

					app.loader.loadURL(URL, renderer, urlOptions, function(err, result) {
						if (err) {
							dandy.logException(err);
							res.send('Error: ' + err, {'Content-Type': 'text/html'}, 500);
						} else {
							cacheStore(cacheKey, result, function(err, entry) {
								monitor(entry);
								send(entry);
							});
						}
					});
				} else {
					if (initial) {
						monitor(entry);
					}
					send(entry);				
				}
			});

			function cacheLoad(cacheKey, cb) {
				if (diskCache) {
					diskCache.load(cacheKey, cb);	
				} else {
					cb(0, null);
				}
				
			}

			function cacheStore(cacheKey, result, cb) {
				if (diskCache) {
					diskCache.store(cacheKey, result, cb);	
				} else {
					cb(0, result);
				}
				
			}

			function monitor(result) {
				if (diskCache && (result.dependencies || result.path)) {
					var deps = result.dependencies
						? _.pluck(result.dependencies, 'path')
						: [result.path];
					diskCache.monitor(cacheKey, null, deps, function(err, url) {
						renderer.invalidateContentScript();
					});
				}
			}

			function send(result) {
				var headers = {};

				var mimeType = result.mimeType || (result.path
					? mime.lookup(result.path) || defaultMimeType
					: pageMimeType);
				
				headers['Content-Type'] = mimeType;
				headers['Date'] = new Date()+'';
				headers['Vary'] = 'Accept-Encoding';
				headers['Server'] = 'App.js';

				var latestTime = findLatestMtime(result.dependencies || []);
				if (latestTime) {
					headers['ETag'] = latestTime;
				}

				if (result.permanent) {
					headers['Cache-Control'] = 'public, max-age=31536000';
				} else {
					headers['Cache-Control'] = 'public, max-age=0';
				}

				var ifNoneMatch = req.headers['if-none-match'];
				if (ifNoneMatch && ifNoneMatch == latestTime) {
					res.send('', headers, 304);
				} else {
					var body = result.body;
					if (result.bodyZipped && requestAccepts(req, 'gzip')) {
						headers['Content-Encoding'] = 'gzip';
						body = result.bodyZipped;
					}

					res.send(body, headers, 200);						
				}
			}
		} catch (exc) {
			dandy.logException(exc);
			res.send('Error: ' + exc, {'Content-Type': 'text/html'}, 500);
		}
	});

	return server;
}

function readOptions(query, defaults) {
	var viewSource = 'viewsource' in query;
	return {
		js: 'js' in query ? query.js : (viewSource ? 'source' : defaults.js),
		css: 'css' in query ? query.css : (viewSource ? 'source' : defaults.css),
		images: 'images' in query ? query.images : (viewSource ? 'source' : defaults.images),
		content: 'content' in query ? query.content : (viewSource ? 'source' : defaults.content),
	};
}

/**
 * Defers render to a child process. Not currently used.
 */
function render(requestURL, options, app, cb) {
	var URL = url.parse(requestURL, true);
	var urlPath = URL.pathname;
	var urlOptions = readOptions(URL.query, options);

	var args = [app.modulePath, '--render', urlPath];
	for (var key in urlOptions) {
		if (urlOptions[key] !== undefined) {
			args.push('--' + key, urlOptions[key]);
		}
	}

	var output = [];
	var error = false;

	var appjsPath = path.normalize(path.join(__dirname, '..', 'bin', 'appjs'));
	var command = spawn(appjsPath, args);
	command.stdout.on('data', function(data) {
		output.push(data);	
	});
	command.stderr.on('data', function(data) {
		error = true;
		output.push(data);	
	});
	command.on('exit', function(code) {
		if (error) {
			cb(output.join(''));
		} else {
			var js = output.join('');
			try {
				var obj = js && js != 'undefined' ? JSON.parse(js) : null;
				if (obj && obj.raw) {
					fs.readFile(obj.path, abind(function(err, source) {
						obj.body = source;
						cb(0, obj);
					}, cb, this));
				} else {
					cb(0, obj);
				}
			} catch (exc) {
				dandy.logException("Error parsing " + js);
				cb(exc);
			}
		}
	});
	
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

function requestAccepts(req, encoding) {
	var accepts	= 'accept-encoding' in req.headers ? req.headers['accept-encoding'].split(/\s*,\s*/) : [];
	return accepts.indexOf(encoding) != -1;
}

function isCrawler(req) {
	var userAgent = req.headers['user-agent'];
	return !!reCrawlers.exec(userAgent);
}
