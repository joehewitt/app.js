
(function() {

var mainModule;
var modules = {};
var readies = [];
var frozen = {};
var hasCache = {};

function require() {
    
}

require.ready = function(cb) {
    readies[readies.length] = cb;
}

function freeze(fn, deps) {
    frozen[fn.name] = {fn: fn, deps: deps};
}
window.freeze = freeze;

function has(feature) {
    if (feature in hasCache) {
        return hasCache[feature];
    } else if (feature == 'appjs') {
        return hasCache[feature] = !!window.appjs;
    } else {
        // XXXjoe Include the real has.js
        return false;
    }
}
window.has = has;

function define(fn) {
    var module = modules[fn.name];
    if (module) {
        return module.exports;
    } else {
        var entry = frozen[fn.name];
        if (entry) {
            if (!mainModule) {
                mainModule = fn;    
            }

            var params = [];
            for (var i = 0; i < entry.deps.length; ++i) {
                params.push(define(entry.deps[i]));
            }

            function localRequire() {}
            for (var p in require) {
                localRequire[p] = require[p];
            }

            var module = {id: fn.name, exports: {}};
            modules[fn.name] = module;
            params.push(localRequire, module.exports, module);
            fn.apply(window, params);

            if (fn == mainModule) {
                for (var i = 0; i < readies.length; ++i) {
                    readies[i]();
                }

                if (has('appjs')) {
                    appjs.html = document.doctype + '\n' + document.outerHTML;
                }
            }
            return module.exports;
        } else {
            console.error('Module not found');
        }
    }
}
window.define = define;

})();

window.sandboxEval = function(js, sandbox) {
    if (sandbox) {
        with (sandbox) {
            return eval(js);
        }
    } else {
        return eval(js);
    }
}
