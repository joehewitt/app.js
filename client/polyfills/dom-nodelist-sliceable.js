
Array.prototype.slice = function(start, end) {
    var arr = [];
    if (start === undefined && end === undefined) {
        for (var i=this.length;i--;arr.unshift(this[i]));        
    } else if (end === undefined) {
        for (var i = start; i < this.length; ++i) { arr.push(this[i]) }
    } else {
        for (var i = start; i < end && i < this.length; ++i) { arr.push(this[i]) }
    }
    return arr;
};
