
var express = require('express'),
	mime = require('mime'),
	url = require('url'),
	spawn = require('child_process').spawn,
	path = require('path'),
	_ = require('underscore'),
	dandy = require('dandy/errors'),
	appjs = require('./appjs'),
	Renderer = require('./Renderer').Renderer,
	Loader = require('./Loader').Loader,
	dandy = require('dandy/errors');

var defaultPort = 8081;
var localHost = 'localhost';
var baseURL = '/';
var defaultMimeType = 'text/plain';
var pageMimeType = 'text/html';

exports.listen = function(app, port, options) {
	var server = express.createServer();
    server.configure('development', function() {
        server.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
    });
	exports.configure(server, app, options);
	server.listen(port || defaultPort);
	console.log('Listening on port %d', server.address().port);
}

exports.configure = function(server, app, options) {
	var localURL = url.format({protocol: 'http', hostname: localHost, port:defaultPort});
	var renderer = new Renderer(app, localURL, baseURL);

	server.get('*', function getPage(req, res) {
		try {
			render(req.url, options, app, function(err, content) {
				if (err) {
					dandy.logException(err);
					res.send('Error: ' + err, {'Content-Type': 'text/html'}, 500);
				} else {
					var mimeType = content.path
						? mime.lookup(content.path) || defaultMimeType
						: pageMimeType;
					res.send(content.source, {'Content-Type': mimeType}, 200);				
				}
			});
		} catch (exc) {
			dandy.logException(exc);
			res.send('Error: ' + exc, {'Content-Type': 'text/html'}, 500);
		}
	});

	return server;
}

function readOptions(query, defaults) {
	return {
		inlineScripts: 'inlineScripts' in query ? query.inlineScripts != 'false'
					   : ('inline' in query ? query.inline != 'false' : defaults.inlineScripts),
		inlineStyles: 'inlineStyles' in query ? query.inlineStyles != 'false'
					   : ('inline' in query ? query.inline != 'false' : defaults.inlineStyles),
		inlineImages: 'inlineImages' in query ? query.inlineImages != 'false'
					   : ('inline' in query ? query.inline != 'false' : defaults.inlineImages),
		inlineContent: 'inlineContent' in query ? query.inlineContent != 'false'
					   : ('inline' in query ? query.inline != 'false' : defaults.inlineContent),
		compress: query.compress != 'false',
	};
}

function render(requestURL, options, app, cb) {
	var URL = url.parse(requestURL, true);
	var urlPath = URL.pathname;
	var urlOptions = readOptions(URL.query, options);
	var args = [app.moduleName, '--render', urlPath];
	for (var key in urlOptions) {
		if (urlOptions[key] !== undefined) {
			args.push('--' + key, urlOptions[key]);
		}
	}

	var output = [];
	var error = false;

	var appjsPath = path.normalize(path.join(__dirname, '..', 'bin', 'appjs'))
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
				var obj = js ? JSON.parse(js) : '';
				cb(0, obj);
			} catch (exc) {
				dandy.logException(exc, "Error parsing " + js);
				cb(exc);
			}
		}
	});
	
}