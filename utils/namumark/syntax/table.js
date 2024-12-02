const { Priority } = require('../types');

module.exports = {
    fullLine: true,
    priority: Priority.Table,
    openStr: '||',
    makeTable(content, namumark, fromLastLine = false) {
        const rows = namumark.syntaxData.rows ??= [];
        if(!rows.length) return content;

        console.log('=== make table! ===');
        console.log(rows);

        rows.length = 0;

        return 'wow table' + '\n' + (fromLastLine ? '' : content);
    },
    format(content, namumark, _, isLastLine) {
        console.log(content);
        const rows = namumark.syntaxData.rows ??= [];
        const rowText = namumark.syntaxData.rowText ??= '';

        const makeTable = (fromLastLine = false) => this.makeTable(content, namumark, fromLastLine);

        const trimedContent = content.trim();
        if(!trimedContent.startsWith('||') && !rowText) {
            return makeTable();
        }

        const newRowText = namumark.syntaxData.rowText += (rowText ? '\n' : '') + content;

        if(newRowText.endsWith('||')) {
            rows.push(newRowText);
            namumark.syntaxData.rowText = '';
        }

        if(isLastLine) return makeTable(true);

        return '';
    }
}