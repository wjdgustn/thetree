const utils = require('../../utils');

module.exports = params => {
    return utils.katex(utils.unescapeHtml(params));
}