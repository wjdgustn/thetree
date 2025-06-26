module.exports = {
    aliases: ['목차'],
    allowThread: true,
    async format(params, { heading }) {
        return heading.html;
    }
}