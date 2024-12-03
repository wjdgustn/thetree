const Format = require('./literal/format');

const { Priority } = require('../types');

module.exports = {
    priority: Priority.LiteralFormat,
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    format: (content, namumark) => {
        if(debug) {
            delete require.cache[require.resolve('./literal/format')];
            return require('./literal/format')(content, namumark);
        }
        return Format(content, namumark);
    }
}