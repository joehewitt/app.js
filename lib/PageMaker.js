
var path = require('path'),
	_ = require('underscore'),
	async = require('async'),
	jsdom = require('jsdom').jsdom;

var staticPath = '/static';
var docType = '<!DOCTYPE html>';

function PageMaker(app, localURL, baseURLPath) {
	this.app = app;
	this.localURL = localURL;
	this.baseURLPath = this._addTrailingSlash(baseURLPath);
	this.scripts = {};
	this.styles = {};
	this.builtinScripts = ['/app.js'];
}
exports.PageMaker = PageMaker;

PageMaker.prototype = {
	generatePage: function(options, cb) {
		// Look up dependencies so we can inline them
		this.app.loader.traceDependencies(this.app.moduleName, true,
			_.bind(function(err, results) {					
				if (err) { cb(err); return; }

				this.scripts = results.js;
				this.styles = results.css;

				this._generateSource(this.localURL, options, _.bind(function(err, processedMap) {
					this._generatePage(processedMap, options, _.bind(function(err, html) {
						this.renderContent(html, options, cb);
					}, this));
				}, this));
			}, this)
		);
	},

	metaTags: function() {
	    // ('title', '<title>%s</title>'),
	    // ('charset', '<meta charset="%s">'),
	    // ('viewport', '<meta name="viewport" content="%s">'),
	    // ('webAppCapable', '<meta name="apple-mobile-web-app-capable" content="%s">'),
	    // ('statusBarStyle', '<meta name="apple-mobile-web-app-status-bar-style" content="%s">'),
	    // ('touchIcon', '<link rel="apple-touch-icon" href="%s">'),
	    // ('startupImage', '<link rel="apple-touch-startup-image" href="%s">'),
	    // ('favicon', '<link rel="icon" href="%s">'),

		return '';		
	},

	scriptTags: function(urlPaths, options, cb) {
		if (options.inlineScripts) {
			async.map(urlPaths, _.bind(function(url, cb2) {
					this._loadURL(url, options, cb2);
				}, this),
				function(err, scriptBodies) {
					var tags = _.map(scriptBodies, function(scriptBody) {
						return '<script type="text/javascript">' + scriptBody.source +'</script>';
					}).join('\n');
					cb(0, tags);
				});
		} else {
			var tags = _.map(urlPaths, function(urlPath) {
				return '<script type="text/javascript" src="' + urlPath + '"></script>';
			}).join('\n');
			cb(0, tags);
		}
	},

	inlineScriptTags: function(moduleMap, options, cb) {
		if (options.inlineScripts) {
			async.map(_.keys(moduleMap),
				_.bind(function(name, cb2) {
					var pragmas = moduleMap[name];
					if (pragmas.debug) {
						cb2(0, '<script type="appjs/cached" id="appjs/js/'+name+'"></script>');
					} else {
						var url = this._urlForScript(name);
						this._loadURL(url, options, function(err, info) {
							if (err) { cb2(err); return; }

							cb2(0,
								'<script type="appjs/cached" id="appjs/js/'+name+'">'+
									info.source+
								'</script>'
							);
						});
					}
				}, this),
				_.bind(function(err, tags) {
					cb(0, tags.join('\n'));
				}, this)
			);
		} else {
			cb(0, '');
		}
	},

	processedScriptTags: function(items) {
		// XXXjoe So far we only support processed stylesheets
		return '';
	},

	styleTags: function(urlPaths, options, cb) {
		if (options.inlineStyles) {
			async.map(urlPaths, _.bind(function(urlPath, cb2) {
					this._loadURL(staticPath + '/' + urlPath, options, cb2);
				}, this),
				function(err, styleBodies) {
					if (err) { cb(err); return; }

					var tags = _.map(styleBodies, function(styleBody) {
						return '<style type="text/css">' + styleBody.source +'</style>';
					}).join('\n');
					cb(0, tags);
				});
		} else {
			var tags = _.map(urlPaths, function(urlPath) {
				return '<style type="text/css">@import "' + staticPath + '/' + urlPath + '";</style>';
			}).join('\n');
			cb(0, tags);
		}
	},

	processedStyleTags: function(items) {
		return '';		
	},

	renderContent: function(html, options, cb) {
		if (options.inlineContent) {
			var mainModule = require(this.app.moduleName);
		    if (mainModule.destination && mainModule.destination.render) {
		        global.document = jsdom(html, null, {features: {
			        ProcessExternalResources: false,
			        QuerySelector: ['1.0']
			    }});
		        mainModule.destination.render();

		        html = docType + document.outerHTML;
		    }
	        cb(0, html);
		} else {
			cb(0, html);
		}
	},

	_loadURL: function(url, options, cb) {
		var url = this._makeURLAbsolute(url);
		this.app.loader.loadURL(url, this, options, cb);
	},

	_generateSource: function(url, options, cb) {
		if (options.inlineScripts) {
			// XXXjoe Loads page in WebKit to generate special output
			// XXXjoe Run "appjsconvert this.localURL"
			cb(0, {});
		} else {
			cb(0, {});
		}
	},

	_generatePage: function(processedMap, options, cb) {
		this.inlineScriptTags(this.scripts, options, _.bind(function(err, inlineScriptTags) {
			this.scriptTags(this.builtinScripts, options, _.bind(function(err, scriptTags) {
				this.styleTags(this.styles, options, _.bind(function(err, styleTags) {
					cb(0, 
						docType+
						'<html'+
						(this.app.language ? ' lang="'+this.app.language+'"' : '')+
						' app="'+this.app.moduleName+'">'+
						'<head>'+
						'<base href="'+this.baseURLPath+'"/>'+
						this.metaTags()+
						styleTags+
						this.processedStyleTags(processedMap)+
						inlineScriptTags+
						this.processedScriptTags(processedMap)+
						'</head>'+
						'<body>'+
						scriptTags+
						'</body>'+
						'</html>'
					);
				}, this));
			}, this));
		}, this));
	},

	_urlForScript: function(moduleName) {
		var ext = path.extname(moduleName);
		if (!ext) {
			moduleName += '.js';
		}
		url = path.join(this.baseURLPath, 'js', moduleName);
		return url;
	},

	_makeURLAbsolute: function(url) {
		if (url[0] != '/') {
			return '/' + url;
		} else {
			return url;
		}
	},

	_addTrailingSlash: function(s) {
		if (s && s.substr(s.length-1) == '/') {
			return s;
		} else {
			return s + '/';
		}
	}
};
