
var express = require('express');

var appjs = require('./appjs');
var PageMaker = require('./PageMaker').PageMaker;
var Loader = require('./Loader').Loader;

var defaultPort = 8081;

function serve(moduleName, port) {
    port = port || defaultPort;

	var loader = new Loader();
	appjs.loadApp(moduleName, loader, function(err, app) {
		if (err) { console.log('Unable to find module ' + moduleName); return; }

		var maker = new PageMaker(app, 'http://localhost'+port, '/', true, true);

		var server = express.createServer();
		server.get('*', getPage);

	    server.configure('development', function() {
	        server.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
	    });

		server.listen(port);
	    console.log("Listening on port " + port);

		function getPage(req, res) {
			loader.load(req.url, true, true, function(err, content) {
				if (err) {
					res.send('Error: ' + err, {'Content-Type': 'text/html'}, 500);
				} else {
					res.send(content.source, {'Content-Type': 'text/html'}, 200);				
				}
			});
		}
	});
}

exports.serve = serve;
