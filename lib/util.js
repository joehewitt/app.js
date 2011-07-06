
exports.safeBind = function(cb, fn, self) {
	return function(err, result) {
		if (err) { cb(err); return; }

		try {
			fn.apply(self, arguments);	
		} catch (exc) {
			console.log(exc.stack)
			cb(exc);
		}
	}
}
