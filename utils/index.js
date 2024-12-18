const crypto = require('crypto');

const {
    UserTypes,
    HistoryTypes
} = require('./types');

const User = require('../schemas/user');

module.exports = {
    getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max + 1);
        return Math.floor(Math.random() * (max - min)) + min;
    },
    withoutKeys(obj, keys = []) {
        return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
    },
    getGravatar(email) {
        const hash = crypto.createHash('sha256').update(email).digest('hex');
        return `//secure.gravatar.com/avatar/${hash}?d=retro`;
    },
    parseDocumentName(name) {
        const originalName = name.trim();
        const splitedName = originalName.split(':');
        const probablyNamespace = splitedName.length > 1 ? splitedName[0] : null;
        const namespaceExists = config.namespaces.includes(probablyNamespace);
        const namespace = namespaceExists ? probablyNamespace : '문서';
        let title = namespaceExists ? splitedName.slice(1).join(':') : originalName;

        let forceShowNamespace = null;

        const splitedTitle = title.split(':');
        const splitedTitleNamespace = splitedTitle.length > 1 ? splitedTitle[0] : null;
        if(config.namespaces.includes(splitedTitleNamespace)) forceShowNamespace = true;
        else if(namespace === '문서') forceShowNamespace = false;

        // let anchor;
        // if(title.includes('#')) {
        //     const splittedTitle = title.split('#');
        //     anchor = splittedTitle.pop();
        //     title = splittedTitle.join('#');
        // }

        return {
            namespace,
            title,
            forceShowNamespace,
            // anchor
        }
    },
    camelToSnakeCase(str) {
        return str.replace(/(.)([A-Z][a-z]+)/, '$1_$2').replace(/([a-z0-9])([A-Z])/, '$1_$2').toLowerCase();
    },
    renderCategory: (categories = [], fromWiki = false) => new Promise((resolve, reject) => {
        expressApp.render('category', {
            categories,
            fromWiki
        }, (err, html) => {
            if(err) {
                console.error(err);
                reject(err);
            }

            resolve(html.replaceAll('\n', '').trim());
        });
    }),
    compareArray: (arr1, arr2) => {
        if(!Array.isArray(arr1) || !Array.isArray(arr2)) return false;
        if(arr1.length !== arr2.length) return false;

        for(let i = 0; i < arr1.length; i++)
            if(arr1[i] !== arr2[i]) return false;

        return true;
    },
    removeHtmlTags: text => text
        .replaceAll(/<[^>]+>/g, ''),
    getKeyFromObject(obj, value) {
        for(const key in obj) {
            if(obj[key] === value) return key;
        }
        return null;
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
    async findUsers(arr) {
        for(let obj of arr) {
            if(obj.user) obj.user = await User.findOne({
                uuid: obj.user
            });
        }

        return arr;
    },
    addHistoryData(rev) {
        rev.infoText = null;

        if(rev.type === HistoryTypes.ACL) {
            rev.infoText = `${rev.log}으로 ACL 변경`
            rev.log = null;
        }
        else if(rev.type === HistoryTypes.Create) {
            rev.infoText = '새 문서';
        }

        rev.userHtml = '<span class="user-text">' + (rev.user
            ? `<a class="user-text-name${rev.user.type === UserTypes.Account ? ' user-text-member' : ''}" href="/w/사용자:${rev.user.name}">${rev.user.name}</a>`
            : `<span class="user-text-name user-text-deleted">(삭제된 사용자)</span>`)
            + '</span>';

        const diffClassList = ['diff-text'];

        if(rev.diffLength > 0) diffClassList.push('diff-add');
        else if(rev.diffLength < 0) diffClassList.push('diff-remove');

        rev.diffHtml = `<span>(<span class="${diffClassList.join(' ')}">${rev.diffLength > 0 ? '+' : ''}${rev.diffLength ?? 0}</span>)</span>`;

        return rev;
    }
}