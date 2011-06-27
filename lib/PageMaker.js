
function PageMaker(app, localURL, baseURL, compress) {
	this.app = app;
	this.localURL = localURL;
	this.baseURL = this.__addTrailingSlash(baseURL);;
	this.compress = compress;
	this.scripts = {};
	this.styles = {};
}
exports.PageMaker = PageMaker;

PageMaker.prototype = {
	__addTrailingSlash: function(s) {
		if (s && s.substr(s.length-1) == '/') {
			return s;
		} else {
			return s + '/';
		}
	}
};
