const { models } = require('mongoose');
const crypto = require('crypto');
const { Address4, Address6 } = require('ip-address');
const Diff = require('diff');
const { generateSlug } = require('random-word-slugs');
const axios = require('axios');
const querystring = require('querystring');
const { colorFromUuid } = require('uuid-color');

const globalUtils = require('./global');
const namumarkUtils = require('./newNamumark/utils');
const {
    UserTypes,
    HistoryTypes,
    ACLTypes,
    ThreadCommentTypes,
    ThreadStatusTypes,
    NotificationTypes,
    PermissionFlags,
    AllPermissions
} = require('./types');
const diffLib = require('./diff/lib');
const diffView = require('./diff/view');

module.exports = {
    getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max + 1);
        return Math.floor(Math.random() * (max - min)) + min;
    },
    onlyKeys(obj, keys = []) {
        if(!obj) return obj;
        if(Array.isArray(obj)) return obj.map(a => this.onlyKeys(a, keys));
        obj = JSON.parse(JSON.stringify(obj));
        return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));
    },
    withoutKeys(obj, keys = []) {
        if(!obj) return obj;
        if(Array.isArray(obj)) return obj.map(a => this.withoutKeys(a, keys));
        obj = JSON.parse(JSON.stringify(obj));
        return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
    },
    getGravatar(email) {
        const hash = crypto.createHash('sha256').update(email).digest('hex');
        return `https://secure.gravatar.com/avatar/${hash}?d=retro`;
    },
    parseDocumentName(name, getNamespaceExists = false) {
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
            ...(getNamespaceExists ? {
                namespaceExists
            } : {})
            // anchor
        }
    },
    dbDocumentToDocument(dbDocument) {
        return this.parseDocumentName(`${dbDocument.namespace}:${dbDocument.title}`);
    },camelToSnakeCase(str) {
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
    getKeyFromObject(obj, value) {
        for(const key in obj) {
            if(obj[key] === value) return key;
        }
        return null;
    },
    async getUserCSS(user) {
        if(!user) return '';

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
        })
            .sort({
                _id: -1
            })
            .lean();
        if(!aclGroupItem) return '';

        const aclGroup = aclGroups.find(group => group.uuid === aclGroupItem.aclGroup);
        return aclGroup.userCSS;
    },
    async findUsers(req, arr, key = 'user', options = {}) {
        const noCSS = options.noCSS;
        const getColor = options.getColor;

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
                const dbUser = await models.User.findOne({
                    uuid
                });
                if(dbUser) {
                    obj[key] = dbUser.publicUser;
                    if(!noCSS) obj[key].userCSS = await this.getUserCSS(dbUser);
                    cache[dbUser.uuid] = obj[key];
                }
                else obj[key] = {
                    type: UserTypes.Deleted,
                    ...(req.permissions.includes('admin') ? {
                        uuid
                    } : {})
                }
                if(getColor) obj[key].color = this.increaseBrightness(colorFromUuid(uuid), 60);
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
        if(user.admin || ['admin', 'developer'].some(a => user.permissions?.includes(a))) data.admin = '1';

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
    addHistoryData(req, rev, isAdmin = false, document = null, backendMode = false) {
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

        if(rev.troll || (rev.hideLog && !req.permissions.includes('hide_document_history_log')))
            rev.log = null;

        if(rev.infoText) rev.htmlInfoText ??= namumarkUtils.escapeHtml(rev.infoText);

        if(backendMode) {
            rev.infoText = rev.htmlInfoText;
            rev.htmlInfoText = undefined;
        }
        else {
            rev.userHtml = this.userHtml(rev.user, {
                isAdmin,
                note: document ? `${globalUtils.doc_fulltitle(document)} r${rev.rev} 긴급차단` : null
            });

            const diffClassList = ['diff-text'];

            if(rev.diffLength > 0) diffClassList.push('diff-add');
            else if(rev.diffLength < 0) diffClassList.push('diff-remove');

            rev.pureDiffHtml = `<span class="${diffClassList.join(' ')}">${rev.diffLength > 0 ? '+' : ''}${rev.diffLength ?? 0}</span>`;
            rev.diffHtml = `<span>(${rev.pureDiffHtml})</span>`;
        }

        return rev;
    },
    async findHistories(req, arr, isAdmin = false) {
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
                })
                    .select('type rev revertRev uuid user createdAt log moveOldDoc moveNewDoc -_id')
                    .lean();
                if(obj.history) {
                    obj.history = this.addHistoryData(req, obj.history, isAdmin, null, req.backendMode);
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
    async findDocuments(arr, additionalKeys = []) {
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
                    obj.document = {
                        parsedName: this.parseDocumentName(`${obj.document.namespace}:${obj.document.title}`),
                        ...this.onlyKeys(obj.document, additionalKeys)
                    }
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
            // req.permissions.unshift('member');
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
        req.displayPermissions = AllPermissions.filter(a => req.permissions.includes(a));

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
                })
                    .select('url topic document -_id')
                    .lean();
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
    async generateDiff(oldText, newText, blameMode = false) {
        if(debug) console.time('generateDiff');
        oldText = diffLib.stringAsLines(oldText || '');
        newText = diffLib.stringAsLines(newText || '');

        const seqMatcher = new diffLib.SequenceMatcher(oldText, newText);
        const opcodes = seqMatcher.get_opcodes();
        const result = await diffView.buildView({
            baseTextLines: oldText,
            newTextLines: newText,
            opcodes,
            contextSize: 3,
            viewType: blameMode ? 1 : 2
        });
        if(debug) console.timeEnd('generateDiff');
        return {
            ...result,
            oldLines: oldText,
            newLines: newText
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
        if(result === false) return null;

        return result;
    },
    async validateCaptcha(req) {
        const response = req.body[{
            recaptcha: 'g-recaptcha-response',
            turnstile: 'cf-turnstile-response',
            hcaptcha: 'h-captcha-response'
        }[config.captcha.type]];
        if(!response) return false;

        const { data } = await axios.post({
            recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
            turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            hcaptcha: 'https://api.hcaptcha.com/siteverify'
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
    checkCaptchaRequired(req, force = false, ipForce = false) {
        req.session.noCaptchaCount ??= Math.max(config.captcha?.rate?.ip ?? 10, config.captcha?.rate?.account ?? 20);

        if(!config.captcha.enabled || req.permissions.includes('skip_captcha'))
            return false;
        if(ipForce && req.user?.type !== UserTypes.Account)
            force = true;
        if(req.permissions.includes('no_force_captcha'))
            force = false;

        const maxNoCaptchaRequests = req.user?.type === UserTypes.Account
            ? (config.captcha?.rate?.account ?? 20)
            : (config.captcha?.rate?.ip ?? 10);

        return req.session.noCaptchaCount >= maxNoCaptchaRequests || force;
    },
    async middleValidateCaptcha(req, res, force = false, ipForce = false) {
        if(!this.checkCaptchaRequired(req, force, ipForce)) {
            req.session.noCaptchaCount++;
            return true;
        }
        const result = await this.validateCaptcha(req);
        if(!result) {
            res.status(400).send('invalid_captcha');
            return false;
        }

        req.session.noCaptchaCount = 1;

        return true;
    },
    async pagination(req, model, baseQuery, key, sortKey, {
        limit, sortDirection, pageQuery, getTotal
    } = {}) {
        sortDirection ??= -1;
        const $gte = sortDirection === -1 ? '$gte' : '$lte';
        const $lte = sortDirection === -1 ? '$lte' : '$gte';
        const $gt = sortDirection === -1 ? '$gt' : '$lt';
        const $lt = sortDirection === -1 ? '$lt' : '$gt';

        let total = null;
        if(getTotal) total = await model.countDocuments(baseQuery);

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
                .select([
                    key,
                    ...(key === '_id' ? [] : ['-_id'])
                ])
                .lean();
            nextItem = await model.findOne({
                ...baseQuery,
                [sortKey]: { [$lt]: items[items.length - 1][sortKey] }
            })
                .sort({ [sortKey]: sortDirection })
                .select([
                    key,
                    ...(key === '_id' ? [] : ['-_id'])
                ])
                .lean();
        }

        const link = query => `${req.path}?${querystring.stringify({
            ...this.withoutKeys(req.query, [query.from ? 'until' : 'from']),
            ...query
        })}`;
        const originalPageButton = await new Promise(async (resolve, reject) => {
            if(req.backendMode) return resolve(null);

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
            ...(req.backendMode ? {
                pageProps: {
                    prev: prevItem ? { query: { until: prevItem[key] } } : null,
                    next: nextItem ? { query: { from: nextItem[key] } } : null
                }
            } : {
                pageButton: `<div class="navigation-div navigation-page">${originalPageButton}</div>`,
                originalPageButton,
            }),
            total
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
            ip: (user.permissions.includes('developer') || user.permissions.includes('hideip')) ? '127.0.0.1' : req.ip,
            userAgent: req.get('User-Agent'),
            device,
            ...data
        });
    },
    async getReadableNamespaces(aclData) {
        const unreadableNamespaces = [];
        await Promise.all(config.namespaces.map(async namespace => new Promise(async resolve => {
            const acl = await global.ACLClass.get({
                namespace
            });
            const { result: readable } = await acl.check(ACLTypes.Read, aclData);
            if(!readable) unreadableNamespaces.push(namespace);
            resolve();
        })));
        return config.namespaces.filter(a => !unreadableNamespaces.includes(a));
    },
    async threadCommentMapper(
        comment,
        {
            req,
            thread,
            toHtmlParams,
            lightMode,
            user,
            hideUser,
            skipRender = false
        } = {}
    ) {
        comment.user = user ?? comment.user;
        if(!req?.backendMode) comment.userHtml = this.userHtml(user ?? comment.user, {
            isAdmin: req?.permissions.includes('admin'),
            note: `토론 ${thread.url} #${comment.id} 긴급차단`,
            thread: true,
            threadAdmin: comment.admin
        });

        const canSeeHidden = req?.permissions.includes('manage_thread');
        if(comment.hidden) {
            hideUser ??= comment.hiddenBy;
            comment.hideUser = hideUser;
            if(!req?.backendMode) comment.hideUserHtml = this.userHtml(hideUser, {
                isAdmin: hideUser.permissions?.includes('admin'),
                thread: true,
                threadAdmin: true
            });
        }

        if(!comment.hidden || canSeeHidden) {
            if(comment.type === ThreadCommentTypes.Default) {
                const parseResult = global.NamumarkParser.parser(comment.content, { thread: true });
                if(lightMode) comment.contentHtml = namumarkUtils.escapeHtml(namumarkUtils.parsedToText(parseResult.result));
                else {
                    if(skipRender) {
                        comment.parseResult = parseResult;
                    }
                    else {
                        const { html } = await global.NamumarkParser.toHtml(parseResult, toHtmlParams);
                        comment.contentHtml = html;
                    }
                }
            }
            else if(comment.type === ThreadCommentTypes.UpdateStatus) {
                comment.contentHtml = `스레드 상태를 <b>${this.getKeyFromObject(ThreadStatusTypes, parseInt(comment.content)).toLowerCase()}</b>로 변경`;
            }
            else if(comment.type === ThreadCommentTypes.UpdateTopic) {
                comment.contentHtml = `스레드 주제를 <b>${comment.prevContent}</b>에서 <b>${comment.content}</b>로 변경`;
            }
            else if(comment.type === ThreadCommentTypes.UpdateDocument) {
                comment.contentHtml = `스레드를 <b>${comment.prevContent}</b>에서 <b>${comment.content}</b>로 이동`;
            }
            else if(comment.type === ThreadCommentTypes.PinComment) {
                comment.contentHtml = `<b><a href="#${comment.content}">#${comment.content}</a></b> 댓글을 고정`;
            }
            else if(comment.type === ThreadCommentTypes.UnpinComment) {
                comment.contentHtml = `댓글 고정 해제`;
            }
        }

        // if(typeof comment.user === 'object')
        //     comment.user = comment.user.uuid;

        return this.onlyKeys(comment, [
            'id',
            'hidden',

            'type',
            'createdAt',
            'user',
            'admin',
            'parseResult',
            'contentHtml',

            'hideUser',
            ...(!req || !req.backendMode ? [
                'userHtml',
                'hideUserHtml'
            ] : [])
        ]);
    },
    async multipleThreadCommentsMapper(requests = []) {
        const results = await Promise.all(requests.map(a => {
            a[1].skipRender = true;
            return this.threadCommentMapper(...a);
        }));
        const renderResults = await global.NamumarkParser.toHtml({ batch: results.map((a, i) => [a.parseResult, requests[i][1].toHtmlParams]) });
        return results.map((a, i) => ({
            ...a,
            parseResult: undefined,
            contentHtml: a.contentHtml ?? renderResults[i].html
        }));
    },
    async notificationMapper(req, items = [], lightMode = false) {
        await Promise.all(items.map(item => new Promise(async resolve => {
            switch(item.type) {
                case NotificationTypes.UserDiscuss: {
                    const thread = await models.Thread.findOne({
                        uuid: item.data
                    }).lean();
                    item.thread = this.onlyKeys(thread, ['url', 'topic']);
                    const dbDocument = await models.Document.findOne({
                        uuid: thread.document
                    });
                    item.document = this.dbDocumentToDocument(dbDocument);
                    const comment = await models.ThreadComment.findOne({
                        thread: thread.uuid
                    }).sort({
                        _id: -1
                    }).lean();
                    item.comment = await this.threadCommentMapper(comment, {
                        req,
                        lightMode,
                        toHtmlParams: {
                            document: dbDocument,
                            aclData: req.aclData,
                            dbComment: comment,
                            thread: true,
                            commentId: comment.id,
                            req
                        }
                    });
                    item.comment = await this.findUsers(req, item.comment);
                    item.url = `/thread/${thread.url}`;
                    delete item.data;
                    break;
                }
                case NotificationTypes.Mention: {
                    const comment = await models.ThreadComment.findOne({
                        uuid: item.data
                    }).lean();
                    const thread = await models.Thread.findOne({
                        uuid: comment.thread
                    });
                    item.thread = this.onlyKeys(thread, ['url', 'topic']);
                    const dbDocument = await models.Document.findOne({
                        uuid: thread.document
                    });
                    item.document = this.dbDocumentToDocument(dbDocument);
                    item.comment = await this.threadCommentMapper(comment, {
                        req,
                        lightMode,
                        toHtmlParams: {
                            document: dbDocument,
                            aclData: req.aclData,
                            dbComment: comment,
                            thread: true,
                            commentId: comment.id,
                            req
                        }
                    });
                    item.comment = await this.findUsers(req, item.comment);
                    item.url = `/thread/${thread.url}#${comment.id}`;
                    delete item.data;
                    break;
                }
            }
            resolve();
        })));
        return items;
    },
    insertText: (text, index, insertText) => {
        return text.slice(0, index) + insertText + text.slice(index);
    },
    groupArray: (array, size) => {
        const result = [];
        for(let i = 0; i < array.length; i += size) {
            result.push(array.slice(i, i + size));
        }
        return result;
    },
    aclStrMapper(a) {
        return {
            ...this.onlyKeys(a, ['uuid', 'expiresAt']),
            condition: global.ACLClass.ruleToConditionString(a, false),
            action: global.ACLClass.actionToString(a)
        }
    },
    getObjectValue(obj, path) {
        return path.split('.').reduce((obj, key) => obj ? obj[key] : undefined, obj);
    },
    getObjectValueFallback(obj, paths = []) {
        for(const path of paths) {
            const value = this.getObjectValue(obj, path);
            if(value !== undefined) return value;
        }
        return undefined;
    },
    permissionsToFlags(permissions = [], whitelist = []) {
        const checkPerm = [...permissions];

        if(whitelist.includes('admin') && checkPerm.includes('developer'))
            checkPerm.push('admin');

        return checkPerm.reduce((flag, key) => {
            if(!whitelist.length || whitelist.includes(key))
                return flag | (PermissionFlags[key] ?? 0n);
            return flag;
        }, 0n);
    }
}