var path = require('path'),
	fs = require('fs'),
	url = require('url'),
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
		// Start with fresh dependencies next time they're needed
		delete this.dependencies;

		this._traceDependencies(this.app.clientModuleName, abind(function(err, deps) {	
			this._renderSource(this.localURL, options, abind(function(err, processedMap) {
				this._renderPage(processedMap, options, abind(function(err, html) {
					this.renderContent(url, html, options, cb);
				}, cb, this));
			}, cb, this));
		}, cb, this));
	},

	renderManifest: function(options, cb) {
		this._traceDependencies(this.app.clientModuleName, abind(function(err, deps) {
			cb(0, {
				source: [
				'CACHE MANIFEST',
				'/favicon.ico',
				this._renderURL(jsPath, 'js'),
				this._renderURL(cssPath, 'css'),
				((this.app.settings['cache.manifest']||{})['CACHE']||[]).join('\n'),
				'',
				'NETWORK:',
				((this.app.settings['cache.manifest']||{})['NETWORK']||[]).join('\n'),
				'*',
				'',
				
				'FALLBACK:',
				((this.app.settings['cache.manifest']||{})['FALLBACK']||[]).join('\n'),

				].join('\n')
			});
		}, cb, this));
	},

	renderScript: function(scriptPath, modulePath, options, relink, cb) {
		var sections = [];
		var deps = [];

		if (options.js == "inline" && this.app.settings.jsHeader) {
			sections.push(this.app.settings.jsHeader);
		}

		if (options.js == "inline" && relink) {
			this._loadURL('/app.js', options, abind(phase2, cb, this));
		} else {
			phase2.apply(this, [0]);
		}

		function phase2(err, data) {
			if (options.js == "inline" && relink) {
				var source = this.compressJavaScript(data.body);
				sections.push(source);

				this._traceDependencies(modulePath, abind(phase3, cb, this));
			} else {
				fs.stat(scriptPath, abind(function(err, stat) {
					deps.push({path: scriptPath, mtime: stat.mtime.getTime()});
					phase3.apply(this, [0]);
				}, cb, this));
			}
		}

		function phase3(err, dependencies) {
			if (options.js == "inline" && relink) {
				async.map(_.keys(dependencies.js),
					_.bind(function(depPath, cb2) {
						var dep = dependencies.js[depPath];
						deps.push({path: dep.path, mtime: dep.mtime});

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
					var compress = options.js == "inline" || options.js == "compress";
					this._relinkScript(modulePath, data, false, compress, abind(phase5, cb, this));	
				} else {
					phase5.apply(this, [0, data]);
				}

				function phase5(err, data) {
					sections.push(data+'');
					var source = sections.join('\n');

					cb(0, {path: 'all.js', source: source, dependencies: deps});
				}

			}, cb, this));
		}
	},

	renderStylesheet: function(options, cb) {
		var sections = [];
		var deps = [];

		this._traceDependencies(this.app.clientModuleName, abind(phase2, cb, this));

		function phase2(err, dependencies) {
			var cssMap = dependencies.css||{};
			async.map(_.keys(cssMap),
				_.bind(function(depPath, cb2) {
					this.app.loader.searchStatic(depPath, null, false, abind(function(err, filePath) {
						deps.push({path: filePath, mtime: cssMap[depPath].mtime});

						fs.readFile(filePath, abind(function(err, data) {
							if (options.css == "inline" || options.css == "compress") {
								this.compressCSS(data+'', depPath, options,
									function(err, data) {
										sections.push(data);
										cb2(0);
									}
								);								
							} else {
								sections.push(data+'');
								cb2(0);
							}
						}, cb, this));
					}, cb, this));
				}, this),
				abind(phase3, cb, this)
			);
		}

		function phase3(err) {
			var source = sections.join('');
			cb(0, {path: 'all.css', source: source, dependencies: deps});
		}
	},

	scriptTags: function(urlPaths, options, cb) {
		var params = [];
		if (options.js != this.app.settings.js) {
			params.push("js=" + options.js);
		}

		var q = (params.length ? '?' + params.join('&') : '');

		var tags = options.js == "inline" ? [] : _.map(urlPaths, scriptTagForURL);
		var mainModuleName = options.js == 'inline'
			? jsPath
			: jsPath + '/' + this.app.clientModuleName;
		tags.push(scriptTagForURL(this._renderURL(mainModuleName, 'js')));
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
		if (options.css != this.app.settings.css) {
			params.push('css=' + options.css);			
		}
		if (options.images != this.app.settings.images) {
			params.push('images=' + options.images);
		}
		var q = (params.length ? '?' + params.join('&') : '');

		if (options.css == "inline") {
			var stylesheetURL = this._renderURL(cssPath + q, 'css');
			var tag = '<style type="text/css">@import "' + stylesheetURL + '";</style>';
			cb(0, tag);
		} else {
			this._traceDependencies(this.app.clientModuleName,
				abind(function(err, results) {
					var tags = _.map(results.css, _.bind(function(dep, urlPath) {
						var stylesheetPath = staticPath + '/' + urlPath;
						var stylesheetURL = this._renderURL(stylesheetPath + q, 'css');
						return '<style type="text/css">@import "' + stylesheetURL + '";</style>';
					}, this)).join('\n');
					cb(0, tags);
				}, cb, this)
			);
		}
	},

	iconTags: function(options, cb) {
		if (options.icons == "source") {
			this._traceDependencies(this.app.clientModuleName,
				abind(function(err, results) {
					var tags = _.map(results.icons, _.bind(function(dep, iconName) {
						var iconPath = staticPath + '/' + this.app.packageInfo.name +'/' + iconName;
						var iconURL = this._renderURL(iconPath, 'icons');
						return this._tagForIconURL(iconName, iconURL);
					}, this)).join('\n');
					cb(0, tags);
				}, cb, this)
			);
		} else if (options.icons == "inline") {
			this._traceDependencies(this.app.clientModuleName,
				abind(function(err, results) {
					async.map(_.keys(results.icons),
						_.bind(function(iconName, cb2) {
							var iconPath = staticPath + '/' + this.app.packageInfo.name + '/' + iconName;
							var iconURL = this._renderURL(iconPath, 'url');
							this._loadURL(iconURL, {}, abind(function(err, result) {
								var dataURL = err
									? iconURL
									: this._encodeDataURL(result.path, result.body);
								cb2(0, this._tagForIconURL(iconName, dataURL));
							}, cb, this));						
						}, this),
						abind(function(err, iconTags) {
							cb(0, iconTags.join('\n'));		
						})
					);					
				}, cb, this)
			);
		} else {
			cb(0, '');
		}
	},

	processedStyleTags: function(items) {
		return '';		
	},

	renderContent: function(url, html, options, cb) {
		if (options.content == "inline") {
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
		if (!this.dependencies) {
			this._initHTMLGlobals('');
			this.app.loader.traceDependencies(moduleName, false, abind(function(err, deps) {
				this.dependencies = deps;
				cb(0, deps);
			}, cb, this));
		} else {
			cb(0, this.dependencies);
		}
	},

	_renderSource: function(url, options, cb) {
		if (options.js == "inline") {
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
				this.iconTags(options, _.bind(function(err, iconTags) {
					cb(0, 
						docType+
						'<html'+
						(this.app.settings.language
							? ' lang="'+this.app.settings.language+'"' : '')+
						(this.app.settings.offline
							? ' manifest="' + this._renderURL('/app.js/cache.manifest') + '"' : '')+
						'>'+
						'<head>'+
						(this.app.settings.charset
							? '<meta charset="'+this.app.settings.charset+'">'
							: '')+
						'<base href="'+this.baseURLPath+'">'+
						(this.app.settings.title
							? '<title>'+this.app.settings.title+'</title>'
							: '')+
						iconTags+
						(this.app.settings.viewport
							? '<meta name="viewport" content="'+this.app.settings.viewport+'">'
							: '')+
						(this.app.settings.webAppCapable
							? '<meta name="apple-mobile-web-app-capable" content="true">'
							: '')+
						(this.app.settings.statusBarStyle
							? '<meta name="apple-mobile-web-app-status-bar-style" '+
							  'content="'+this.app.settings.statusBarStyle+'">'
							: '')+
						(this.app.settings.rss
							? '<link rel="alternate" type="application/rss+xml" title="RSS" href="'
							  + this.app.settings.rss + '">' : '')+
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

				var js = 'define("' + modulePath + '", [' + depStrings.join(', ') + '], '
					     + (freeze ? JSON.stringify('('+source+')') : source) + ');';				
				cb(0, js);
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
		this.app.loader.traceStylesheet(baseURL, false, source, null, abind(inlineImages, cb, this));


		function inlineImages(err, deps) {
			async.map(_.keys(deps.images),
				_.bind(function(imagePath, cb2) {
					var imageURL = this._renderURL(staticPath + '/' + imagePath, 'images');
					if (options.images == "inline") {
						this._loadURL(imageURL, {}, _.bind(function(err, result) {
							var dataURL = err
								? imageURL
								: this._encodeDataURL(result.path, result.body);

							source = source.replace(deps.images[imagePath].sourceURL, dataURL);	
							cb2(0);
						}, this));
					} else if (options.images == "source") {
						source = source.replace(deps.images[imagePath].sourceURL, imageURL);	
						cb2(0);
					} else {
						cb2(0);
					}
				}, this),
				_.bind(function(err) {
					inlineStylesheets.apply(this, [deps]);
				}, this)
			);
		}

		function inlineStylesheets(deps) {
			if (options.css == "inline") {
				async.map(_.keys(deps.css),
					_.bind(function(stylesheetPath, cb2) {
						// Remove the @import line, since renderStylesheet inlines the imported contents
						source = source.replace(deps.css[stylesheetPath].sourceLine, '');	
						cb2(0);
					}, this),
					_.bind(function(err) {
						complete.apply(this);		
					}, this)
				);
			} else {
				complete.apply(this);
			}
		}

		function complete() {
			if (options.css == "inline" || options.css == "compress") {
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

	_renderURL: function(URL, category) {
		if (this.app.settings.cdn) {
			return this._urlForCDN(URL, category);
		} else {
			return URL;
		}
	},

	_urlForCDN: function(URL, category) {
		var parsed = url.parse(URL);
		var timestamp = this._getLatestTimestamp(category);
		var path = parsed.pathname.replace(/\/app\.js\//,
										   "/app.js" + (timestamp ? "." + timestamp : "") + "/");
		parsed.host = this.app.settings.cdn;
		parsed.pathname = path;

		return url.format(parsed);
	},

	_getLatestTimestamp: function(category) {
		if (!category) {
			return this.app.startupTime;
		} else if (this.dependencies && category in this.dependencies) {
			var maxTime = 0;
			_.each(this.dependencies[category], function(dep) {
				if (dep.mtime > maxTime) {
					maxTime = dep.mtime;
				}
			});
			return maxTime;
		} else {
			return 0;
		}
	},

	_tagForIconURL: function(iconName, iconURL) {
		var m;
		if (iconName == "favicon.ico") {
			return '<link rel="icon" href="' + iconURL + '">';
		} else if (m = /apple-touch-icon(-(\d+x\d+))?-precomposed\.png/.exec(iconName)) {
			var sizesAttr = m[2] ? ' sizes="'+m[2]+'"' : '';
			return '<link rel="apple-touch-icon-precomposed"'+sizesAttr+' href="' + iconURL + '">';
		} else if (m = /apple-touch-icon(-(\d+x\d+))?\.png/.exec(iconName)) {
			var sizesAttr = m[2] ? ' sizes="'+m[2]+'"' : '';
			return '<link rel="apple-touch-icon"'+sizesAttr+' href="' + iconURL + '">';
		} else if (m = /apple-touch-startup-image(-(\d+x\d+))?\.png/.exec(iconName)) {
			var sizesAttr = m[2] ? ' sizes="'+m[2]+'"' : '';
			return '<link rel="apple-touch-startup-image"'+sizesAttr+' href="' + iconURL + '">';
		} else {
			return '';
		}
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
