
var dandy = require('dandy/errors'),
	_ = require('underscore'),
    async = require('async'),
    fs = require('fs'),
	util = require('util'),
    mime = require('mime');

// *************************************************************************************************

var defaultMimeType = 'text/plain';
var htmlMimeType = 'text/html';

var reCDNs = /Amazon\sCloudFront/i;

var debugMode = process.env.NODE_ENV != 'production';

// *************************************************************************************************

exports.sendSafely = function(cb) {
    var res = this;
    var req = res.req;
    try {
        return cb(sbind(function(err, result) {
            if (err) {
                sendError(req, res, err, typeof(err) == 'object' ? err.error : 500, result);
            } else if (result.path) {
            	sendFile(req, res, result);
            } else {
                sendData(req, res, result);
            }
        }, this));
    } catch (exc) {
        sendError(req, res, exc);
    }

    function sbind(fn, self) {
        return function() {
            try {
                return fn.apply(self, arguments);
            } catch (exc) {
                sendError(req, res, exc);                    
            }
        }
    }
}

function sendFile(req, res, result) {
	var mimeType = result.mimeType || (result.path
	    ? mime.lookup(result.path) || defaultMimeType
	    : htmlMimeType);

	if (isTextMimeType(mimeType)) {
	    mimeType += '; charset=UTF-8'
	}

	res.header('Content-Type', mimeType);

	var deps = result.dependencies || [];

    if (result.permanent || isCDN(req)) {
        res.header('Cache-Control', 'public, max-age=31536000');
    } else {
        res.header('Cache-Control', 'public, max-age=0');
    }

    async.waterfall([
    function(next) {
        fs.stat(result.path, next);
    },
    function(stat, next) {
        res.header('ETag', stat.mtime.getTime());

        if (!result.body) {
            fs.readFile(result.path, next);
        } else {
            next(0);
        }
    },
    function(body) {
        if (body) {
            result.body = body;
        }
        res.send(result.body, result.error || 200); 
    }
    ], function(err) {
        sendError(req, res, err, 500);
    });
}

function sendData(req, res, result) {
    res.header('Content-Type', result.mimeType || htmlMimeType);

    if (result.dependencies) {
        res.dependencies = _.pluck(result.dependencies, 'path');

        var latestTime = findLatestMtime(result.dependencies || []);
        if (latestTime) {
            res.header('ETag', latestTime);
        }
    } else if (result.etag) {
        res.header('ETag', result.etag);
    }

    // if (result.permanent) {
        res.header('Cache-Control', 'public, max-age=31536000');
    // } else {
    //     res.header('Cache-Control', 'public, max-age=0');
    // }

    res.send(result.body, 200);
}

function sendError(req, res, err, code, result) {
    dandy.logException(err,
        "Error while loading " + req.url + "\n" + util.inspect(req.headers));

    var body = result && result.body ? result.body : 'Error';
    res.header('Content-Type', result && result.mimeType ? result.mimeType : htmlMimeType);
    res.send(body, code || 500);
}

function findLatestMtime(dependencies) {
    var maxTime = 0;
    _.each(dependencies, function(dep) {
        if (dep.mtime > maxTime) {
            maxTime = dep.mtime;
        }
    });
    return maxTime;
}

function isTextMimeType(mimeType) {
    return mimeType.indexOf('text/') == 0
        || mimeType == 'application/json'
        || mimeType == 'application/javascript'
        || mimeType == 'application/x-javascript';
}

function isCDN(req) {
    var userAgent = req.headers['user-agent'];
    return !!reCDNs.exec(userAgent);
}

