const dayjs = require('dayjs');

module.exports = {
    doc_fulltitle(document) {
        const type = typeof document;

        if(type === 'string') return document;
        if(type === 'object') {
            if(document.forceShowNamespace === false) return document.title;
            return `${document.namespace}:${document.title}`;
        }
    },
    user_doc(str) {
        return `사용자:${str}`;
    },
    contribution_link(uuid) {
        return `/contribution/${uuid}/document`;
    },
    contribution_link_discuss(uuid) {
        return `/contribution/${uuid}/discuss`;
    },
    doc_action_link(document, route, query = {}) {
        let str = `/${route}/${this.doc_fulltitle(document)}`;
        if(Object.keys(query).length > 0) {
            str += '?';
            str += Object.keys(query).map(k => `${k}=${query[k]}`).join('&');
        }
        return str;
    },
    getDateStr(date) {
        const now = Date.now();
        const dateObj = new Date(date);
        const olderThanToday = (now - 1000 * 60 * 60 * 24) > date;
        return (olderThanToday
            ? [
                dateObj.getFullYear(),
                dateObj.getMonth() + 1,
                dateObj.getDate()
            ]
            : [
                dateObj.getHours(),
                dateObj.getMinutes(),
                dateObj.getSeconds()
            ]).map(a => a.toString().padStart(2, '0')).join(olderThanToday ? '/' : ':');
    },
    getFullDateTag(date) {
        const dateObj = dayjs(date);
        const isoStr = dateObj.toISOString();
        const dateStr = dateObj.format('YYYY-MM-DD HH:mm:ss');

        return `<time datetime="${isoStr}">${dateStr}</time>`;
    }
}