const utils = require('../../utils');

module.exports = {
    allowThread: true,
    format(params) {
        return utils.katex(params);
    }
}