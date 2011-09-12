
/**
 * This is the development version of app.js which supports dynamic loading of modules and dependency resolution.
 */
(function() {

var mainModuleName;
var modules = {};
var queue = {};
var queued = 0;
var lastDefines = [];
var generators = [];
var readies = [];
var frozen = {};
var loaded = false;
var queuedName;

function require(name) {
    name = require.resolve(name);
    if (modules[name]) {
        return modules[name].exports;
    } else if (!queue[name]) {
        loadScript(name, function(){});
    }        
}
window.require = require;

require.ready = function(cb) {
    readies[readies.length] = cb;
};

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

function define(id, deps, factory) {
    if (!factory) {
        if (!deps) {
            deps = id;
            id = null;            
        }
        factory = deps;
        deps = id;
        id = null;
    }

    if (typeof(factory) == "string") {
        frozen[id] = {deps:deps, source:factory};
    } else {
        lastDefines[lastDefines.length] = {deps:deps, factory:factory};
        if (id) {
            if (loaded) {
                finishDefininingModule(id);
            } else {
                queuedName = id;
            }
        }
    }
}
window.define = define;

// *************************************************************************************************

function provide(name, module) {
    modules[name] = module;
    if (queue[name]) {
        var callbacks = queue[name];
        delete queue[name];
        for (var i = 0; i < callbacks.length; ++i) {
            callbacks[i](name, module);
        }
    }
    if (name == mainModuleName) {
        for (var i = 0; i < readies.length; ++i) {
            readies[i]();
        }

        if (has('appjs')) {
            appjs.html = document.doctype + '\n' + document.outerHTML;
        }
    }
}

function loadScript(name, callback) {
    if (name in modules) {
        callback(name, modules[name]);
    } else {
        if (queue[name]) {
            queue[name].push(callback);
        } else {
            queue[name] = [callback];
            ++queued;

            var cached = frozen[name];
            if (cached) {
                var source = cached.source;
                delete frozen[name];
                if (source.length) {
                    var fn = eval(source);
                    defineModule(name, cached.deps, fn);
                } else {
                    provide(name, {id: name});
                }
            } else if (has('appjs')) {
                throw new Error("Not found")
            } else {
                var url = urlForScript(name) + location.search;
                
                var script = document.createElement('script');
                script.type = 'text/javascript';
                script.async = true;
                script.src = url;
                script.onload = function() {
                    if (script.parentNode) {
                        script.parentNode.removeChild(script);
                    }
                    finishDefininingModule(name);
                };
                script.onerror = function() {
                    if (script.parentNode) {
                        script.parentNode.removeChild(script);
                    }
                };

                var head = document.getElementsByTagName("head")[0];
                head.appendChild(script);
            }
        }
    }
}

function finishDefininingModule(name) {
    var defines = lastDefines;
    lastDefines = [];

    if (!mainModuleName) {
        mainModuleName = name;
    }
    
    for (var i = 0; i < defines.length; ++i) {
        var info = defines[i];
        defineModule(name, info.deps, info.factory);
    }
}

function defineModule(name, deps, factory) {
    loadDependencies(name, deps, function(name, params) {
        var module = {id: name, exports: {}};
        modules[name] = module.exports;
                
        function localRequire(name, baseName) {
            return require(name, baseName);
        }
        for (var p in require) {
            localRequire[p] = require[p];
        }

        params.push(localRequire, module.exports, module);
        factory.apply(window, [localRequire, module.exports, module]);

        provide(name, module);
    });
}

function loadDependencies(dependentId, deps, callback) {
    var params = [];
    if (deps && deps.length) {
        var remaining = deps.length;
        for (var i = 0; i < deps.length; ++i) {
            var name = deps[i];
            if (name == 'require' || name == 'exports' || name == 'module') {
                if (!--remaining) {
                    callback(dependentId, params);
                }
            } else {
                name = deps[i] = require.resolve(name, dependentId);
                loadScript(name, function(name, module) {
                    params[deps.indexOf(name)] = module.exports;
                    if (!--remaining) {
                        callback(dependentId, params);
                    }
                });
            }
        }
    } else {
        callback(dependentId, params);
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

function urlForScript(name) {
    var ext = name.substr(name.length-3);
    if (name.indexOf('.') == -1) {
        name += '.js';
    }

    return appjsBase + '/' + name;
}

window.addEventListener("DOMContentLoaded", function() {
    loaded = true;
    if (queuedName) {
        finishDefininingModule(queuedName);        
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
