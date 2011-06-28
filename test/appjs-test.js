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

	        'that include': function(deps) {
    			assert.deepEqual(_.keys(deps), [
    				'testmod1',
    				'testmod1/lib/dep2',
    				'testmod1/lib/dep1',
	    		]);
        	},
        },

        'renders': {
        	topic: function(app) {
        		var maker = new appjs.PageMaker(app, 'http://localhost:8080/', '/');
        		maker.make(this.callback);
        	},

	        'as page': function(html) {
    			assert.equal(html,
	    			'<!DOCTYPE html>'+
	    			'<html app="testmod1">'+
	    			'<head>'+
	    			'<base href="/"/>'+
	    			'</head>'+
		    		'<body></body>'+
			    	'</html>');
        	},
        },

        'renders compressed': {
        	topic: function(app) {
        		var maker = new appjs.PageMaker(app, 'http://localhost:8080/', '/', true, true);
        		maker.make(this.callback);
        	},

	        'a page': function(html) {
    			assert.equal(html,
	    			'<!DOCTYPE html>'+
	    			'<html app="testmod1">'+
	    			'<head>'+
	    			'<base href="/"/>'+
	    			'<script type="appjs/cached" id="appjs/js/testmod1">'+
	    			'define(["./dep1","./dep2"],function(a,b){var c=a,d=b})</script>\n'+
	    			'<script type="appjs/cached" id="appjs/js/testmod1/lib/dep2">'+
	    			'define([],function(){})</script>\n'+
	    			'<script type="appjs/cached" id="appjs/js/testmod1/lib/dep1">'+
	    			'define([],function(){var a=1})</script>'+
	    			'</head>'+
		    		'<body></body>'+
			    	'</html>');
        	},
        }

    },     
}).export(module);
