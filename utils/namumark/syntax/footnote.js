const { Priority } = require('../types');

module.exports = {
    priority: Priority.Footnote,
    openStr: '[*',
    closeStr: ']',
    format: (content, namumark) => {
        if(content.includes('<a class="wiki-fn-content"')) return;

        namumark.syntaxData.index ??= 0;
        namumark.syntaxData.numName ??= 0;

        const index = ++namumark.syntaxData.index;
        const values = namumark.footnoteValues;
        const footnoteList = namumark.footnoteList;

        const splittedContent = content.split(' ');

        let name = splittedContent[0] || index.toString();
        const value = values[name] ?? splittedContent.slice(1).join(' ');

        values[name] ??= value;

        footnoteList.push({
            name: name.toString(),
            index
        });

        return `<a class="wiki-fn-content" title="${values[name]}" href="#fn-${name}"><span id="rfn-${index}"></span>[${name}]</a>`;
    }
}