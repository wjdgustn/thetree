const globalUtils = require('../../../../utils/global');

module.exports = {
    aliases: ['datetime'],
    format() {
        return globalUtils.getFullDateTag(new Date(), 'timezone');
    }
}