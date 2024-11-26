const Format = require('./literal/format');

module.exports = {
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    format: content => {
        return Format(content);
    }
}