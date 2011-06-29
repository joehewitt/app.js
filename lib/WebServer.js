
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

function serve(moduleName, port) {
    port = port || defaultPort;

	var loader = new Loader();
	appjs.loadApp(moduleName, loader, function(err, app) {
		if (err) { console.log('Unable to find module ' + moduleName); return; }

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
				var inline = ('inline' in URL.query ? URL.query.inline != 'false' : true);
				var inlineContent = false;
				var compress = ('compress' in URL.query ? URL.query.compress != 'false' : true);
				
				var localURL = url.format({protocol: 'http', hostname: localHost, port:port});
				var maker = new PageMaker(app, localURL, baseURL, inline, inlineContent, compress);

				loader.loadURL(URL.pathname, maker, compress, function(err, content) {
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
	});
}

exports.serve = serve;
