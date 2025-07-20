const utils = require('../../utils');

module.exports = str => {
    return `<a id="${utils.escapeHtml(str)}"></a>`;
}