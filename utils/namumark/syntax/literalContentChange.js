const ContentChange = require('./literal/contentChange');

const { Priority } = require('../types');

module.exports = {
    priority: Priority.ContentChange,
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    format: (content, namumark) => {
        // if(debug) {
        //     delete require.cache[require.resolve('./literal/format')];
        //     return require('./literal/format')(content, namumark);
        // }
        return ContentChange(content, namumark);
    }
}