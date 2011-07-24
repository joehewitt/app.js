
var path = require('path'),
	url = require('url'),
	_ = require('underscore'),
	appjs = require('../lib/appjs'),
	Renderer = require('../lib/Renderer').Renderer,
	Server = require('../lib/Server');

exports.loadApp = require('./App').loadApp;
exports.Renderer = require('./Renderer').Renderer;
exports.configure = require('./Server').configure;

exports.run = function(argv) {
	var moduleName = argv._[0];

	if (!moduleName) {
		console.log("Module name required.");
	} else {
		appjs.loadApp(moduleName, argv.configName, {}, function(err, app) {
			if (err) { console.log('Unable to find module ' + moduleName); return; }

			if (argv.dependencies) {
				app.loader.traceDependencies(app.clientModuleName, true, function(err, results) {
					if (err) {
						console.error(err);					
					} else {
						var js = _.keys(results.js);
						console.log(JSON.stringify({
							js: js,
							css: results.css,
							icons: results.icons,
							images: results.images,
							has: results.has}, null, 4));
					}
				});
			} else if (argv.render) {	
				var targetURL = typeof(argv.render) == 'string' ? argv.render : '/';
				var localURL = url.format({protocol: 'http', hostname: "localhost", port:8081});
				var baseURL = "/";
				var renderer = new Renderer(app, localURL, baseURL);
				var options = _.clone(app.settings);
				for (var name in options) {
					if (name in argv) {
						options[name] = argv[name];
					}
				}

				app.loader.loadURL(targetURL, renderer, options, function(err, result) {
					if (result) {
						if (argv.body) {
							console.log(result.body);
						} else {
							console.log(JSON.stringify(result));
						}
					} else {
						console.log('{}');
					}
				});
			} else if (argv.server) {
				Server.listen(app, parseInt(argv.port), app.settings);
			}
		});	
	}
}
