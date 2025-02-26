const dayjs = require('dayjs');
const dayjsUtc = require('dayjs/plugin/utc');

dayjs.extend(dayjsUtc);

let specialUrls;
let specialChars;

module.exports = {
    doc_fulltitle(document) {
        const type = typeof document;

        if(type === 'object') {
            if(document.forceShowNamespace === false) return document.title;
            return `${document.namespace}:${document.title}`;
        }
        else return document;
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
    contribution_link_edit_request(uuid) {
        return `/contribution/${uuid}/edit_request`;
    },
    encodeSpecialChars(str, exclude = []) {
        if(typeof specialChars === 'undefined') specialChars = '?&=+$#%'.split('');
        return str.split('').map(a => specialChars.includes(a) && !exclude.includes(a) ? encodeURIComponent(a) : a).join('');
    },
    doc_action_link(document, route, query = {}) {
        if(typeof specialUrls === 'undefined') specialUrls = [
            '.',
            '..',
            '\\'
        ];

        const title = this.doc_fulltitle(document);
        let str;
        if(specialUrls.includes(title) || route.startsWith('a/')) {
            query.doc = encodeURIComponent(title);
            str = `/${route}/`;
        }
        else str = `/${route}/${this.encodeSpecialChars(title)}`;
        if(Object.keys(query).length > 0) {
            str += '?';
            str += Object.keys(query).filter(k => query[k]).map(k => `${k}=${query[k]}`).join('&');
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
    getTimeStr(date) {
        const dateStr = [
            date.getFullYear(),
            date.getMonth() + 1,
            date.getDate()
        ].map(num => num.toString().padStart(2, '0')).join('-');

        const timeStr = [
            date.getHours(),
            date.getMinutes(),
            date.getSeconds()
        ].map(num => num.toString().padStart(2, '0')).join(':');

        return dateStr + ' ' + timeStr;
    },
    getFullDateTag(date, type) {
        if(!date) return;

        let dateStr = '';
        let isoStr = '';
        if(typeof dayjs !== 'undefined') {
            const dateObj = dayjs.utc(date);
            isoStr = dateObj.toISOString();
            dateStr = dateObj.format('YYYY-MM-DD HH:mm:ss');
        }
        else {
            if(typeof date === 'string') date = new Date(date);
            isoStr = date.toISOString();
            dateStr = this.getTimeStr(date);
        }

        return `<time${type ? ` data-type="${type}"` : ''} datetime="${isoStr}">${dateStr}</time>`;
    },
    getTitleDescription(page) {
        const text = {
            edit_edit_request: '편집 요청',
            edit_request: '편집 요청',
            edit: '편집',
            history: '역사',
            backlinks: '역링크',
            move: '이동',
            delete: '삭제',
            acl: 'ACL',
            thread: '토론',
            thread_list: '토론 목록',
            thread_list_close: '닫힌 토론',
            edit_request_close: '닫힌 편집 요청',
            diff: '비교',
            revert: `r${page.data.rev}로 되돌리기`,
            raw: `r${page.data.rev} RAW`,
            blame: `r${page.data.rev} Blame`,
            wiki: page.data.rev ? `r${page.data.rev}` : '',
        }[page.viewName];

        let additionalText;
        if(page.data.thread) additionalText = page.data.thread.topic;

        return text ? ` (${text})` + (additionalText ? ` - ${additionalText}` : '') : '';
    },
    async waitUntil(promise, timeout = -1) {
        let resolved = false;

        return new Promise((resolve, reject) => {
            let timeoutId;
            if(timeout >= 0) {
                timeoutId = setTimeout(() => {
                    resolve('timeout');
                    resolved = true;
                }, timeout);
            }

            promise.then(result => {
                if(resolved) return;

                if(timeoutId) clearTimeout(timeoutId);
                resolve(result);
            }).catch(error => {
                if(resolved) return;

                if(timeoutId) clearTimeout(timeoutId);
                reject(error);
            });
        });
    },
    durationToString(diff, removeSuffix = false) {
        const relative = new Intl.RelativeTimeFormat('ko');

        let text;
        if(diff < 1000 * 10) text = '방금 전';
        else if(diff < 1000 * 60) text = relative.format(-Math.floor(diff / 1000), 'second');
        else if(diff < 1000 * 60 * 60) text = relative.format(-Math.floor(diff / 1000 / 60), 'minute');
        else if(diff < 1000 * 60 * 60 * 24) text = relative.format(-Math.floor(diff / 1000 / 60 / 60), 'hour');
        else if(diff < 1000 * 60 * 60 * 24 * 30) text = relative.format(-Math.floor(diff / 1000 / 60 / 60 / 24), 'day');

        if(text && removeSuffix) text = text.slice(0, -2);

        return text;
    }
}