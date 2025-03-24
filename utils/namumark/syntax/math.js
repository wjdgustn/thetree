const utils = require('../utils');

module.exports = {
    openStr: `<math>`,
    closeStr: `</math>`,
    format: content => utils.katex(utils.unescapeHtml(content))
}