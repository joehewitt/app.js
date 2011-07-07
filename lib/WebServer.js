
var express = require('express'),
	mime = require('mime'),
	url = require('url'),
	spawn = require('child_process').spawn,
	path = require('path'),
	_ = require('underscore'),
	appjs = require('./appjs'),
	Renderer = require('./Renderer').Renderer,
	Loader = require('./Loader').Loader;

var defaultPort = 8081;
var localHost = 'localhost';
var baseURL = '/';
var defaultMimeType = 'text/plain';
var pageMimeType = 'text/html';

exports.listen = function(app, port, options) {
    port = port || defaultPort;

	var expressApp = express.createServer();
    expressApp.configure('development', function() {
        expressApp.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
    });
	exports.configure(expressApp, app, options);
	expressApp.listen(port);
	console.log('Listening on port ' + port);
}

exports.configure = function(expressApp, app, options) {
	var localURL = url.format({protocol: 'http', hostname: localHost, port:defaultPort});
	var renderer = new Renderer(app, localURL, baseURL);

	expressApp.get('*', function getPage(req, res) {
		try {
			render(req.url, options, app, function(err, content) {
				if (err) {
					res.send('Error: ' + err, {'Content-Type': 'text/html'}, 500);
				} else {
					var mimeType = content.path
						? mime.lookup(content.path) || defaultMimeType
						: pageMimeType;
					res.send(content.source, {'Content-Type': mimeType}, 200);				
				}
			});
		} catch (exc) {
			console.log(exc.stack);
			res.send('Error: ' + exc, {'Content-Type': 'text/html'}, 500);
		}
	});

	return expressApp;
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
	var args = [app.moduleName, '--client', app.clientModuleName, '--render', urlPath];
	for (var key in urlOptions) {
		args.push('--' + key, urlOptions[key]);
	}

	var output = [];

	var appjsPath = path.normalize(path.join(__dirname, '..', 'bin', 'appjs'))
	var command = spawn(appjsPath, args);
	command.stdout.on('data', function(data) {
		output.push(data);	
	});
	command.stderr.on('data', function(data) {
		cb(data+'');
	});
	command.on('exit', function(code) {
		var js = output.join('');
		var obj = JSON.parse(js);
		cb(0, obj);
	});
	
}