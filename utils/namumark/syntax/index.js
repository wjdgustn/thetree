const { Priority } = require('../types');

module.exports = class Syntax {
    priority = Priority.Common;

    openStr = '';
    openOnlyForLineFirst = false;
    closeStr = '';
    closeOnlyForLineLast = false;

    allowNewLine = false;

    constructor(parser) {
        if(!parser) return;
        this.parser = parser;
    }

    _open = false;
    _openStack = '';
    feed(char) {
        this._openStack += char;

        const slicedOpenStr = this.openStr.slice(0, this._openStack.length);
        if(slicedOpenStr !== this._openStack) {
            this._openStack = '';
        }

        return openStr.length === this._openStack.length;
    }
}