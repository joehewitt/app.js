
var express = require('express'),
	mime = require('mime'),
	url = require('url');

var appjs = require('./appjs'),
	PageMaker = require('./PageMaker').PageMaker,
	Loader = require('./Loader').Loader;

var defaultPort = 8081;
var localHost = 'localhost';
var baseURL = '/';
var defaultMimeType = 'text/plain';
var pageMimeType = 'text/html';

function serve(app, port, options) {
    port = port || defaultPort;

	var localURL = url.format({protocol: 'http', hostname: localHost, port:port});
	var pageMaker = new PageMaker(app, localURL, baseURL);

	var server = express.createServer();
	server.get('*', getPage);

    server.configure('development', function() {
        server.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
    });

	server.listen(port);
    console.log("Listening on port " + port);

	function getPage(req, res) {
		try {
			var URL = url.parse(req.url, true);
			var newOptions = readOptions(URL.query, options);

			app.loader.loadURL(URL.pathname, pageMaker, newOptions, function(err, content) {
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
	}
}

function readOptions(query, defaults) {
	return {
		inlineScripts: 'inlineScripts' in query ? query.inlineScripts != 'false'
					   : ('inline' in query ? query.inline != 'false' : defaults.inlineScripts),
		inlineStyles: 'inlineStyles' in query ? query.inlineStyles != 'false'
					   : ('inline' in query ? query.inline != 'false' : defaults.inlineStyles),
		inlineImages: 'inlineImages' in query ? query.inlineImages != 'false'
					   : ('inline' in query ? query.inline != 'false' : defaults.inlineImages),
		inlineImages: 'inlineImages' in query ? query.inlineImages != 'false'
					   : ('inline' in query ? query.inline != 'false' : defaults.inlineImages),
		compress: query.compress != 'false',
	};
}

exports.serve = serve;
