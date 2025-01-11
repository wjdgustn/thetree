const { Priority } = require('../types');
const utils = require('../../../utils');

module.exports = {
    priority: Priority.Footnote,
    openStr: '[*',
    closeStr: ']',
    format: async (content, namumark, originalContent, i, sourceText, options) => {
        if(options.removeFootnote) return '';
        if(content.includes('<a class="wiki-fn-content"')) return;

        namumark.syntaxData.index ??= 0;
        namumark.syntaxData.numName ??= 0;

        const index = ++namumark.syntaxData.index;
        const values = namumark.footnoteValues;
        const footnoteList = namumark.footnoteList;

        const splittedContent = content.split(' ');

        let name = splittedContent[0] || index.toString();
        const value = values[name] ?? splittedContent.slice(1).join(' ');

        values[name] ??= (await namumark.parse(value, true, true)).html;

        footnoteList.push({
            name: name.toString(),
            index
        });

        const commentPrefix = namumark.commentId ? `tc${namumark.commentId}-` : '';
        return `<a class="wiki-fn-content" title="${utils.removeHtmlTags(values[name])}" href="#${commentPrefix}fn-${name}"><span id="${commentPrefix}rfn-${index}"></span>[${name}]</a>`;
    }
}