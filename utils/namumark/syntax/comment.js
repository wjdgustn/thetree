module.exports = {
    fullLine: true,
    openStr: '## ',
    format(content) {
        if(!content.startsWith('## ') && !content.startsWith('##@ ')) return;

        return '';
    }
}