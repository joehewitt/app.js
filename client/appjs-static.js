
if (!self.has) {
    self.has = function() { return false; }
}

/**
 * This is the optimized version of app.js which does not allow dynamic loading of modules. All modules must
 * be loaded and defined before the first require() call, or they will not be found.  The benefit of this
 * restriction is that this file is 1/3 the size, and generated modules are smaller because they don't need
 * to include dependency information. Is this tradeoff worth it? Time and more research will tell.
 */
(function() {

var modules = {};
var frozen = {};
var readies = [];
var mainModule;
var loaded = false;
var queuedName;

function require(name) {
    if (name in modules) {
        return modules[name].exports;
    } else if (has("appjs")) {
        // Don't wait for load event to thaw modules when on server
        return thaw(name);
    } else if (loaded) {
        // Wait for load event to thaw modules
        return thaw(name);
    }
}
self.require = require;

require.ready = function(cb) {
    readies[readies.length] = cb;
}

function define(name, fn) {
    // This implies that the first module to be defined will be the "root module".
    // It would be better if this were more explicit.
    if (!queuedName) {
        queuedName = name;
    }
    if (typeof(fn) == "string") {
        frozen[name] = function() { return sandboxEval(fn).apply(this, arguments); }
    } else {
        frozen[name] = fn;
    }
}
self.define = define;

// *************************************************************************************************

function thaw(name) {
    var fn = frozen[name];
    if (fn) {
        delete frozen[name];

        if (!mainModule) {
            mainModule = name;    
        }

        var module = {id: name, exports: {}};
        modules[name] = module;

        var params = [require, module.exports, module];
        fn.apply(self, params);

        if (name == mainModule) {
            for (var i = 0; i < readies.length; ++i) {
                readies[i]();
            }

            if (has('appjs')) {
                appjs.html = document.doctype + '\n' + document.outerHTML;
            }
        }
        return module.exports;
    } else {
        console.error('Module "' + name + '" not found');
    }
}

if (self.addEventListener) {
    self.addEventListener("DOMContentLoaded", function() {
        loaded = true;
        thaw(queuedName);
    });
}

self.startup = function(moduleName) {
    loaded = true;
    thaw(moduleName);
}

})();

self.sandboxEval = function(js, sandbox) {
    if (sandbox) {
        with (sandbox) {
            return eval(js);
        }
    } else {
        return eval(js);
    }
};

// XXXjoe has.js doesn't have a test for this yet :(
if (self.document && !document.querySelector) {
    (function(d){d=document,a=d.styleSheets[0]||d.createStyleSheet();d.querySelectorAll=function(e){a.addRule(e,'f:b');for(var l=d.all,b=0,c=[],f=l.length;b<f;b++)l[b].currentStyle.f&&c.push(l[b]);a.removeRule(0);return c}})();
}
