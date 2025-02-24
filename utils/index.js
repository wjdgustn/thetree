const { models } = require('mongoose');
const crypto = require('crypto');
const { Address4, Address6 } = require('ip-address');
const Diff = require('diff');
const { generateSlug } = require('random-word-slugs');
const axios = require('axios');
const querystring = require('querystring');

const globalUtils = require('./global');
const namumarkUtils = require('./namumark/utils');
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
    onlyKeys(obj, keys = []) {
        return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));
    },
    withoutKeys(obj, keys = []) {
        return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
    },
    getGravatar(email) {
        const hash = crypto.createHash('sha256').update(email).digest('hex');
        return `//secure.gravatar.com/avatar/${hash}?d=retro`;
    },
    parseDocumentName(name) {
        name = name.slice(0, 255);
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
        let ipArr;
        if(user.ip) {
            if(Address4.isValid(user.ip)) ipArr = new Address4(user.ip).toArray();
            else ipArr = new Address6(user.ip).toByteArray();
        }

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
            $and: [
                {
                    $or: [
                        {
                            expiresAt: {
                                $gte: new Date()
                            }
                        },
                        {
                            expiresAt: null
                        }
                    ]
                },
                {
                    $or: [
                        {
                            user: user.uuid
                        },
                        ...(ipArr ? [{
                            ipMin: {
                                $lte: ipArr
                            },
                            ipMax: {
                                $gte: ipArr
                            }
                        }] : [])
                    ]
                }
            ]
        }).lean();
        if(!aclGroupItem) return '';

        const aclGroup = aclGroups.find(group => group.uuid === aclGroupItem.aclGroup);
        return aclGroup.userCSS;
    },
    async findUsers(arr, key = 'user', noCSS = false) {
        let wasNotArr = false;
        if(!Array.isArray(arr)) {
            arr = [arr];
            wasNotArr = true;
        }
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

        if(wasNotArr) return arr[0];
        return arr;
    },
    userHtml(user, {
        isAdmin = false,
        note = null,
        thread = false,
        threadAdmin = false
    } = {}) {
        const name = user?.name ?? user?.ip;
        const link = user?.type === UserTypes.Account ? `/w/사용자:${name}` : `/contribution/${user?.uuid}/document`;

        let dataset = '';
        const data = {};

        if(isAdmin) {
            if(note) data.note = note;
        }
        if(user.type !== UserTypes.Deleted || isAdmin) data.uuid = user.uuid;
        data.type = user.type;
        if(threadAdmin) data.threadadmin = '1';
        if(['admin', 'developer'].some(a => user.permissions?.includes(a))) data.admin = '1';

        for(let [key, value] of Object.entries(data))
            dataset += ` data-${key}="${value}"`;

        let nameClass = '';
        if(thread) {
            if(threadAdmin) nameClass = ' user-text-admin';
        }
        else nameClass = user.type ? ` user-text-${this.getKeyFromObject(UserTypes, user.type).toLowerCase()}` : '';

        return '<span class="user-text">' + (user && user.type !== UserTypes.Deleted
                ? `<a class="user-text-name${nameClass}" href="${link}"${user.userCSS ? ` style="${user.userCSS}"` : ''}${dataset}>${name}</a>`
                : `<span class="user-text-name user-text-deleted"${dataset}>(삭제된 사용자)</span>`)
            + '</span>';
    },
    addHistoryData(rev, isAdmin = false, document = null) {
        document ??= rev.document;

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
            rev.htmlInfoText = `<b>${namumarkUtils.escapeHtml(rev.moveOldDoc)}</b>에서 <b>${namumarkUtils.escapeHtml(rev.moveNewDoc)}</b>로 문서 이동`;
        }

        if(rev.infoText) rev.htmlInfoText ??= namumarkUtils.escapeHtml(rev.infoText);

        rev.userHtml = this.userHtml(rev.user, {
            isAdmin,
            note: document ? `${globalUtils.doc_fulltitle(document)} r${rev.rev} 긴급차단` : null
        });

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
                if(typeof obj.document !== 'string') continue;

                if(cache[obj.document]) {
                    obj.document = cache[obj.document];
                    continue;
                }

                obj.document = await models.Document.findOne({
                    uuid: obj.document
                }).lean();
                if(obj.document) {
                    obj.document.parsedName = this.parseDocumentName(`${obj.document.namespace}:${obj.document.title}`);
                    cache[obj.document.uuid] = obj.document;
                }
            }
        }

        return arr;
    },
    escapeRegExp(s) {
        return s.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },
    async makeACLData(req) {
        req.permissions = [...(req.user?.permissions ?? [])].sort();

        req.permissions.unshift('any');

        if(req.user?.type === UserTypes.Account) {
            req.permissions.unshift('member');
            if(req.user.createdAt < Date.now() - 1000 * 60 * 60 * 24 * 15)
                req.permissions.push('member_signup_15days_ago');
        }
        else req.permissions.unshift('ip');

        if(req.useragent?.isBot) req.permissions.push('bot');

        if(req.session.contributor) req.permissions.push('contributor');
        else if(req.user) {
            const contribution = await models.History.exists({
                user: req.user.uuid
            });
            if(contribution) {
                req.permissions.push('contributor');
                req.session.contributor = true;
                req.session.save();
            }
        }

        req.permissions = [...new Set(req.permissions)];
        // if(req.user) req.user.permissions = req.permissions;
        req.displayPermissions = req.permissions.filter(a => ![
            'any',
            'contributor',
            'member_signup_15days_ago'
        ].includes(a));

        req.aclData = {
            permissions: [...req.permissions],
            user: req.user,
            ip: req.ip
        }
    },
    async findThreads(arr) {
        const cache = {};

        for(let obj of arr) {
            if(obj?.thread) {
                if(cache[obj.thread]) {
                    obj.thread = cache[obj.thread];
                    continue;
                }

                obj.thread = await models.Thread.findOne({
                    uuid: obj.thread
                }).lean();
                if(obj.thread) {
                    cache[obj.thread.uuid] = obj.thread;
                }
            }
        }

        const threads = await this.findDocuments(arr.map(obj => obj.thread));
        for(let i in threads) {
            arr[i].thread = threads[i];
        }

        return arr;
    },
    async generateDiff(oldText, newText, changeAroundLines = 3) {
        oldText = oldText?.replaceAll('\r\n', '\n');
        newText = newText?.replaceAll('\r\n', '\n');

        const lineDiffResult = await new Promise(resolve => {
            Diff.diffLines(oldText || '', newText || '', {
                timeout: 5000,
                callback: resolve
            });
        });
        const lineDiff = lineDiffResult.map(a => ({
            ...a,
            value: namumarkUtils.escapeHtml(a.value.endsWith('\n') ? a.value.slice(0, -1) : a.value)
        }));
        let diffLines = [];

        let line = 1;
        if(lineDiff.length === 1 && !lineDiff[0].added && !lineDiff[0].removed) {
            const diff = lineDiff[0];
            const lines = diff.value.split('\n');
            for(let i in lines) {
                i = parseInt(i);
                const content = lines[i];
                diffLines.push({
                    class: 'equal',
                    line: line + i,
                    content
                });
            }
        }
        else for(let i = 0; i < lineDiff.length; i++) {
            const prev = lineDiff[i - 1];
            const curr = lineDiff[i];
            const next = lineDiff[i + 1];

            if(prev) line += prev.count;

            let lines = curr.value.split('\n');
            if(!curr.added && !curr.removed) {
                const linesLen = lines.length;

                if(i !== 0) {
                    const firstLines = lines.slice(0, changeAroundLines);
                    for(let j in firstLines) {
                        j = parseInt(j);
                        content = firstLines[j];

                        const lastDiffLine = diffLines[diffLines.length - 1];
                        if(lastDiffLine.line >= line + j) continue;

                        diffLines.push({
                            class: 'equal',
                            line: line + j,
                            content
                        });
                    }

                    lines = lines.slice(changeAroundLines);
                }

                if(i !== lineDiff.length - 1) {
                    const lastLines = lines.slice(-changeAroundLines);
                    for(let j in lastLines) {
                        j = parseInt(j);
                        content = lastLines[j];
                        diffLines.push({
                            class: 'equal',
                            line: line + linesLen - changeAroundLines + j + (lines.length < changeAroundLines ? changeAroundLines - lines.length : 0),
                            content
                        });
                    }
                }
            }
            else if(curr.removed) {
                if(next?.added) {
                    const nextLines = next.value.split('\n');

                    const currArr = [];
                    const nextArr = [];

                    let lineCompared = false;
                    for(let j = 0; j < Math.max(lines.length, nextLines.length); j++) {
                        const content = lines[j];
                        const nextContent = nextLines[j];

                        if(content != null && nextContent != null) {
                            if(content === nextContent) {
                                diffLines.push({
                                    class: 'equal',
                                    line: line + j,
                                    content
                                });
                                continue;
                            }

                            lineCompared = true;

                            const diff = await new Promise(resolve => {
                                Diff.diffChars(namumarkUtils.unescapeHtml(content), namumarkUtils.unescapeHtml(nextContent), {
                                    timeout: 1000,
                                    callback: resolve
                                });
                            });
                            // if(!diff) throw new Error('diff timeout');
                            let c = '';
                            let n = '';
                            if(!diff) {
                                c += content;
                                n += nextContent;
                            }
                            else for(let d of diff) {
                                if(!d.added && !d.removed) {
                                    const val = namumarkUtils.escapeHtml(d.value);
                                    c += val;
                                    n += val;
                                }
                                else if(d.added) n += `<ins class="diff">${namumarkUtils.escapeHtml(d.value)}</ins>`;
                                else if(d.removed) c += `<del class="diff">${namumarkUtils.escapeHtml(d.value)}</del>`;
                            }

                            currArr.push({
                                class: 'delete',
                                line: line + j,
                                content: c
                            });
                            nextArr.push({
                                class: 'insert',
                                line: line + j,
                                content: n
                            });
                        }
                        else if(content != null) currArr.push({
                            class: 'delete',
                            line: line + j,
                            content: lineCompared ? `<del class="diff">${content}</del>` : content,
                            nextOffset: Number(lineCompared)
                        });
                        else if(nextContent != null) nextArr.push({
                            class: 'insert',
                            line: line + j,
                            content: lineCompared ? `<ins class="diff">${nextContent}</ins>` : nextContent,
                            nextOffset: Number(lineCompared)
                        });
                    }

                    diffLines.push(...currArr);
                    diffLines.push(...nextArr);

                    i++;
                }
                else for(let j in lines) {
                    j = parseInt(j);
                    content = lines[j];
                    diffLines.push({
                        class: 'delete',
                        line: line + j,
                        content
                    });
                }
            }
            else if(curr.added) for(let j in lines) {
                j = parseInt(j);
                content = lines[j];
                diffLines.push({
                    class: 'insert',
                    line: line + j,
                    content
                });
            }
        }

        return {
            lineDiff,
            diffLines,
            changeAroundLines
        }
    },
    generateUrl() {
        return generateSlug(4, {
            format: 'title'
        }).replaceAll(' ', '');
    },
    mergeText(oldText, newText, targetText) {
        const patch = Diff.structuredPatch('text', 'text', oldText, newText);
        const result = Diff.applyPatch(targetText, patch);
        if(!result) return null;

        return result;
    },
    async validateCaptcha(req) {
        if(!config.captcha.enabled || req.permissions.includes('no_force_captcha')) return true;

        const response = req.body[{
            recaptcha: 'g-recaptcha-response',
            turnstile: 'cf-turnstile-response'
        }[config.captcha.type]];
        if(!response) return false;

        const { data } = await axios.post({
            recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
            turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
        }[config.captcha.type], querystring.stringify({
            secret: config.captcha.secret_key,
            response,
            remoteip: req.ip
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        return data.success;
    },
    async middleValidateCaptcha(req, res) {
        const result = await this.validateCaptcha(req);
        if(!result) {
            res.status(400).send('캡챠가 유효하지 않습니다.');
            return false;
        }

        return true;
    },
    async pagination(req, model, baseQuery, key, sortKey, {
        limit, sortDirection, pageQuery
    } = {}) {
        sortDirection ??= -1;
        const $gte = sortDirection === -1 ? '$gte' : '$lte';
        const $lte = sortDirection === -1 ? '$lte' : '$gte';
        const $gt = sortDirection === -1 ? '$gt' : '$lt';
        const $lt = sortDirection === -1 ? '$lt' : '$gt';

        const query = { ...baseQuery };
        pageQuery ??= req.query.until || req.query.from;
        if(pageQuery) {
            const doc = await model.findOne({
                [key]: pageQuery
            });
            if(doc) {
                if(req.query.until) query[sortKey] = { [$gte]: doc[sortKey] };
                else query[sortKey] = { [$lte]: doc[sortKey] };
            }
        }

        let items = await model.find(query)
            .sort({ [sortKey]: query[sortKey]?.[$gte] ? -sortDirection : sortDirection })
            .limit(limit || 100)
            .lean();
        if(query[sortKey]?.[$gte]) items.reverse();

        let prevItem;
        let nextItem;
        if(items.length) {
            prevItem = await model.findOne({
                ...baseQuery,
                [sortKey]: { [$gt]: items[0][sortKey] }
            })
                .sort({ [sortKey]: -sortDirection })
                .lean();
            nextItem = await model.findOne({
                ...baseQuery,
                [sortKey]: { [$lt]: items[items.length - 1][sortKey] }
            })
                .sort({ [sortKey]: sortDirection })
                .lean();
        }

        const link = query => `${req.path}?${querystring.stringify({
            ...this.withoutKeys(req.query, [query.from ? 'until' : 'from']),
            ...query
        })}`;
        const originalPageButton = await new Promise(async (resolve, reject) => {
            expressApp.render('components/pageButton', {
                prevLink: prevItem ? link({
                    until: prevItem[key].toString()
                }) : null,
                nextLink: nextItem ? link({
                    from: nextItem[key].toString()
                }) : null
            }, (err, html) => {
                if(err) reject(err);
                resolve(html);
            });
        });

        return {
            items,
            prevItem,
            nextItem,
            pageButton: `<div class="navigation-div navigation-page">${originalPageButton}</div>`,
            originalPageButton
        }
    },
    durationToExactString(duration) {
        const strs = [];

        let weeks = 0;
        const week = 1000 * 60 * 60 * 24 * 7;
        while(duration >= week) {
            duration -= week;
            weeks++;
        }
        if(weeks) strs.push(`${weeks}주`);

        let days = 0;
        const day = 1000 * 60 * 60 * 24;
        while(duration >= day) {
            duration -= day;
            days++;
        }
        if(days) strs.push(`${days}일`);

        let hours = 0;
        const hour = 1000 * 60 * 60;
        while(duration >= hour) {
            duration -= hour;
            hours++;
        }
        if(hours) strs.push(`${hours}시간`);

        let minutes = 0;
        const minute = 1000 * 60;
        while(duration >= minute) {
            duration -= minute;
            minutes++;
        }
        if(minutes) strs.push(`${minutes}분`);

        let seconds = 0;
        const second = 1000;
        while(duration >= second) {
            duration -= second;
            seconds++;
        }
        if(seconds) strs.push(`${seconds}초`);

        return strs.join(' ');
    },
    async createLoginHistory(user, req, data = {}) {
        const device = [
            req.get('Sec-CH-UA-Platform'),
            req.get('Sec-CH-UA-Platform-Version'),
            req.get('Sec-CH-UA-Model')
        ]
            .map(a => a?.slice(1, -1))
            .filter(a => a)
            .join(' ');

        return models.LoginHistory.create({
            uuid: user.uuid,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            device: device.join(' '),
            ...data
        });
    }
}