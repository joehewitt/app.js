
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

function require(name) {
    if (name in modules) {
        return modules[name].exports;
    } else {
        return thaw(name);
    }
}
window.require = require;

require.ready = function(cb) {
    readies[readies.length] = cb;
}

function define(name, fn) {
    if (typeof(fn) == "string") {
        frozen[name] = function() { return sandboxEval(fn).apply(this, arguments); }
    } else {
        frozen[name] = fn;
    }
}
window.define = define;

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
        fn.apply(window, params);

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

})();

window.sandboxEval = function(js, sandbox) {
    if (sandbox) {
        with (sandbox) {
            return eval(js);
        }
    } else {
        return eval(js);
    }
};

if (!document.querySelector) {
    (function(d){d=document,a=d.styleSheets[0]||d.createStyleSheet();d.querySelectorAll=function(e){a.addRule(e,'f:b');for(var l=d.all,b=0,c=[],f=l.length;b<f;b++)l[b].currentStyle.f&&c.push(l[b]);a.removeRule(0);return c}})();
}