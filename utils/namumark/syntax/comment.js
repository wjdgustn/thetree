module.exports = {
    fullLine: true,
    openStr: '## ',
    format(content) {
        if(!content.startsWith('## ')) return;

        return '';
    }
}