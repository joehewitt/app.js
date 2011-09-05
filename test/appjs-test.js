var path = require('path'),
    assert = require('assert'),
    vows = require('vows'),
    _ = require('underscore');

require.paths.unshift(path.join(__dirname, '..', 'lib'));
require.paths.unshift(path.join(__dirname, 'modules'));

var appjs = require('app.js');

// *************************************************************************************************

vows.describe('appjs basics').addBatch({
    'module': {
        topic: function() {
        	appjs.loadApp("testmod1", this.callback);
	    },

        'has deps': {
        	topic: function(app) {
				app.loader.traceDependencies(app.moduleName, false, this.callback);
        	},

	        'that include': function(results) {
    			assert.deepEqual(_.keys(results.js), [
    				'testmod1',
    				'testmod1/lib/dep2',
    				'testmod1/lib/dep1',
	    		]);
    			assert.deepEqual(results.css, [
    				'testmod1/stylesheets/foo.css'
	    		]);
        	},
        },

        'renders': {
        	topic: function(app) {
        		var maker = new appjs.Renderer(app, 'http://localhost:8081/', '/');
        		maker.generatePage({}, this.callback);
        	},

	        'as page': function(html) {
    			assert.equal(html,
	    			'<!DOCTYPE html>'+
	    			'<html app="testmod1">'+
	    			'<head>'+
	    			'<base href="/"/>'+
	    			'<style type="text/css">@import "/static/testmod1/stylesheets/foo.css";</style>'+
	    			'</head>'+
		    		'<body>'+
		    		'<script type="text/javascript" src="/app.js"></script>'+
	    			'</body>'+
			    	'</html>');
        	},
        },

        'renders inline': {
        	topic: function(app) {
        		var maker = new appjs.Renderer(app, 'http://localhost:8081/', '/');
        		maker.generatePage({js: "inline", css: "inline"}, this.callback);
        	},

	        'a page': function(html) {
    			assert.equal(html,
	    			'<!DOCTYPE html>'+
	    			'<html app="testmod1">'+
	    			'<head>'+
	    			'<base href="/"/>'+
	    			'<script type="appjs/cached" id="appjs/js/testmod1">'+
	    			'define(["testmod1/lib/dep1","testmod1/lib/dep2","exports"]'+
	    			',function(a,b,c){var d=a,e=b})</script>\n'+
	    			'<script type="appjs/cached" id="appjs/js/testmod1/lib/dep2">'+
	    			'define(["exports"],function(a){})</script>\n'+
	    			'<script type="appjs/cached" id="appjs/js/testmod1/lib/dep1">'+
	    			'define(["exports"],function(a){var b=1})</script>'+
	    			'</head>'+
		    		'<body><script type="text/javascript" src="/app.js"></script></body>'+
			    	'</html>');
        	},
        },

        'renders js inline': {
            topic: function(app) {
                var renderer = new appjs.Renderer(app, 'http://localhost:8081/', '/');
                var options = {js: "source", minify: false, beautify: true, userAgent: "test"};
                var url = '/app.js/js';
                app.loader.loadURL(url, renderer, options, this.callback);
            },

            'a page': function(result) {
                D&&D(result.body);
                assert.equal(result.body,
                    'define("testmod1", function() {"style testmod1/stylesheets/foo.css";'+
                    'var a=require("testmod1/lib/dep1"),b=require("testmod1/lib/dep2")});\n'+
                    'define("testmod1/lib/dep2", function() {});\ndefine("testmod1/lib/dep1", '+
                    'function() {var a=1});\nrequire("testmod1");'
                );
            },
        }
    },     
}).export(module);
