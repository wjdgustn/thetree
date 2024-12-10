const { Priority } = require('../types');
const postProcess = require('../postProcess');

module.exports = {
    priority: Priority.Last,
    openStr: '<*',
    closeStr: '*>',
    escapeOpenAndClose: false,
    allowMultiline: true,
    format(content) {
        return postProcess(content, true);
    }
}