
var fs = require('fs'),
	path = require('path'),
	uglify = require('uglify-js'),
	mime = require('mime'),
	crypto = require('crypto'),
	_ = require('underscore'),
	async = require('async'),
	loadApp = require('./App').loadApp,
	safeBind = require('./util').safeBind;

var reRequire = /require\s*\(\s*["'](.*?)["']\s*\)/g;
var reStyle = /^\s*"style\s+(.*?)\s*"\s*;?\s*$/gm;
var rePragma = /^\s*"pragma\s+(.*?)\s*"\s*;?\s*$/gm;

function Loader() {
	this.apps = {};
	this.transientExtensions = [];
}
exports.Loader = Loader;

Loader.prototype = {
	loadURL: function(url, renderer, options, cb) {
		var parts = url.split('/');
		if (parts[1] == 'app.js') {
			if (parts.length == 2) {
				var appjsPath = path.resolve(__dirname, '..', 'client', 'appjs.js');
				renderer.renderScript(appjsPath, '', options, false,
					safeBind(cb, function(err, source) {
						cb(0, {path: appjsPath, source: source});
					})
				);
			} else {
				if (parts[2] == 'static') {
					var relativeURL = parts.slice(3).join('/');
					this.searchStatic(relativeURL, safeBind(cb, function(err, filePath) {
						if (filePath) {
							fs.readFile(filePath, safeBind(cb, function(err, source) {
								if (options.compress && mime.lookup(filePath) == 'text/css') {
									renderer.compressCSS(source+'', url, options, function(err, source) {
										cb(0, {path: filePath, source: source});
									});
								} else {
									cb(0, {path: filePath, source: source+''});
								}
							}, this));
						}
					}, this));
				} else if (parts[2] == 'js') {
					var basePath = parts.slice(3).join('/');
					var relativeURL = basePath
						? path.join(path.dirname(basePath), path.basename(basePath, '.js'))
						: renderer.app.clientModuleName;

					this.searchScript(relativeURL, safeBind(cb, function(err, findings) {
						if (findings) {
							renderer.renderScript(findings.path, findings.name, options, true,
								safeBind(cb, function(err, source) {
									cb(0, {path: findings.path, name: findings.name, source: source});
								})
							);
						}
					}, this));
				} else if (parts[2] == 'css') {
					renderer.renderStylesheet(options,
						safeBind(cb, function(err, source) {
							cb(0, {path: 'all.css', source: source});
						})
					);
				} else {
					cb("Not found");
				}
			}
		} else {
			renderer.renderPage(url, options, safeBind(cb, function(err, source) {
				cb(0, {path: '', source: source});
			}));
		}
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
							debug: !loader._shouldTrace(modulePath),
							source: source+'',
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

	// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

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
