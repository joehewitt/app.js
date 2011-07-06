
var path = require('path'),
	fs = require('fs'),
	_ = require('underscore'),
	async = require('async'),
	jsdom = require('jsdom').jsdom,
	cssmin = require('cssmin').cssmin,
	mime = require('mime'),
	safeBind = require('./util').safeBind;

var staticPath = '/static';
var docType = '<!DOCTYPE html>';

var reRequire = /require\s*\(\s*["'](.*?)["']\s*\)/g;
var reCSSURL = /url\("?(.*?)"?\)/g;

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

	generateScript: function(scriptPath, modulePath, options, relink, cb) {
		fs.stat(scriptPath, safeBind(cb, function(err, stat) {
			var sections = [];

			if (options.inlineScripts && relink) {
				this._loadURL('/app.js', options, safeBind(cb, phase2, this));
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

					this.app.loader.traceDependencies(modulePath, false, safeBind(cb, phase3, this));
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
									safeBind(cb, function(err, js) {
										sections.push(js);
										cb2(0);
									}, this)
								);
							} else {
								cb2(0);
							}
						}, this),
						safeBind(cb, phase4, this)
					);
				} else {
					phase4.apply(this, [0]);					
				}
			}
			
			function phase4(err) {
				fs.readFile(scriptPath, safeBind(cb, function(err, data) {
					if (relink) {
						this._relinkScript(modulePath, data, false, options.compress,
										  safeBind(cb, phase5, this));	
					} else {
						phase5.apply(this, [0, data]);
					}

					function phase5(err, data) {
						sections.push(data+'');
						var result = sections.join(';');

						cb(0, result);
					}

				}, this));
			}
		}, this));
	},

	generateStylesheet: function(options, cb) {
		var sections = [];

		if (options.inlineStyles) {
			this.app.loader.traceDependencies(this.app.moduleName, false, safeBind(cb, phase2, this));
		} else {
			phase2.apply(this, [0, {}]);
		}

		function phase2(err, dependencies) {
			async.map(dependencies.css || [],
				_.bind(function(depPath, cb2) {
					this.app.loader.searchStatic(depPath, safeBind(cb, function(err, filePath) {
						fs.readFile(filePath, _.bind(function(err, data) {
							var baseURL = staticPath + '/' + depPath;
							this.compressCSS(data+'', baseURL, options,
								function(err, data) {
									sections.push(data);
									cb2(0);
								});
						}, this));
					}, this));
				}, this),
				safeBind(cb, phase3, this)
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
		tags.push(scriptTagForURL('/js/' + this.app.moduleName));
		cb(0, tags.join('\n'));

		function scriptTagForURL(urlPath) {
			return '<script type="text/javascript" src="' + urlPath + q + '"></script>';
		}
	},

	processedScriptTags: function(items) {
		// XXXjoe So far we only support processed stylesheets
		return '';
	},

	styleTags: function(urlPaths, options, cb) {
		var params = [];
		if (!options.inlineImages) {
			params.push('inlineImages=false');
		}
		if (!options.compress) {
			params.push('compress=false');
		}
		var q = (params.length ? '?' + params.join('&') : '');

		if (options.inlineStyles) {
			var cssPath = '/css' + q;
			var tag = '<style type="text/css">@import "' + cssPath + '";</style>';
			cb(0, tag);
		} else {
			var tags = _.map(urlPaths, function(urlPath) {
				var cssPath = staticPath + '/' + urlPath + q;
				return '<style type="text/css">@import "' + cssPath + '";</style>';
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
		this.scriptTags(this.builtinScripts, options, _.bind(function(err, scriptTags) {
			this.styleTags(this.styles, options, _.bind(function(err, styleTags) {
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
			safeBind(cb, function(err, absolutePaths) {
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
						   + 'function(){/*(' + source + ')*/}, true);');
				} else {
					cb(0, 'define("' + modulePath + '", [' + depStrings.join(', ') + '], '
						  + source + ');');
				}
			}, this)
		);			
	},

	compressJavaScript: function(source) {
		var pro = require("uglify-js").uglify;
		var jsp = require("uglify-js").parser;

		try {
			var ast = jsp.parse(source+'');
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
		var buf = new Buffer(source);
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
