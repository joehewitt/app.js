var path = require('path'),
    assert = require('assert'),
    vows = require('vows'),
    _ = require('underscore');

require.paths.unshift(path.join(__dirname, '..', 'lib'));
require.paths.unshift(path.join(__dirname, 'modules'));

var appjs = require('appjs');

// *************************************************************************************************

vows.describe('appjs basics').addBatch({
    'module': {
        topic: function() {
        	var loader = new appjs.Loader();
        	appjs.loadApp("testmod1", loader, this.callback);
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
        		var maker = new appjs.PageMaker(app, 'http://localhost:8081/', '/');
        		maker.make(this.callback);
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

        'renders compressed': {
        	topic: function(app) {
        		var maker = new appjs.PageMaker(app, 'http://localhost:8081/', '/', true, false, true);
        		maker.make(this.callback);
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
        }

    },     
}).export(module);
