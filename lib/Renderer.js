
var path = require('path'),
	fs = require('fs'),
	_ = require('underscore'),
	async = require('async'),
	jsdom = require('jsdom').jsdom,
	cssmin = require('cssmin').cssmin,
	uglify = require("uglify-js"),
	mime = require('mime'),
	abind = require('dandy/errors').abind;

var staticPath = '/app.js/static';
var jsPath = '/app.js/js';
var cssPath = '/app.js/css';

var docType = '<!DOCTYPE html>';

var reRequire = /require\s*\(\s*["'](.*?)["']\s*\)/g;
var reCSSURL = /url\("?(.*?)"?\)/g;

exports.Renderer = function(app, localURL, baseURLPath) {
	this.app = app;
	this.localURL = localURL;
	this.baseURLPath = this._addTrailingSlash(baseURLPath);
	this.builtinScripts = ['/app.js'];
}

exports.Renderer.prototype = {
	renderPage: function(url, options, cb) {
		this._renderSource(this.localURL, options, _.bind(function(err, processedMap) {
			this._renderPage(processedMap, options, _.bind(function(err, html) {
				this.renderContent(url, html, options, cb);
			}, this));
		}, this));
	},

	renderScript: function(scriptPath, modulePath, options, relink, cb) {
		fs.stat(scriptPath, abind(function(err, stat) {
			var sections = [];

			if (options.inlineScripts && relink) {
				this._loadURL('/app.js', options, abind(phase2, cb, this));
			} else {
				phase2.apply(this, [0]);
			}

			function phase2(err, data) {
				if (options.inlineScripts && relink) {
					var source = data.source;
					if (options.compress) {
						source = this.compressJavaScript(source);
					}
					sections.push(source);

					this._traceDependencies(modulePath, abind(phase3, cb, this));
				} else {
					phase3.apply(this, [0]);
				}
			}

			function phase3(err, dependencies) {
				if (options.inlineScripts && relink) {
					async.map(_.keys(dependencies.js),
						_.bind(function(depPath, cb2) {
							if (depPath != modulePath) {
								var js = dependencies.js[depPath].source;
								this._relinkScript(depPath, js, true, true,
									abind(function(err, js) {
										sections.push(js);
										cb2(0);
									}, cb, this)
								);
							} else {
								cb2(0);
							}
						}, this),
						abind(phase4, cb, this)
					);
				} else {
					phase4.apply(this, [0]);					
				}
			}
			
			function phase4(err) {
				fs.readFile(scriptPath, abind(function(err, data) {
					if (relink) {
						this._relinkScript(modulePath, data, false, options.compress,
										  abind(phase5, cb, this));	
					} else {
						phase5.apply(this, [0, data]);
					}

					function phase5(err, data) {
						sections.push(data+'');
						var result = sections.join(';');

						cb(0, result);
					}

				}, cb, this));
			}
		}, cb, this));
	},

	renderStylesheet: function(options, cb) {
		var sections = [];

		if (options.inlineStyles) {
			this._traceDependencies(this.app.clientModuleName, abind(phase2, cb, this));
		} else {
			phase2.apply(this, [0, {}]);
		}

		function phase2(err, dependencies) {
			async.map(dependencies.css || [],
				_.bind(function(depPath, cb2) {
					this.app.loader.searchStatic(depPath, abind(function(err, filePath) {
						fs.readFile(filePath, abind(function(err, data) {
							var baseURL = staticPath + '/' + depPath;
							this.compressCSS(data+'', baseURL, options,
								function(err, data) {
									sections.push(data);
									cb2(0);
								});
						}, cb, this));
					}, cb, this));
				}, this),
				abind(phase3, cb, this)
			);
		}

		function phase3(err) {
			var source = sections.join('');
			cb(0, source);
		}

		function phase4(err) {
			cb(0, source);
		}
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
		var params = [];
		if (!options.inlineScripts) {
			params.push('inline=false');
		}
		if (!options.compress) {
			params.push('compress=false');
		}
		var q = (params.length ? '?' + params.join('&') : '');

		var tags = options.inlineScripts ? [] : _.map(urlPaths, scriptTagForURL);
		tags.push(scriptTagForURL(jsPath));
		cb(0, tags.join('\n'));

		function scriptTagForURL(urlPath) {
			return '<script type="text/javascript" src="' + urlPath + q + '"></script>';
		}
	},

	processedScriptTags: function(items) {
		// XXXjoe So far we only support processed stylesheets
		return '';
	},

	styleTags: function(options, cb) {
		var params = [];
		if (!options.inlineImages) {
			params.push('inlineImages=false');
		}
		if (!options.compress) {
			params.push('compress=false');
		}
		var q = (params.length ? '?' + params.join('&') : '');

		if (options.inlineStyles) {
			var tag = '<style type="text/css">@import "' + cssPath + q + '";</style>';
			cb(0, tag);
		} else {
			this._traceDependencies(this.app.clientModuleName,
				abind(function(err, results) {
					var tags = _.map(results.css, function(urlPath) {
						var cssPath = staticPath + '/' + urlPath + q;
						return '<style type="text/css">@import "' + cssPath + '";</style>';
					}).join('\n');
					cb(0, tags);
				}, cb, this)
			);
		}
	},

	processedStyleTags: function(items) {
		return '';		
	},

	renderContent: function(url, html, options, cb) {
		if (options.inlineContent) {
			this._initHTMLGlobals(html);

			var mainModule = require(this.app.clientModuleName);
		    if (mainModule.router) {
			    if (mainModule.ready) {
					mainModule.ready();    
				}

		        if (!mainModule.router(url, '/')) {
		        	cb("Not found");
		        	return;
		        }

		        html = docType + document.outerHTML;
		    }
	        cb(0, html);
		} else {
			cb(0, html);
		}
	},

	_initHTMLGlobals: function(html) {
    	_.each(this._getHTMLGlobals(html), function(value, key) {
    		global[key] = value;
    	});		
	},

	_getHTMLGlobals: function(html) {
    	var document = jsdom(html, null, {
        	features: {
      	  		ProcessExternalResources: false,
	        	QuerySelector: ['1.0']
	    	}
	   	});
	   	var window = document.createWindow();
	   	return {
		   	window: window,
		   	document: document,
		   	location: window.location,
		   	navigator: window.navigator
		};
	},

	_loadURL: function(url, options, cb) {
		var url = this._makeURLAbsolute(url);
		this.app.loader.loadURL(url, this, options, cb);
	},

	_traceDependencies: function(moduleName, cb) {
		this._initHTMLGlobals('');
		this.app.loader.traceDependencies(moduleName, false, cb);
	},

	_renderSource: function(url, options, cb) {
		if (options.inlineScripts) {
			// XXXjoe Loads page in WebKit to render special output
			// XXXjoe Run "appjsconvert this.localURL"
			cb(0, {});
		} else {
			cb(0, {});
		}
	},

	_renderPage: function(processedMap, options, cb) {
		this.scriptTags(this.builtinScripts, options, _.bind(function(err, scriptTags) {
			this.styleTags(options, _.bind(function(err, styleTags) {
				cb(0, 
					docType+
					'<html'+
					(this.app.language ? ' lang="'+this.app.language+'"' : '')+
					'>'+
					'<head>'+
					'<base href="'+this.baseURLPath+'"/>'+
					this.metaTags()+
					styleTags+
					this.processedStyleTags(processedMap)+
					'</head>'+
					'<body>'+
					scriptTags+
					this.processedScriptTags(processedMap)+
					'</body>'+
					'</html>'
				);
			}, this));
		}, this));
	},

	_relinkScript: function(modulePath, source, freeze, compress, cb) {
		// Find all require statements
		var m, deps = [], depPaths = [];
		source = source+'';
		while (m = reRequire.exec(source)) {
			depPaths.push(m[1]);
			deps.push(m);
		}

		async.map(depPaths,
			_.bind(function(depPath, cb2) {
				this.app.loader.searchScript(depPath, modulePath, cb2);
			}, this),
			abind(function(err, absolutePaths) {
				// Replace require statements with argument names of modules
				var depStrings = [], depNames = [];
				for (var i = 0; i < deps.length; ++i) {
					depStrings.push('"' + absolutePaths[i].name + '"');
					depNames.push('__mod'+i);
					source = source.replace(deps[i][0], '__mod'+i);
				}

				depStrings.push('"exports"');
				depNames.push("exports");

				source = '(function(' + depNames.join(', ') + ') {' + source + '})';
				if (compress) {
					source = this.compressJavaScript(source);
				}

				if (freeze) {
					cb(0, 'define("' + modulePath + '", [' + depStrings.join(', ') + '], '
						   + JSON.stringify('('+source+')') + ');');
				} else {
					cb(0, 'define("' + modulePath + '", [' + depStrings.join(', ') + '], '
						  + source + ');');
				}
			}, cb, this)
		);			
	},

	compressJavaScript: function(source) {
		try {
			var pro = uglify.uglify;
			var ast = uglify.parser.parse(source);
			ast = pro.ast_mangle(ast, {toplevel: true});
			ast = pro.ast_squeeze(ast);
			return pro.gen_code(ast);
		} catch (exc) {
			// console.log('PARSE ERROR', exc);
			// console.log(exc.stack);
			return source;
		}
	},
	
	compressCSS: function(source, baseURL, options, cb) {
		if (options.inlineImages) {
			var m, imageURLs = [];
			while (m = reCSSURL.exec(source)) {
				var imageURL = m[1];
				imageURLs.push(imageURL);
			}

			async.map(imageURLs,
				_.bind(function(imageURL, cb2) {
					imageURL = path.resolve(path.dirname(baseURL), imageURL)

					this._loadURL(imageURL, {}, _.bind(function(err, result) {
						var dataURL = err
							? imageURL
							: this._encodeDataURL(result.path, result.source);
						cb2(0, dataURL);
					}, this));
				}, this),
				function(err, dataURLs) {
					for (var i = 0; i < dataURLs.length; ++i) {
						var dataURL = dataURLs[i];
						if (dataURL) {
							source = source.replace(imageURLs[i], dataURL);	
						}
					}
					
					if (options.compress) {
						source = cssmin(source);						
					}	
					cb(0, source);
				}
			);
		} else {
			if (options.compress) {
				source = cssmin(source);
			}
			cb(0, source);
		}
	},
	
	_encodeDataURL: function(sourcePath, source) {
		var mimeType = mime.lookup(sourcePath);
		var buf = new Buffer(source, 'binary');
		var b64 = buf.toString('base64');
		return '"data:'+mimeType+';base64,'+b64+'"';
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
