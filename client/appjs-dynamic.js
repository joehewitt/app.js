
/**
 * This is the development version of app.js which supports dynamic loading of modules and dependency resolution.
 */
(function() {

var mainModule;
var modules = {};
var moduleCallbacks = {};
var generators = [];
var readies = [];
var frozen = {};
var loaded = false;
var queuedName;

function require(name, timestamp, cb) {
    if (typeof(timestamp) == 'function') {
        cb = timestamp;
        timestamp = null;
    }

    name = require.resolve(name);
    if (modules[name]) {
        var module = modules[name].exports;
        if (cb) {
            cb(0, module);
        } else {
            return module;
        }
    } else {
        return loadScript(name, timestamp, cb);
    }        
}
window.require = require;

require.stylesheet = function(url) {
    var ss = document.createElement('link');
    ss.rel = "stylesheet";
    ss.href = url;
    document.head.appendChild(ss);
};

require.ready = function(cb) {
    readies[readies.length] = cb;
};

// XXXjoe We probably don't need this since I don't think we leave relative requires in anymore
require.resolve = function(name, baseName) {
    if (name[0] == '.') {
        // Relative paths inside of root modules are contained within the module, not its parent
        var absolutePath = baseName.indexOf('/') == -1 ? baseName : dirname(baseName);
        
        var parts = name.split('/');
        for (var i = 0; i < parts.length; ++i) {
            var part = parts[i];
            if (part == '.') {
            } else if (part == '..') {
                absolutePath = dirname(absolutePath);
            } else {
                absolutePath = absolutePath + '/' + part;
            }
        }
        return absolutePath;
    } else {
        return name;
    }
};

require.addGenerator = function(callback) {
    generators[generators.length] = callback;
};

require.generate = function() {
    var texts = [];
    for (var i = 0; i < generators.length; ++i) {
        texts[texts.length] = generators[i]();
    }
    return JSON.stringify(texts);
};

function define(name, deps, factory) {
    // console.log('define', name)
    if (!factory) {
        if (typeof(deps) == "function") {
            factory = deps;
            deps = null;
        }
    }

    // This implies that the first module to be defined will be the "root module".
    // It would be better if this were more explicit.
    if (!queuedName) {
        queuedName = name;
    }

    if (typeof(factory) == "string") {
        var source = factory;
        factory = function() { return sandboxEval(source).apply(this, arguments); }
    }

    frozen[name] = {deps:deps, factory:factory};
}
window.define = define;

// *************************************************************************************************

function addModuleCallback(name, callback) {
    var firstCallback = false;

    var callbacks = moduleCallbacks[name];
    if (!callbacks) {
        moduleCallbacks[name] = [];
        firstCallback = true;
    }

    if (callback) {
        moduleCallbacks[name].push(callback);
    }
    return firstCallback;
}

function loadScript(name, timestamp, cb) {
    if (name in modules) {
        var module = modules[name].exports;
        if (cb) {
            cb(0, module);
        } else {
            return module;            
        }
    } else if (name in frozen) {
        addModuleCallback(name, cb);
        return thaw(name);
    } else {
        if (addModuleCallback(name, cb)) {
            if (has('appjs')) {
                throw new Error("Not found");
            } else {
                var search = location.search;
                var url = urlForScript(name, timestamp) + (search ? search + '&' : '?') + 'js=source&css=included';

                var script = document.createElement('script');
                script.type = 'text/javascript';
                script.async = true;
                script.src = url;
                script.onload = function() {
                    if (script.parentNode) {
                        script.parentNode.removeChild(script);
                    }
                    thaw(name);
                };
                script.onerror = function() {
                    if (script.parentNode) {
                        script.parentNode.removeChild(script);
                    }
                    dispatchModuleError(name, new Error());
                };

                var head = document.getElementsByTagName("head")[0];
                head.appendChild(script);
            }
        }
    }
}

function thaw(name) {
    var cached = frozen[name];
    if (cached) {
        delete frozen[name];

        if (!mainModule) {
            mainModule = name;
        }
        
        return defineModule(name, cached.deps, cached.factory);
    } else {
        dispatchModuleError(name, new Error());        
    }
}

function defineModule(name, deps, factory) {
    return loadDependencies(name, deps, function(err) {
        var module = {id: name, exports: {}};
        modules[name] = module;
                
        function localRequire(name, timestamp, cb) {
            return require(name, timestamp, cb);
        }
        for (var p in require) {
            localRequire[p] = require[p];
        }

        factory.apply(window, [localRequire, module.exports, module]);

        dispatchModule(name, module.exports);
        return module.exports;
    });
}

function loadDependencies(dependentId, deps, cb) {
    if (deps && deps.length) {
        var remaining = deps.length;
        for (var i = 0; i < deps.length; ++i) {
            var name = deps[i];
            if (name == 'require' || name == 'exports' || name == 'module') {
                if (!--remaining) {
                    return cb(0);
                }
            } else {
                name = deps[i] = require.resolve(name, dependentId);
                loadScript(name, null, function(err, module) {
                    if (!--remaining) {
                        return cb(err);
                    }
                });
            }
        }
    } else {
        return cb(0);
    }
}

function dispatchModuleError(name, err) {
    if (moduleCallbacks[name]) {
        var callbacks = moduleCallbacks[name];
        delete moduleCallbacks[name];
        for (var i = 0; i < callbacks.length; ++i) {
            callbacks[i](err);
        }
    }
}

function dispatchModule(name, module) {
    if (moduleCallbacks[name]) {
        var callbacks = moduleCallbacks[name];
        delete moduleCallbacks[name];
        for (var i = 0; i < callbacks.length; ++i) {
            callbacks[i](0, module);
        }
    }

    if (name == mainModule) {
        for (var i = 0; i < readies.length; ++i) {
            readies[i]();
        }

        if (has('appjs')) {
            appjs.html = document.doctype + '\n' + document.outerHTML;
        }
    }
}

function dirname(path) {
    var index = path.lastIndexOf('/');
    if (index == -1) {
        return '';
    } else {
        return path.substr(0, index);
    }
}

function urlForScript(name, timestamp) {
    var ext = name.substr(name.length-3);
    if (name.indexOf('.') == -1) {
        name += '.js';
    }

    if (timestamp) {
        name += '@' + timestamp;
    }
    return appjsBase + '/' + name;
}

window.addEventListener("DOMContentLoaded", function() {
    loaded = true;
    if (queuedName) {
        thaw(queuedName);        
    }
});

})();

/**
 * Eval in a sandbox where global and local application variables are not accessible.
 *
 * This function must be *outside* of all closures that may invoke it, otherwise it will not
 * be a "sandbox" because eval will be able to reference variables in the application.
 */
window.sandboxEval = function(js, sandbox) {
    if (sandbox) {
        with (sandbox) {
            return eval(js);
        }
    } else {
        return eval(js);
    }
};

// XXXjoe has.js doesn't have a test for this yet :(
if (!document.querySelector) {
    (function(d){d=document,a=d.styleSheets[0]||d.createStyleSheet();d.querySelectorAll=function(e){a.addRule(e,'f:b');for(var l=d.all,b=0,c=[],f=l.length;b<f;b++)l[b].currentStyle.f&&c.push(l[b]);a.removeRule(0);return c}})();
}
