const Format = require('./literal/format');

const { Priority } = require('../types');

module.exports = {
    priority: Priority.LiteralFormat,
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    format: content => {
        if(debug) {
            delete require.cache[require.resolve('./literal/format')];
            return require('./literal/format')(content);
        }
        return Format(content);
    }
}