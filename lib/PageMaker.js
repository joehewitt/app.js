
var path = require('path'),
	_ = require('underscore'),
	async = require('async');

function PageMaker(app, localURL, baseURLPath, inline, compress) {
	this.app = app;
	this.localURL = localURL;
	this.baseURLPath = this._addTrailingSlash(baseURLPath);
	this.inline = inline;
	this.compress = compress;
	this.scripts = {};
	this.styles = {};
}
exports.PageMaker = PageMaker;

PageMaker.prototype = {
	make: function(cb) {
		if (this.inline) {
			this.app.loader.traceDependencies(this.app.moduleName, true,
				_.bind(function(err, modules) {					
					if (err) { cb(err); return; }
					this.scripts = modules;
					this.styles = {};
					complete.apply(this);
				}, this)
			);
		} else {
			complete.apply(this);
		}

		function complete() {
			var generatedMap = this.inline ? this.generateSource(this.localURL) : {};
			this._generatePage(generatedMap, cb);
		}
	},

	generateSource: function(url) {
		return {};
	},

	metaTags: function() {
		return '';		
	},

	styleTags: function(styleNames) {
		return '';
	},

	generatedStyleTags: function(styleNames) {
		return '';		
	},

	scriptTags: function(moduleNames) {
		if (this.inline) {
			return '';			
		} else {
			return _.map(moduleNames, function(moduleName) {
				return '<script type="text/javascript" src="' + moduleName + '"></script>';
			}).join('\n');
		}
	},

	cachedScriptTags: function(moduleMap, cb) {
		async.map(_.keys(moduleMap),
			_.bind(function(name, cb2) {
				var pragmas = moduleMap[name];
				if (pragmas.debug) {
					cb2(0, '<script type="appjs/cached" id="appjs/js/'+name+'"></script>');
				} else {
					var url = this._urlForScript(name);
					this.load(url, !pragmas['no-munge'], function(err, info) {
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
	},

	generatedScriptTags: function(moduleNames) {
		return '';
	},

	load: function(url, munge, cb) {
		var url = this._makeURLAbsolute(url);
		this.app.loader.load(url, this.compress, munge, cb);
	},

	_generatePage: function(generatedMap, cb) {
		this.cachedScriptTags(this.scripts, _.bind(function(err, cachedScriptTags) {
			cb(0, 
				'<!DOCTYPE html>'+
				'<html'+
				(this.app.language ? ' lang="'+this.app.language+'"' : '')+
				' app="'+this.app.moduleName+'">'+
				'<head>'+
				'<base href="'+this.baseURLPath+'"/>'+
				this.metaTags()+
				this.styleTags(this.styles)+
				this.generatedStyleTags(generatedMap)+
				cachedScriptTags+
				this.generatedScriptTags(generatedMap)+
				'</head>'+
				'<body>'+
				this.scriptTags(this.builtinScripts)+
				'</body>'+
				'</html>'
			);
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
