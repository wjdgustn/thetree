const { Priority } = require('../types');

module.exports = {
    priority: Priority.Comment,
    fullLine: true,
    openStr: '##',
    format(content) {
        if(!content.startsWith('##') && !content.startsWith('##@')) return;

        return '';
    }
}