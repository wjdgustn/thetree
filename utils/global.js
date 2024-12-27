const dayjs = require('dayjs');
const dayjsUtc = require('dayjs/plugin/utc');

dayjs.extend(dayjsUtc);

let specialUrls;
let specialChars;

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
    encodeSpecialChars(str) {
        return str.split('').map(a => specialChars.includes(a) ? encodeURIComponent(a) : a).join('');
    },
    doc_action_link(document, route, query = {}) {
        if(typeof specialUrls === 'undefined') specialUrls = [
            '.',
            '..',
            '\\'
        ];

        if(typeof specialChars === 'undefined') specialChars = '?&=+$#'.split('');

        const title = this.doc_fulltitle(document);
        let str;
        if(specialUrls.includes(title)) {
            query.doc = encodeURIComponent(title);
            str = `/${route}`;
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
    getFullDateTag(date, type) {
        const dateObj = dayjs.utc(date);
        const isoStr = dateObj.toISOString();
        const dateStr = dateObj.format('YYYY-MM-DD HH:mm:ss');

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
        return text ? ` (${text})` : '';
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
    durationToString(diff) {
        const relative = new Intl.RelativeTimeFormat();

        let text;
        if(diff < 1000 * 10) text = '방금 전';
        else if(diff < 1000 * 60) text = relative.format(-Math.floor(diff / 1000), 'second');
        else if(diff < 1000 * 60 * 60) text = relative.format(-Math.floor(diff / 1000 / 60), 'minute');
        else if(diff < 1000 * 60 * 60 * 24) text = relative.format(-Math.floor(diff / 1000 / 60 / 60), 'hour');
        else if(diff < 1000 * 60 * 60 * 24 * 30) text = relative.format(-Math.floor(diff / 1000 / 60 / 60 / 24), 'day');

        return text;
    }
}