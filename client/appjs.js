
(function() {

var scriptBasePath = 'app.js/js';
var mainModuleName;
var modules = {};
var queue = {};
var queued = 0;
var lastDefines = [];
var generators = [];
var readies = [];
var frozen = {};

function require(name) {
    name = require.resolve(name);
    if (modules[name]) {
        return modules[name].exports;
    } else if (!queue[name]) {
        loadScript(name, function(){});
    }
}
window.require = require;

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
            finishDefininingModule(id);
        }
    }
}
window.define = define;

function has(feature) {
    if (feature == 'appjs') {
        return !!window.appjs;
    } else {
        // XXXjoe Include the real has.js
        return false;
    }
}
window.has = has;

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

require.ready = function(cb) {
    if (readies) {
        readies[readies.length] = cb;
    } else {
        cb();
    }
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

                document.body.appendChild(script);
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
        
        function localRequire(name, baseName) {
            return require(name, baseName);
        }
        for (var p in require) {
            localRequire[p] = require[p];
        }

        params.push(localRequire, module.exports, module);
        factory.apply(window, params);

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

    return scriptBasePath + '/' + name;
}

})();
