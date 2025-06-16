const utils = require('../../utils');

const Vote = require('../../../../schemas/vote');

module.exports = {
    allowThread: true,
    async format(params, options, obj) {
        return 'vote';
    }
}