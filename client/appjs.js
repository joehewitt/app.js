
(function() {

var scriptBasePath = 'js';
var staticBasePath = 'static';
var mainModuleName = document.documentElement.getAttribute('app');
var modules = {};
var queue = {};
var lastDefines = [];
var generators = [];
var readies = [];

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

function define(deps, factory) {
    if (!factory) {
        factory = deps;
        deps = [];
    }

    lastDefines[lastDefines.length] = {deps:deps, factory:factory};    
}

require.style = function(relativePath) {
    lastDefines[lastDefines.length] = {style:relativePath};    
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

            var url = urlForScript(name);
            var cached = document.getElementById('appjs/js/'+name);
            if (cached) {
                var source = cached.innerHTML;
                cached.parentNode.removeChild(cached);
                if (source.length) {
                    eval(source);
                    finishDefininingModule(name);
                } else {
                    provide(name, {});
                }
            } else {
                var script = document.createElement('script');
                script.type = 'text/javascript';
                script.src = url;
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
    
    for (var i = 0; i < defines.length; ++i) {
        var info = defines[i];
        if (info.style) {
            defineStyle(info.style, name);
        } else {
            defineModule(name, info.deps, info.factory);
        }
    }
}

function defineStyle(relativePath, baseName) {
    var path = normalize(relativePath, baseName);
    var url = urlForStatic(path);
    var id = 'appjs/'+url;
    var cached = document.getElementById(id);
    if (!cached) {
        var link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = url;
        document.head.appendChild(link);
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

function urlForStatic(name) {
    return staticBasePath + '/' + name;
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

require(mainModuleName);
    
})();
