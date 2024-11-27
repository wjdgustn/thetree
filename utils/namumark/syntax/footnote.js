const { Priority } = require('../types');

module.exports = {
    priority: Priority.Footnote,
    openStr: '[*',
    closeStr: ']',
    format: (content, namumark) => {
        namumark.syntaxData.numName ??= 0;
        const values = namumark.syntaxData.values ??= {};

        const splittedContent = content.split(' ');

        let name = splittedContent[0] || ++namumark.syntaxData.numName;
        const value = values[name] ?? splittedContent.slice(1).join(' ');

        values[name] ??= value;

        return JSON.stringify({name, value});
    }
}