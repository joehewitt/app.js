
(function() {

var scriptBasePath = 'js';
var mainModuleName;
var modules = {};
var queue = {};
var queued = 0;
var lastDefines = [];
var generators = [];
var readies = [];
var frozen = {};

function require(name) {
    name = normalize(name);
    if (modules[name]) {
        return modules[name];
    } else if (!queue[name]) {
        loadScript(name, function(){});
    }
}

function provide(name, module) {
    modules[name] = module;
    if (queue[name]) {
        var callbacks = queue[name];
        delete queue[name];
        for (var i = 0; i < callbacks.length; ++i) {
            callbacks[i](name, module);
        }
    }
    if (module.ready) {
        require.ready(module.ready);
    }
    if (name == mainModuleName) {
        isReady();
    }
}

function define(id, deps, factory, freeze) {
    if (!factory) {
        if (!deps) {
            deps = id;
            id = null;            
        }
        factory = deps;
        deps = id;
        id = null;
    }

    if (freeze) {
        var source = factory+'';
        var s1 = source.indexOf('/*');
        var s2 = source.lastIndexOf('*/');
        source = source.substr(s1+2, s2-(s1+2));
        frozen[id] = {deps:deps, source:source};
    } else {
        lastDefines[lastDefines.length] = {deps:deps, factory:factory};
        if (id) {
            finishDefininingModule(id);
        }
    }
}

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

// *************************************************************************************************

function loadScript(name, callback) {
    if (name in modules) {
        callback(name, modules[name]);
    } else {
        if (queue[name]) {
            queue[name].push(callback);
        } else {
            queue[name] = [callback];
            ++queued;

            var url = urlForScript(name);
            var cached = frozen[name];
            if (cached) {
                var source = cached.source;
                delete frozen[name];
                if (source.length) {
                    var fn = eval(source);
                    defineModule(name, cached.deps, fn);
                } else {
                    provide(name, {});
                }
            } else {
                var script = document.createElement('script');
                script.type = 'text/javascript';
                script.src = url + location.search;
                script.onload = function() {
                    script.parentNode.removeChild(script);
                    finishDefininingModule(name);
                };
                script.onerror = function() {
                    script.parentNode.removeChild(script);
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
        var exportsIndex = deps.indexOf('exports');
        var exports = modules[name] = {};
        var previousModule = require.currentModule;
        require.currentModule = name;
        if (exportsIndex != -1) {
            params[exportsIndex] = exports;
            factory.apply(window, params);
        } else {
            exports = modules[name] = factory.apply(window, params);
        }
        require.currentModule = previousModule;
        provide(name, exports);
    });
}

function loadDependencies(dependentId, deps, callback) {
    var params = [];
    if (deps && deps.length) {
        var remaining = deps.length;
        for (var i = 0; i < deps.length; ++i) {
            var name = deps[i];
            if (name == 'exports') {
                if (!--remaining) {
                    callback(dependentId, params);
                }
            } else {
                name = deps[i] = normalize(name, dependentId);
                loadScript(name, function(name, module) {
                    params[deps.indexOf(name)] = module;
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

function normalize(name, baseName) {
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
}

function urlForScript(name) {
    var ext = name.substr(name.length-3);
    if (name.indexOf('.') == -1) {
        name += '.js';
    }

    return scriptBasePath + '/' + name;
}
require.normalize = normalize;

function isReady(cb) {
    for (var i = 0; i < readies.length; ++i) {
        readies[i]();
    }

    var mainModule = require(mainModuleName);
    var destination = mainModule.destination;
    if (destination && destination.render) {
        destination.render();
    }
};

// *************************************************************************************************

window.require = require;
window.define = define;
    
})();
