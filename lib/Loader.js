
var fs = require('fs'),
	path = require('path'),
	uglify = require('uglify-js'),
	_ = require('underscore'),
	async = require('async'),
	loadApp = require('./App').loadApp;

var reRequire = /require\s*\(\s*["'](.*?)["']\s*\)/g;
var reStr = /[\'"](.*?)[\'"]/g;
var reStyle = /require\.style\s*\(\s*(.*?)\s*\)/g;
var rePragma = /^\s*"pragma\s+(.*?)\s*"\s*;?\s*$/g;

function Loader() {
	this.cache = {};
	this.apps = {};
	this.transientExtensions = [];
}
exports.Loader = Loader;

Loader.prototype = {
	staticDirName: 'static',
	
	load: function(url, compress, munge, cb) {
		if (munge === undefined) munge = true;

		var parts = url.split('/');
		if (parts[1] == 'static') {
			var relativeURL = parts.slice(2).join('/');
			this.searchStatic(relativeURL, function(err, path) {
				if (err) { cb(err); return; }
				if (path) {
					this.loadSource(path, '', compress, munge, compress, function(err, source) {
						if (err) { cb(err); return; }
						cb(0, {path: path, source: source});
					});
				}
			});
		} else if (parts[1] == 'js') {
			var basePath = parts.slice(2).join('/');
			var relativeURL = path.join(path.dirname(basePath), path.basename(basePath, '.js'));
			this.searchScript(relativeURL, _.bind(function(err, findings) {
				if (err) { cb(err); return; }
				if (findings) {
					this.loadSource(findings.path, findings.name, compress, munge, compress,
						function(err, source) {
							if (err) { cb(err); return; }
							cb(0, {path: findings.path, name: findings.name, source: source});
						}
					);
				}
			}, this));
		} else {
			var relativeURL = parts.slice(1).join('/');
			this.load(relativeURL, compress, munge, cb);
		}
	},

	loadSource: function(scriptPath, moduleName, compress, munge, useCache, cb) {
		if (munge === undefined) munge = true;
		
		fs.stat(scriptPath, _.bind(function(err, stat) {
			if (err) { cb(err); return; }

			if (useCache) {
				var cached = this.cache[scriptPath];
				if (cached && cached.sourceTime <= stat.mtime) {
					cb(0, cached.source);
					return;
				}
			}

			fs.readFile(scriptPath, _.bind(function(err, data) {
				if (err) { cb(err); return; }

				data = this.relinkScript(moduleName, data);
				if (compress) {
					data = this._compress(data, munge);
					this.cache[scriptPath] = {source: data, sourceTime: stat.mtime};
				}					

				cb(0, data);
			}, this));
		}, this));
	},

	searchApp: function(targetPath, cb) {
		if (targetPath in this.apps) {
			cb(0, this.apps[targetPath]);
		} else {
			this.searchScript(targetPath, _.bind(function(err, findings) {
				if (err || !findings) { return cb(0, null); }
				
				loadApp(targetPath, _.bind(function(err, app) {
					if (err) { return cb(err); }

					this.apps[targetPath] = app;
					cb(0, app);
				}, this));
			}, this));
		}
	},

	searchScript: function(targetPath, basePath, cb) {
		if (typeof(basePath) == 'function') { cb = basePath; basePath = null; }

		try {
			if (basePath) {
				require(basePath);
				var baseScriptPath = require.resolve(basePath);
				var baseInfo = require('module')._cache[baseScriptPath];
				var scriptPath = require('module')._resolveFilename(targetPath, baseInfo)[0];
				this.shortenModulePath(scriptPath, function(err, moduleName) {
					cb(0, {path: scriptPath, name: moduleName});
				});
			} else {
				var scriptPath = require.resolve(targetPath);
		
				this.shortenModulePath(scriptPath, function(err, moduleName) {
					cb(0, {path: scriptPath, name: moduleName});
				});
			}
		} catch (exc) {
			if (cb) cb(exc);
		}

		// targetPath = this._securePath(targetPath);
		// var ext = path.extname(targetPath);
		// if (!ext) {
		// 	targetPath += '.js';
		// }

		// var absolutePaths = _.map(this.searchPaths, function(p) { return path.join(p, targetPath); });

		// async.map(absolutePaths, fs.stat, _.bind(function(err, stats) {
		// 	stats.forEach(function(stat, i) {
		// 		if (stat.isFile()) {
		// 			return cb(0, absolutePaths[i]);
		// 		}
		// 	}, this);
		// });
	},

	searchStatic: function(targetPath, cb) {
		targetPath = this._securePath(targetPath);
		var parts = path.split('/');
		if (!parts.length) {
			return cb(0, '');
		}

		var rootModuleName = parts[0];
		var rootFileName = rootModuleName + '.js';
		var relativePath = parts.slice(1).join('/');

		var searchPaths = _.map(this.searchPaths, function(p) { return path.join(p, rootFileName); });
		iterate();

		function iterate() {
			if (!searchPaths.length) cb(0, null);

			var basePath = searchPaths.shift();
			this._ensureModuleDirectory(basePath, rootFileName, rootModuleName, _.bind(
			function(err, basePath) {
				if (!basePath) {
					iterate();
				} else {
					var absolutePath = path.join(basePath, this.staticDirName, relativePath);
					fs.stat(absolutePath, function(err, stat) {
						if (err) {
							iterate();
						} else {
							cb(0, absolutePath);
						}
					});
				}
			}, this));
		}
	},

	relinkScript: function(moduleName, source) {
		var m, deps = [], depStrings = [], depNames = [];
		source = source+'';
		while (m = reRequire.exec(source)) {
			depStrings.push('"' + m[1] + '"');
			depNames.push('__mod'+deps.length);
			deps.push(m);
		}

		for (var i = 0; i < deps.length; ++i) {
			source = source.replace(deps[i][0], '__mod'+i);
		}

		return 'define([' + depStrings.join(', ') + '], function(' + depNames.join(', ') + ') {' +
				 source.split('\n').join('\n    ') + '\n});';
	},

	traceDependencies: function(rootModuleName, skipDebug, cb) {
		var moduleMap = {};
		var styleMap = {};
		var loader = this;
		var depth = 0;

		trace(rootModuleName);
				
		function trace(moduleName, baseName) {
			if (!(moduleName in moduleMap)) {
				++depth;

				loader.searchScript(moduleName, baseName, function(err, findings) {
					if (err || !findings) { cb(err); --depth; return; }

					fs.readFile(findings.path, function(err, source) {
						if (err) { cb(err); --depth; return; }

						var pragmas = moduleMap[findings.name] = {
							debug: !loader._shouldTrace(moduleName)
						};

						var result;
						while ((result = rePragma.exec(source))) {
						    pragmas[result[1]] = 1;
						}

						if (!skipDebug || !pragmas.debug) {
							var m;
							while(m = reRequire.exec(source)) {
								var depName = m[1];
								trace(depName, moduleName);
							}
						}

						// var result;
						// while ((result = reStyle.exec(source))) {
						// 	var staticName = result[1];
						//     var absoluteName = loader._normalizeName(staticName, moduleName);
						//     styleMap[absoluteName] = {};
						// }

						if (!--depth) {
							cb(0, moduleMap);
						}
					});
				});
			}
		}	
	},

	shortenModulePath: function(scriptPath, cb) {
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
					fs.readFile(packagePath, function(err, packageJSON) {
						if (err) { cb(err); return; }

						// Read the package.json so we can use info contained within
						var packageInfo = JSON.parse(packageJSON);
						var mainPath = path.resolve(dirName, packageInfo.main);
						if (!path.extname(mainPath)) {
							mainPath += '.js';
						}
						if (mainPath == scriptPath) {
							// If it's the main script, shorten it to the package name
							cb(0, packageInfo.name);
						} else {
							// Remove the directories above the package directory
							var relativePath = scriptPath.substr(dirName.length+1);
							var relativeName = path.join(packageInfo.name, relativePath);

							// Remove .js extension if there is one
							var ext = path.extname(relativeName);
							if (ext) {
								relativeName = path.join(path.dirname(relativeName),
													     path.basename(relativeName, ext));
							}
							cb(0, relativeName);
						}

					});
				}
			});
		}
	},

	// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * 

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

	_compress: function(source, munge) {
		var jsp = require("uglify-js").parser;
		var pro = require("uglify-js").uglify;

		var ast = jsp.parse(source+'');
		if (munge) {
			ast = pro.ast_mangle(ast, {toplevel: true});
		}
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
		// XXXjoe Ensure path is secure, whatever that means
		return insecurePath;
	},

	_shouldTrace: function(name) {
		return !(path.extname(name) in this.transientExtensions);
	}
};
