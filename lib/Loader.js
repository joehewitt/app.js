
var fs = require('fs'),
	path = require('path'),
	uglify = require('uglify-js'),
	mime = require('mime'),
	cssmin = require('cssmin').cssmin,
	crypto = require('crypto'),
	_ = require('underscore'),
	async = require('async'),
	loadApp = require('./App').loadApp;

var reRequire = /require\s*\(\s*["'](.*?)["']\s*\)/g;
var reStyle = /^\s*"style\s+(.*?)\s*"\s*;?\s*$/gm;
var rePragma = /^\s*"pragma\s+(.*?)\s*"\s*;?\s*$/gm;
var reCSSURL = /url\("?(.*?)"?\)/g;

function Loader() {
	this.cache = {};
	this.apps = {};
	this.transientExtensions = [];
}
exports.Loader = Loader;

function safeBind(cb, fn, self) {
	return function(err, result) {
		if (err) { cb(err); return; }

		try {
			fn.apply(self, arguments);	
		} catch (exc) {
			console.log(exc.stack)
			cb(exc);
		}
	}
}

Loader.prototype = {
	loadURL: function(url, pageMaker, compress, cb) {
		var parts = url.split('/');
		if (parts[1] == '') {
			pageMaker.make(safeBind(cb, function(err, source) {
				cb(0, {path: '', source: source});
			}));
		} else if (parts[1] == 'app.js') {
			var appjsPath = path.resolve(__dirname, '..', 'client', 'appjs.js');
			this.loadFile(appjsPath, '', compress, false, false/*use cache*/,
				safeBind(cb, function(err, source) {
					cb(0, {path: appjsPath, source: source});
				})
			);
		} else if (parts[1] == 'static') {
			var relativeURL = parts.slice(2).join('/');
			this.searchStatic(relativeURL, safeBind(cb, function(err, filePath) {
				if (filePath) {
					fs.readFile(filePath, safeBind(cb, function(err, source) {
						if (compress && mime.lookup(filePath) == 'text/css') {
							this.compressCSS(source+'', true, function(err, source) {
								cb(0, {path: filePath, source: source});
							});
						} else {
							cb(0, {path: filePath, source: source});
						}
					}, this));
				}
			}, this));
		} else if (parts[1] == 'js') {
			var basePath = parts.slice(2).join('/');
			var relativeURL = path.join(path.dirname(basePath), path.basename(basePath, '.js'));
			this.searchScript(relativeURL, safeBind(cb, function(err, findings) {
				if (findings) {
					this.loadFile(findings.path, findings.name, compress, true, false/*use cache*/,
						safeBind(cb, function(err, source) {
							cb(0, {path: findings.path, name: findings.name, source: source});
						})
					);
				}
			}, this));
		} else if (parts.lenth) {
			var relativeURL = parts.slice(1).join('/');
			this.loadURL(relativeURL, maker, compress, cb);
		} else {
			cb("Not found");
		}
	},

	loadFile: function(scriptPath, modulePath, compress, relink, useCache, cb) {
		fs.stat(scriptPath, safeBind(cb, function(err, stat) {
			if (useCache) {
				var cached = this.cache[scriptPath];
				if (cached && cached.sourceTime <= stat.mtime) {
					cb(0, cached.source);
					return;
				}
			}

			fs.readFile(scriptPath, safeBind(cb, function(err, data) {
				if (relink) {
					this.relinkScript(modulePath, data, safeBind(cb, complete, this));	
				} else {
					complete.apply(this, [0, data]);
				}

				function complete(err, data) {
					if (compress) {
						data = this._compress(data);
						this.cache[scriptPath] = {source: data, sourceTime: stat.mtime};
					}					

					cb(0, data);
				}
			}, this));
		}, this));
	},

	searchScript: function(modulePath, basePath, cb) {
		if (typeof(basePath) == 'function') { cb = basePath; basePath = null; }

		try {
			if (basePath) {
				// XXXjoe I'd prefer not to have to require these scripts
				require(basePath);
				var baseScriptPath = require.resolve(basePath);
				
				// XXXjoe These are private APIs. I need to lobby for Node to make this public
				var baseInfo = require('module')._cache[baseScriptPath];
				var scriptPath = require('module')._resolveFilename(modulePath, baseInfo)[0];

				this.shortenModulePath(scriptPath, function(err, shortModulePath) {
					cb(0, {path: scriptPath, name: shortModulePath});
				});
			} else {
				var scriptPath = require.resolve(modulePath);
				
				this.shortenModulePath(scriptPath, function(err, shortModulePath) {
					cb(0, {path: scriptPath, name: shortModulePath});
				});
			}
		} catch (exc) {
			console.log(exc.stack);
			if (cb) cb(exc);
		}
	},

	searchStatic: function(modulePath, cb) {
		modulePath = this._securePath(modulePath);
		if (!modulePath) { cb("Illegal path"); return; }
		
		var parts = modulePath.split('/');
		if (!parts.length) {
			return cb(0, '');
		}

		var rootModuleName = parts[0];
		var baseScriptPath = require.resolve(rootModuleName);
		this.findPackageStaticPath(baseScriptPath, safeBind(cb, function(err, staticPath) {
			var filePath = path.join(staticPath, parts.slice(1).join('/'));
			cb(0, filePath);
		}));
	},

	relinkScript: function(modulePath, source, cb) {
		// Find all require statements
		var m, deps = [], depPaths = [];
		source = source+'';
		while (m = reRequire.exec(source)) {
			depPaths.push(m[1]);
			deps.push(m);
		}

		async.map(depPaths,
			_.bind(function(depPath, cb2) {
				this.searchScript(depPath, modulePath, cb2);
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

				var js ='define([' + depStrings.join(', ') + '], function('
						+ depNames.join(', ') + ') {' + source.split('\n').join('\n    ')
						+ '\n});';
				cb(0, js);
			})
		);
	},

	traceDependencies: function(rootModuleName, skipDebug, cb) {
		var moduleMap = {};
		var styleMap = {};
		var loader = this;
		var depth = 0;

		trace(rootModuleName);
				
		function trace(modulePath, baseName) {
			if (!(modulePath in moduleMap)) {
				++depth;

				loader.searchScript(modulePath, baseName, function(err, findings) {
					if (err || !findings) { cb(err); --depth; return; }

					fs.readFile(findings.path, function(err, source) {
						if (err) { cb(err); --depth; return; }

						var pragmas = moduleMap[findings.name] = {
							debug: !loader._shouldTrace(modulePath)
						};

						var m;
						while ((m = rePragma.exec(source))) {
						    pragmas[m[1]] = 1;
						}

						if (!skipDebug || !pragmas.debug) {
							while(m = reRequire.exec(source)) {
								var depName = m[1];
								trace(depName, findings.name);
							}
						}

						while (m = reStyle.exec(source)) {
							var staticName = m[1];
						    var absoluteName = loader._normalizeName(staticName, modulePath);
						    styleMap[absoluteName] = {};
						}

						if (!--depth) {
							cb(0, {js: moduleMap, css: _.keys(styleMap)});
						}
					});
				});
			}
		}	
	},

	findPackagePath: function(scriptPath, cb) {
		var dirName = path.dirname(scriptPath);
		checkForPackage(dirName);

		function checkForPackage(dirName) {
			if (!dirName) { cb("Not found"); return; }

			var packagePath = path.join(dirName, "package.json");
			fs.stat(packagePath, function(err, stat) {
				if (err || !stat.isFile()) {
					// Keep searching upwards until we find directory containing package.json
					checkForPackage(path.dirname(dirName));
				} else {
					cb(0, packagePath);
				}
			});
		}
	},

	findPackageInfo: function(scriptPath, cb) {
		this.findPackagePath(scriptPath, safeBind(cb, function(err, packagePath) {
			fs.readFile(packagePath, safeBind(cb, function(err, packageJSON) {
				var packageInfo = JSON.parse(packageJSON);
				cb(0, {path: packagePath, info: packageInfo});
			}));
		}));
	},

	findPackageStaticPath: function(scriptPath, cb) {
		this.findPackageInfo(scriptPath, safeBind(cb, function(err, result) {
			var appInfo = result.info['app.js'];
			if (appInfo && appInfo['static']) {
				var staticPath = path.resolve(path.dirname(result.path), appInfo['static']);
				cb(0, staticPath);
			} else {
				cb("No static path");
			}
		}));
	},

	shortenModulePath: function(scriptPath, cb) {
		this.findPackageInfo(scriptPath, safeBind(cb, function(err, result) {
			// Read the package.json so we can use info contained within
			var dirName = path.dirname(result.path);
			var mainPath = path.resolve(dirName, result.info.main);
			if (!path.extname(mainPath)) {
				mainPath += '.js';
			}
			if (mainPath == scriptPath) {
				// If it's the main script, shorten it to the package name
				cb(0, result.info.name);
			} else {
				// Remove the directories above the package directory
				var relativePath = scriptPath.substr(dirName.length+1);
				var relativeName = path.join(result.info.name, relativePath);

				// Remove .js extension if there is one
				var ext = path.extname(relativeName);
				if (ext) {
					relativeName = path.join(path.dirname(relativeName),
										     path.basename(relativeName, ext));
				}
				cb(0, relativeName);
			}
		}));
	},

	compressCSS: function(source, inlineImages, cb) {
		if (inlineImages) {
			var m, imageURLs = [];
			while (m = reCSSURL.exec(source)) {
				var imageURL = m[1];
				imageURLs.push(imageURL);
			}

			async.map(imageURLs,
				_.bind(function(imageURL, cb2) {
					this.loadURL(imageURL, null, false, _.bind(function(err, result) {
						var dataURL = result ? this._encodeDataURL(result.path, result.source) : null;
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
					
					source = cssmin(source);	
					cb(0, source);
				}
			);
		} else {
			source = cssmin(source);
			cb(0, source);
		}
	},

	// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * 

	_encodeDataURL: function(sourcePath, source) {
		var mimeType = mime.lookup(sourcePath);
		var buf = new Buffer(source);
		var b64 = buf.toString('base64');
		return '"data:'+mimeType+';base64,'+b64+'"';
	},

	_ensureModuleDirectory: function(basePath, rootFileName, rootModuleName, cb) {
		var scriptPath = path.join(basePath, rootFileName);
		fs.stat(filePath, function(err, stat) {
			if (err || !stat.isFile()) {
				var dirPath = path.join(basePath, rootModuleName);
				fs.stat(dirPath, function(err, stat) {
					if (stat.isDirectory()) {
						cb(0, dirPath);
					} else {
						cb(0, null);
					}				
				});
			} else {
				cb(0, basePath);
			}
		})
	},

	_compress: function(source) {
		var jsp = require("uglify-js").parser;
		var pro = require("uglify-js").uglify;

		var ast = jsp.parse(source+'');
		ast = pro.ast_mangle(ast, {toplevel: true});
		ast = pro.ast_squeeze(ast);
		return pro.gen_code(ast);
	},

	_normalizeName: function(name, baseName) {
		if (name && name[0] == '.')	{
            // Relative paths inside of root modules are contained within the module, not its parent
			if (baseName.indexOf('/') == -1) {
				baseName += '/';
			}
			return path.normalize(path.join(baseName, name));
		} else {
			return name;
		}
	},

	_securePath: function(insecurePath) {
		var parts = insecurePath.split('/');
		// Upwards paths are illegal
		if (parts.indexOf('..') != -1 ) {
			return '';		
		} else {
			return insecurePath;
		}
	},

	_shouldTrace: function(name) {
		return !(path.extname(name) in this.transientExtensions);
	}
};
