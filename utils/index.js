const { models } = require('mongoose');
const crypto = require('crypto');

const {
    UserTypes,
    HistoryTypes
} = require('./types');

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
            namespaceExists
            // anchor
        }
    },
    dbDocumentToDocument(dbDocument) {
        return this.parseDocumentName(`${dbDocument.namespace}:${dbDocument.title}`);
    },
    camelToSnakeCase(str) {
        return str.replace(/(.)([A-Z][a-z]+)/, '$1_$2').replace(/([a-z0-9])([A-Z])/, '$1_$2').toLowerCase();
    },
    renderCategory: (categories = [], fromWiki = false) => new Promise((resolve, reject) => {
        expressApp.render('components/category', {
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
    renderCategoryDocument: data => new Promise((resolve, reject) => {
        expressApp.render('document/category', {
            ...data
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
    async getUserCSS(user) {
        const aclGroups = await models.ACLGroup.find({
            userCSS: {
                $exists: true,
                $ne: ''
            }
        }).lean();
        const aclGroupItem = await models.ACLGroupItem.findOne({
            aclGroup: {
                $in: aclGroups.map(group => group.uuid)
            },
            $or: [
                {
                    expiresAt: {
                        $gte: new Date()
                    }
                },
                {
                    expiresAt: null
                }
            ],
            user: user.uuid
        }).lean();
        if(!aclGroupItem) return '';

        const aclGroup = aclGroups.find(group => group.uuid === aclGroupItem.aclGroup);
        return aclGroup.userCSS;
    },
    async findUsers(arr, key = 'user', noCSS = false) {
        const cache = {};

        for(let obj of arr) {
            if(obj?.[key]) {
                if(cache[obj[key]]) {
                    obj[key] = cache[obj[key]];
                    continue;
                }

                const uuid = obj[key];
                obj[key] = await models.User.findOne({
                    uuid
                }).lean();
                if(obj[key]) {
                    if(!noCSS) obj[key].userCSS = await this.getUserCSS(obj[key]);
                    cache[obj[key].uuid] = obj[key];
                }
                else obj[key] = {
                    type: UserTypes.Deleted,
                    uuid
                }
            }
        }

        return arr;
    },
    userHtml(user, {
        isAdmin = false,
        document = null,
        thread = null
    } = {}) {
        const name = user?.name ?? user?.ip;
        const link = user?.type === UserTypes.Account ? `/w/사용자:${name}` : `/contribution/${user?.uuid}/document`;

        let dataset = '';
        const data = {};

        if(isAdmin) data.uuid = user.uuid;
        data.type = user.type;

        for(let [key, value] of Object.entries(data))
            dataset += ` data-${key}="${value}"`;

        return '<span class="user-text">' + (user && user.type !== UserTypes.Deleted
                ? `<a class="user-text-name${user.type ? ` user-text-${this.getKeyFromObject(UserTypes, user.type).toLowerCase()}` : ''}" href="${link}"${user.userCSS ? ` style="${user.userCSS}"` : ''}${dataset}>${name}</a>`
                : `<span class="user-text-name user-text-deleted"${dataset}>(삭제된 사용자)</span>`)
            + '</span>';
    },
    addHistoryData(rev, isAdmin = false) {
        rev.infoText = null;

        if(rev.type === HistoryTypes.ACL) {
            rev.infoText = `${rev.log}으로 ACL 변경`
            rev.log = null;
        }
        else if(rev.type === HistoryTypes.Create) {
            rev.infoText = '새 문서';
        }
        else if(rev.type === HistoryTypes.Revert) {
            rev.infoText = `r${rev.revertRev}으로 되돌림`
        }
        else if(rev.type === HistoryTypes.Delete) {
            rev.infoText = `삭제`
        }
        else if(rev.type === HistoryTypes.Move) {
            rev.infoText = `${rev.moveOldDoc}에서 ${rev.moveNewDoc}로 문서 이동`;
        }

        rev.userHtml = this.userHtml(rev.user, { isAdmin });

        const diffClassList = ['diff-text'];

        if(rev.diffLength > 0) diffClassList.push('diff-add');
        else if(rev.diffLength < 0) diffClassList.push('diff-remove');

        rev.pureDiffHtml = `<span class="${diffClassList.join(' ')}">${rev.diffLength > 0 ? '+' : ''}${rev.diffLength ?? 0}</span>`;
        rev.diffHtml = `<span>(${rev.pureDiffHtml})</span>`;

        return rev;
    },
    async findHistories(arr, isAdmin = false) {
        const cache = {};

        for(let obj of arr) {
            if(obj?.uuid) {
                if(cache[obj.uuid]) {
                    obj.history = cache[obj.uuid];
                    obj.user = obj.history.user;
                    continue;
                }

                obj.history = await models.History.findOne({
                    uuid: obj.uuid
                }).lean();
                if(obj.history) {
                    obj.history = this.addHistoryData(obj.history, isAdmin);
                    cache[obj.uuid] = obj.history;
                    obj.user = obj.history.user;
                }
            }
        }

        return arr;
    },
    increaseBrightness(hex, percent) {
        hex = hex.replace(/^\s*#|\s*$/g, '');

        if(hex.length === 3) {
            hex = hex.replace(/(.)/g, '$1$1');
        }

        const r = parseInt(hex.substr(0, 2), 16),
            g = parseInt(hex.substr(2, 2), 16),
            b = parseInt(hex.substr(4, 2), 16);

        return '#' +
            ((0|(1<<8) + r + (256 - r) * percent / 100).toString(16)).substr(1) +
            ((0|(1<<8) + g + (256 - g) * percent / 100).toString(16)).substr(1) +
            ((0|(1<<8) + b + (256 - b) * percent / 100).toString(16)).substr(1);
    },
    async findDocuments(arr) {
        const cache = {};

        for(let obj of arr) {
            if(obj?.document) {
                if(cache[obj.document]) {
                    obj.document = cache[obj.uuid];
                    continue;
                }

                obj.document = await models.Document.findOne({
                    uuid: obj.document
                }).lean();
                if(obj.document) {
                    obj.document.parsedName = this.parseDocumentName(`${obj.document.namespace}:${obj.document.title}`);
                    cache[obj.uuid] = obj.document;
                }
            }
        }

        return arr;
    },
    escapeRegExp(s) {
        return s.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}