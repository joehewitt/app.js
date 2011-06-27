var path = require('path'),
    assert = require('assert'),
    vows = require('vows');

require.paths.unshift(path.join(__dirname, '..', 'lib'));

var appjs = require('appjs');

// *************************************************************************************************

vows.describe('appjs basics').addBatch({
    'module': {
        topic: function() {
        	var modulesPath = path.normalize(path.join(__dirname, 'modules'));
        	var loader = new appjs.Loader([modulesPath]);
        	appjs.loadApp("testmod1", loader, this.callback);
	    },

        'has deps': {
        	topic: function(app) {
				app.loader.traceDependencies(app.moduleName, false, this.callback);
        	},

	        'that include': function(deps) {
    			assert.deepEqual(deps, [
    				'testmod1',
    				'testmod1/lib/dep1',
	    		]);
        	},
        }
    },     
}).export(module);
