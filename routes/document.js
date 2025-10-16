const express = require('express');
const { Address4, Address6 } = require('ip-address');
const { getChoseong } = require('es-hangul');

const parser = require('../utils/namumark/parser');
const toHtml = require('../utils/namumark/toHtml');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const middleware = require('../utils/middleware');
const {
    ACLTypes,
    ACLConditionTypes,
    ACLActionTypes,
    HistoryTypes,
    BacklinkFlags,
    ThreadStatusTypes,
    ThreadCommentTypes,
    UserTypes,
    EditRequestStatusTypes,
    AuditLogTypes
} = require('../utils/types');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const EditRequest = require('../schemas/editRequest');
const ACLModel = require('../schemas/acl');
const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');
const Thread = require('../schemas/thread');
const Star = require('../schemas/star');
const AuditLog = require('../schemas/auditLog');

const ACL = require('../class/acl');

const app = express.Router();

app.get('/', (req, res) => {
    res.redirect(`/w/${config.front_page}`);
});

const getCategoryDocuments = async (req, { limit = 100 } = {}) => {
    const { namespace, title } = req.document;
    if(namespace !== '분류') return;

    const allNamespaces = [
        '분류',
        ...config.namespaces.filter(a => a !== '분류')
    ];

    const categoriesData = {};
    for(let namespace of allNamespaces) {
        const baseQuery = {
            namespace,
            categories: {
                $elemMatch: {
                    document: title
                }
            }
        }
        const query = { ...baseQuery };

        const selectedNamespace = req.query.namespace === namespace;
        const pageQuery = req.query.cuntil || req.query.cfrom;
        if(selectedNamespace && pageQuery) {
            const checkExists = await Document.findOne({
                title: pageQuery
            });
            if(checkExists) {
                if(req.query.cuntil) query.upperTitle = {
                    $lte: checkExists.upperTitle
                }
                else query.upperTitle = {
                    $gte: checkExists.upperTitle
                }
            }
        }

        const categories = await Document.find(query)
            .sort({ upperTitle: query.upperTitle?.$lte ? -1 : 1 })
            .limit(limit)
            .lean();
        if(!categories.length) continue;

        if(query.upperTitle?.$lte) categories.reverse();

        const count = await Document.countDocuments(baseQuery);

        const prevItem = await Document.findOne({
            ...baseQuery,
            upperTitle: {
                $lt: categories[0].upperTitle
            }
        })
            .sort({ upperTitle: -1 })
            .lean();

        const nextItem = await Document.findOne({
            ...baseQuery,
            upperTitle: {
                $gt: categories[categories.length - 1].upperTitle
            }
        })
            .sort({ upperTitle: 1 })
            .lean();

        let categoriesPerChar = {};
        for(let document of categories) {
            let char = document.upperTitle[0];
            const choseong = getChoseong(char);
            if(choseong) char = choseong;

            document.parsedName = utils.parseDocumentName(`${document.namespace}:${document.title}`);
            document.category = document.categories.find(a => a.document === title);

            const arr = categoriesPerChar[char] ??= [];
            arr.push({
                parsedName: document.parsedName,
                category: {
                    text: document.category.text
                }
            });
        }

        categoriesData[namespace] = {
            categoriesPerChar,
            count,
            prevItem: prevItem?.title,
            nextItem: nextItem?.title
        }
    }

    return categoriesData;
}
module.exports.getCategoryDocuments = getCategoryDocuments;

app.get('/w/{*document}', middleware.parseDocumentName, async (req, res) => {
    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    let rev;
    let threadExists = false;
    if(dbDocument) {
        rev = await History.findOne({
            document: dbDocument.uuid,
            ...(req.query.uuid ? { uuid: req.query.uuid } : {})
        }).sort({ rev: -1 });

        threadExists = await Thread.exists({
            document: dbDocument.uuid,
            status: {
                $ne: ThreadStatusTypes.Close
            },
            lastUpdatedAt: {
                $gte: new Date(Date.now() - 1000 * 60 * 60 * 24)
            },
            deleted: false
        });
        threadExists ||= await EditRequest.exists({
            document: dbDocument.uuid,
            status: EditRequestStatusTypes.Open
        });
    }

    const acl = await ACL.get({ document: dbDocument }, document);

    const isOldVer = req.query.uuid && req.query.uuid === rev?.uuid;
    const defaultData = {
        viewName: 'wiki',
        date: undefined,
        discuss_progress: !!threadExists,
        document,
        edit_acl_message: null,
        editable: false,
        rev: isOldVer ? rev.rev : null,
        uuid: isOldVer ? rev.uuid : null,
        star_count: undefined,
        starred: null,
        user: null,
        error: null
    };

    const { result: readable, aclMessage: read_acl_message } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) {
        if(req.skin === 'plain' && req.user?.type !== UserTypes.Account) {
            // initial setup
            return res.redirect('/member/login');
        }
        return res.renderSkin(undefined, {
            ...defaultData,
            date: null,
            rev: null,
            uuid: null,
            error: {
                code: 'permission_read',
                msg: read_acl_message
            },
            contentHtml: `<h2>${read_acl_message}</h2>`
        });
    }

    if(req.query.uuid && !rev) {
        const msg = '해당 리비전이 존재하지 않습니다.';
        return res.renderSkin(undefined, {
            ...defaultData,
            date: null,
            error: {
                code: 'invalid_rev',
                msg
            },
            contentHtml: `<h2>${msg}</h2>`
        });
    }

    if(isOldVer && (rev.hidden || rev.troll)) {
        const msg = rev.hidden ? '숨겨진 리비전입니다.' : '이 리비전은 반달로 표시 되었습니다.';
        return res.renderSkin(undefined, {
            ...defaultData,
            date: null,
            rev: null,
            uuid: null,
            error: {
                code: rev.hidden ? 'secret_rev' : 'marked_troll_rev',
                msg
            },
            contentHtml: `<h2>${msg}</h2>`
        });
    }

    const { result: editable, aclMessage: edit_acl_message } = await acl.check(ACLTypes.Edit, req.aclData);
    const { result: editRequestable } = await acl.check(ACLTypes.EditRequest, req.aclData);
    defaultData.editable = editable || editRequestable;
    defaultData.edit_acl_message = edit_acl_message;

    if(!dbDocument || !rev || (rev.content == null && !req.query.uuid)) {
        let revs = [];
        if(dbDocument) revs = await History.find({
            document: dbDocument.uuid
        })
            .sort({ rev: -1 })
            .limit(3)
            .select('type rev uuid user createdAt diffLength log revertRev moveOldDoc moveNewDoc troll trollBy hideLog hideLogBy hidden editRequest -_id')
            .lean();

        revs = await utils.findUsers(req, revs);

        return res.renderSkin(undefined, {
            ...defaultData,
            viewName: 'notfound',
            contentName: 'notfound',
            status: 404,
            serverData: {
                document,
                revs: revs.map(a => utils.addHistoryData(req, a, req.permissions.includes('admin'), req.document))
            }
        });
    }

    const isRedirect = rev.content?.startsWith('#redirect ');
    if(!req.query.noredirect && !req.query.from && !req.query.uuid && isRedirect) {
        let anchor = undefined;
        let redirectName = rev.content.split('\n')[0].slice('#redirect '.length);
        const hashSplitted = redirectName.split('#');
        if(hashSplitted.length >= 2) {
            anchor = hashSplitted.pop();
            redirectName = hashSplitted.join('#').replaceAll('#', '%23');
        }

        const redirectDoc = utils.parseDocumentName(redirectName);
        const checkDoc = await Document.exists({
            namespace: redirectDoc.namespace,
            title: redirectDoc.title
        });
        if(checkDoc) return res.redirect(globalUtils.doc_action_link(redirectDoc, 'w', {
            from: globalUtils.doc_fulltitle(document)
        }) + (anchor ? '#' + anchor : ''));
    }

    let user;
    let userPermissions = [];
    let userBlockedData = null;
    let userIsAdmin = false;
    if(namespace === '사용자' && !title.includes('/')) {
        user = await User.findOne({
            name: title
        });
        const permissions = await utils.getACLGroupPermissions(user);
        userPermissions = [...(user.permissions ?? []), ...permissions];
        if(user
            && (user.type !== UserTypes.Deleted || req.permissions.includes('admin'))) {
            defaultData.user = {
                uuid: user.uuid,
                flags: Number(utils.permissionsToFlags(userPermissions, [
                    'admin',
                    'auto_verified_member',
                    'mobile_verified_member'
                ]))
            }
        }
    }

    let content = rev.content;
    if(content && isRedirect) content = `#redirect [[${rev.content.split('\n')[0].slice('#redirect '.length)}]]`;
    if(rev.fileKey) content = `[[${globalUtils.doc_fulltitle(document)}]]\n` + rev.content;

    if(!debug) console.time(`parse ${document.title}`);
    const parseResult = parser(content);
    if(!debug) console.timeEnd(`parse ${document.title}`);
    if((debug || req.permissions.includes('engine_developer')) && req.query.np) {
        if(req.query.np === 'tok') return res.json(parseResult.tokens);
        if(req.query.np === 'cst') return res.json(parseResult.result);
    }
    if(!debug) console.time(`toHtml ${document.title}`);
    let { html: contentHtml, errorMsg, errorCode, categories, hasError, headings, embed } = await toHtml(parseResult, {
        document,
        dbDocument,
        rev,
        aclData: req.aclData,
        req
    });
    if(!debug) console.timeEnd(`toHtml ${document.title}`);
    if(hasError) return res.renderSkin(undefined, {
        ...defaultData,
        date: null,
        rev: null,
        uuid: null,
        error: {
            code: errorCode,
            msg: errorMsg
        },
        contentHtml: `<h2>${contentHtml}</h2>`
    });

    if(user) {
        const blockGroups = await ACLGroup.find({
            forBlock: true
        });
        const blockedItem = await ACLGroupItem.findOne({
            aclGroup: {
                $in: blockGroups.map(group => group.uuid)
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
        });

        if(blockedItem) {
            const group = blockGroups.find(a => a.uuid === blockedItem.aclGroup);
            userBlockedData = {
                name: group.name,
                id: blockedItem.id,
                createdAt: blockedItem.createdAt,
                expiresAt: blockedItem.expiresAt,
                note: blockedItem.note
            }
        }

        if(userPermissions.includes('admin')) {
            userIsAdmin = true;
        }
    }

    const categoriesData = await getCategoryDocuments(req);

    const star_count = await Star.countDocuments({
        document: dbDocument.uuid
    });
    let starred = false;
    if(req.user) starred = await Star.exists({
        document: dbDocument.uuid,
        user: req.user.uuid
    });

    res.renderSkin(undefined, {
        ...defaultData,
        headings,
        contentName: 'wiki',
        serverData: {
            categories: categories.map(a => ({
                ...a,
                text: undefined,
                document: utils.parseDocumentName('분류:' + a.document)
            })),
            contentHtml,
            userboxData: {
                admin: userIsAdmin,
                blocked: userBlockedData
            },
            categoriesData,
            isRedirect,
            embed
        },
        date: Math.floor(rev.createdAt.getTime() / 1000),
        star_count,
        starred: !!starred
    });
});

app.get('/acl/{*document}', middleware.parseDocumentName, async (req, res) => {
    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);
    const namespaceACL = acl.namespaceACL;

    const { result: editableACL } = await acl.check(ACLTypes.ACL, req.aclData);
    // const { result: editableNSACL } = await namespaceACL.check(ACLTypes.ACL, req.aclData);
    const editableNSACL = req.permissions.includes('nsacl');

    const aclMapper = a => utils.onlyKeys(a.aclTypes, [
        'uuid', 'type', 'expiresAt', 'not', 'conditionType', 'conditionContent', 'user', 'aclGroup', 'actionType', 'actionContent'
    ]);

    let aclData = aclMapper(acl);
    let nsaclData = aclMapper(namespaceACL);
    aclData = aclData.map(a => a.map(b => utils.aclStrMapper(b)));
    nsaclData = nsaclData.map(a => a.map(b => utils.aclStrMapper(b)));

    res.renderSkin(undefined, {
        viewName: 'acl',
        document,
        serverData: {
            acl: aclData,
            namespaceACL: nsaclData,
            editableACL,
            editableNSACL
        },
        contentName: 'document/acl'
    });
});

app.post('/acl/{*document}', middleware.parseDocumentName, async (req, res) => {
    const target = req.body.target;

    const document = req.document;

    const { namespace, title } = document;
    if(!title && target === 'document') return res.status(400).send('문서 이름이 없습니다.');

    let dbDocument;
    let dbThread;
    if(target === 'thread') {
        dbThread = await Thread.findOne({
            url: req.body.thread
        });
        if(!dbThread) return res.status(404).send('존재하지 않는 thread');
    }
    if(target === 'document' || target === 'thread') {
        dbDocument = await Document.findOne({
            namespace,
            title
        });

        const acl = await ACL.get({ document: dbDocument }, document);
        const { result: editable, aclMessage } = await acl.check(ACLTypes.ACL, req.aclData);

        if(!editable) return res.status(403).send(aclMessage);
    }
    else if(target === 'namespace') {
        if(!req.permissions.includes('nsacl')) return res.status(403).send('이름공간 ACL 수정은 nsacl 권한이 필요합니다!');
        if(!req.permissions.includes('config') && config.protected_namespaces?.includes(namespace)) return res.status(403).send('protected_namespace');
    }
    else return res.status(400).send('유효하지 않은 target');

    const aclType = ACLTypes[req.body.aclType];
    const conditionType = ACLConditionTypes[req.body.conditionType];
    const actionType = ACLActionTypes[req.body.actionType];

    if(aclType == null || conditionType == null || actionType == null)
        return res.status(400).send('유효하지 않은 type');

    if(aclType === ACLTypes.ACL && !req.permissions.includes('nsacl')) return res.status(403).send('ACL 카테고리 수정은 nsacl 권한이 필요합니다!');

    let duration;
    if(req.body.duration === 'raw') duration = req.body.rawDuration * req.body.rawMultiplier;
    else duration = parseInt(req.body.duration);

    if(isNaN(duration)) return res.status(400).send('유효하지 않은 duration');

    let conditionContent = req.body.conditionContent;
    let rawConditionContent = req.body.conditionContent;

    if(conditionType === ACLConditionTypes.Perm) {
        let value = req.body.permission;
        if(!value
            && !req.permissions.includes('developer')) return res.status(400).send('권한 값을 입력해주세요!');
        value ||= 'any';
        conditionContent = value;
        rawConditionContent = value;
    }
    else if(conditionType === ACLConditionTypes.User) {
        const member = await User.findOne({
            name: conditionContent
        });
        if(!member) return res.status(400).send('해당 이름의 사용자를 찾을 수 없습니다!');

        conditionContent = member.uuid;
    }
    else if(conditionType === ACLConditionTypes.IP) {
        if(!Address4.isValid(conditionContent) && !Address6.isValid(conditionContent))
            return res.status(400).send('유효하지 않은 IP');
    }
    else if(conditionType === ACLConditionTypes.GeoIP) {
        if(conditionContent.length !== 2 || !/^[A-Z]+$/.test(conditionContent))
            return res.status(400).send('유효하지 않은 GeoIP');
    }
    else if(conditionType === ACLConditionTypes.ACLGroup) {
        const aclGroup = await ACLGroup.findOne({
            name: conditionContent
        });
        if(!aclGroup) return res.status(400).send('해당 이름의 ACL그룹을 찾을 수 없습니다!');

        conditionContent = aclGroup.uuid;
    }

    if(actionType < ACLActionTypes.Deny
        || (target === 'document' && actionType > ACLActionTypes.GotoOtherNS)
        || (target === 'namespace' && actionType === ACLActionTypes.GotoNS)) {
        return res.status(400).send(`${req.body.actionType}는 이 카테고리에 사용할 수 없습니다!`);
    }

    const newACL = {
        type: aclType,
        not: req.body.not === 'Y',
        conditionType,
        conditionContent,
        actionType
    }

    if(actionType === ACLActionTypes.GotoOtherNS) {
        // if(!req.permissions.includes('developer')) return res.status(403).send(`${req.body.actionType}는 개발자 전용입니다!`);

        if(!req.body.actionContent) return res.status(400).send('이동할 이름공간을 입력하세요!');
        if(!config.namespaces.includes(req.body.actionContent)) return res.status(400).send(`${req.body.actionContent} 이름공간은 존재하지 않습니다!`);
        if(req.body.actionContent === namespace) return res.status(400).send('같은 이름공간으로 이동할 수 없습니다.');

        newACL.actionContent = req.body.actionContent;
    }

    const existsCheck = {
        type: aclType,
        conditionType,
        conditionContent
    }
    let aclExists;
    if(target === 'document') {
        if(dbDocument) aclExists = await ACLModel.exists({
            ...existsCheck,
            document: dbDocument.uuid
        });
    }
    else if(target === 'thread') aclExists = await ACLModel.exists({
        ...existsCheck,
        thread: dbThread.uuid
    });
    else aclExists = await ACLModel.exists({
        ...existsCheck,
        namespace
    });
    if(aclExists) return res.status(409).send('acl_already_exists');

    if(target === 'thread') newACL.thread = dbThread.uuid;
    else if(target === 'document') {
        if(!dbDocument) {
            dbDocument = new Document({
                namespace,
                title
            });
            await dbDocument.save();
        }

        newACL.document = dbDocument.uuid;
    }
    else newACL.namespace = namespace;

    if(duration > 0) newACL.expiresAt = new Date(Date.now() + duration * 1000);

    await ACLModel.create(newACL);

    const log = [
        'insert',
        utils.camelToSnakeCase(req.body.aclType),
        req.body.actionType.toLowerCase(),
        (req.body.not === 'Y' ? 'not ' : '') + req.body.conditionType.toLowerCase() + ':' + rawConditionContent
    ].join(',');

    if(dbDocument && target === 'document') await History.create({
        user: req.user.uuid,
        sessionId: req.session.sessionId,
        type: HistoryTypes.ACL,
        document: dbDocument.uuid,
        log
    });
    else if(target === 'namespace') await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.NamespaceACL,
        target: namespace,
        content: log
    });
    else if(target === 'thread') await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.ThreadACL,
        target: dbThread.uuid,
        content: log
    });

    res.reload();
});

app.get('/action/acl/delete', async (req, res) => {
    const aclId = req.query.acl;
    if(!aclId) return res.status(400).send('ACL UUID 없음');

    const dbACL = await ACLModel.findOne({
        uuid: aclId
    });
    if(!dbACL) return res.status(400).send('ACL 찾을 수 없음');

    if(dbACL.type === ACLTypes.ACL && !req.permissions.includes('nsacl')) return res.status(403).send('ACL 카테고리 수정은 nsacl 권한이 필요합니다!');

    let dbDocument;
    let dbThread;
    if(dbACL.document || dbACL.thread) {
        if(dbACL.thread) dbThread = await Thread.findOne({
            uuid: dbACL.thread
        });
        dbDocument = await Document.findOne({
            uuid: dbThread?.document || dbACL.document
        });

        const acl = await ACL.get({ document: dbDocument }, {
            namespace: dbDocument.namespace,
            title: dbDocument.title
        });
        const { result: editable, aclMessage } = await acl.check(ACLTypes.ACL, req.aclData);

        if(!editable) return res.status(403).send(aclMessage);
    }
    else {
        if(!req.permissions.includes('nsacl')) return res.status(403).send('이름공간 ACL 수정은 nsacl 권한이 필요합니다!');
        if(!req.permissions.includes('config') && config.protected_namespaces?.includes(dbACL.namespace)) return res.status(403).send('protected_namespace');
    }

    await ACLModel.deleteOne({
        uuid: aclId
    });

    const aclTypeStr = utils.camelToSnakeCase(utils.getKeyFromObject(ACLTypes, dbACL.type));

    const conditionType = dbACL.conditionType;
    let conditionContent = dbACL.conditionContent;
    if(conditionType === ACLConditionTypes.User) {
        const member = await User.findOne({
            uuid: dbACL.conditionContent
        });
        if (member) conditionContent = member.name;
    }
    else if(conditionType === ACLConditionTypes.ACLGroup) {
        const aclGroup = await ACLGroup.findOne({
            uuid: dbACL.conditionContent
        });
        if(aclGroup) conditionContent = aclGroup.name;
    }

    const log = [
        'delete',
        aclTypeStr,
        utils.getKeyFromObject(ACLActionTypes, dbACL.actionType).toLowerCase(),
        (dbACL.not ? 'not ' : '') + utils.getKeyFromObject(ACLConditionTypes, conditionType).toLowerCase() + ':' + conditionContent
    ].join(',');

    if(dbDocument && dbACL.document) await History.create({
        user: req.user.uuid,
        sessionId: req.session.sessionId,
        type: HistoryTypes.ACL,
        document: dbDocument.uuid,
        log
    });
    else if(dbACL.namespace) await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.NamespaceACL,
        target: dbACL.namespace,
        content: log
    });
    else if(dbACL.thread) await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.ThreadACL,
        target: dbACL.thread,
        content: log
    });

    res.reload(dbACL.document ? 'document' : 'namespace' + '.' + aclTypeStr);
});

app.patch('/action/acl/reorder', async (req, res) => {
    let uuids;
    try {
        uuids = JSON.parse(req.body.acls);
    }
    catch (e) {
        return res.status(400).send('invalid_uuids');
    }

    const acls = await ACLModel.find({
        uuid: {
            $in: uuids
        }
    });

    if(acls.length !== uuids.length) return res.status(400).send('유효하지 않은 ACL 개수');

    const sameTypeACLs = await ACLModel.find({
        document: acls[0].document,
        namespace: acls[0].namespace,
        type: acls[0].type
    });

    if(acls.some(a => !sameTypeACLs.find(b => a.uuid === b.uuid))) return res.status(400).send('유효하지 않은 ACL 포함');

    if(acls[0].type === ACLTypes.ACL && !req.permissions.includes('nsacl')) return res.status(403).send('ACL 카테고리 수정은 nsacl 권한이 필요합니다!');

    let dbDocument;
    let dbThread;
    if(acls[0].document || acls[0].thread) {
        if(acls[0].thread) dbThread = await Thread.findOne({
            uuid: acls[0].thread
        });
        dbDocument = await Document.findOne({
            uuid: dbThread?.document || acls[0].document
        });

        const acl = await ACL.get({ document: dbDocument }, {
            namespace: dbDocument.namespace,
            title: dbDocument.title
        });
        const { result: editable, aclMessage } = await acl.check(ACLTypes.ACL, req.aclData);

        if(!editable) return res.status(403).send(aclMessage);
    }
    else {
        if(!req.permissions.includes('nsacl')) return res.status(403).send('이름공간 ACL 수정은 nsacl 권한이 필요합니다!');
        if(!req.permissions.includes('config') && config.protected_namespaces?.includes(acls[0].namespace)) return res.status(403).send('protected_namespace');
    }

    const actions = [];
    for(let i in uuids) {
        const uuid = uuids[i];
        const acl = acls.find(a => a.uuid === uuid);
        const order = parseInt(i);

        if(acl.order !== order) actions.push({
            updateOne: {
                filter: {
                    uuid
                },
                update: {
                    order
                }
            }
        });
    }

    if(actions.length) await ACLModel.bulkWrite(actions);

    res.status(204).end();
});

const editAndEditRequest = async (req, res) => {
    const editingEditRequest = req.url.startsWith('/edit_request/');
    const isEditRequest = editingEditRequest || req.url.startsWith('/new_edit_request/');

    const section = parseInt(req.query.section);

    const invalidSection = () => res.error('섹션이 올바르지 않습니다.');

    if(req.query.section && (isNaN(section) || section < 1)) return invalidSection();

    const document = req.document;

    const { namespace, title } = document;

    let dbDocument = req.dbDocument;
    dbDocument ??= await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage, 403);

    const { result: editable, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);
    if(req.isAPI && !editable) return res.error(aclMessage, 403);

    const { result: editRequestable, aclMessage: editRequestAclMessage } = await acl.check(ACLTypes.EditRequest, req.aclData);

    if(!isEditRequest && !editable && editRequestable) return res.redirect(globalUtils.doc_action_link(document, 'new_edit_request', {
        redirected: 1,
        section
    }));

    if(isEditRequest && !editRequestable) return res.error(editRequestAclMessage, 403);

    let rev;
    if(dbDocument) rev = await History.findOne({
        document: dbDocument.uuid
    }).sort({ rev: -1 });

    if(editingEditRequest) {
        const editRequest = req.editRequest;
        const baseRev = await History.findOne({
            uuid: editRequest.baseUuid
        }).lean();
        const conflict = utils.mergeText(baseRev.content, editRequest.content, rev.content) == null;

        if(conflict) req.flash.conflict = {
            editedRev: baseRev.rev,
            diff: await utils.generateDiff(baseRev.content, editRequest.content)
        }
    }

    const docExists = rev?.content != null;

    let content = '';
    if(editingEditRequest) {
        content = req.editRequest.content;
    }
    else if(docExists) {
        content = rev.content;
        if(req.query.section) {
            const lines = content.split('\n');
            const parseResult = parser(rev.content);
            const headings = parseResult.result.filter(a => a.type === 'heading');
            const headingLines = headings.map(a => a.line - 1);
            if(section > headingLines.length) return invalidSection();

            const start = headingLines[section - 1];
            const next = headingLines[section] ?? lines.length;

            content = lines.slice(start, next).join('\n');
        }
    }

    let contentHtml;
    if(rev?.content) {
        const parseResult = parser(rev.content, { editorComment: true });
        const { html } = await toHtml(parseResult, {
            document,
            aclData: req.aclData,
            req
        });
        contentHtml = html;
    }

    let dochelptext;
    if(config.edit_help_document) {
        const helpDocName = utils.parseDocumentName(config.edit_help_document);
        const helpDoc = await Document.findOne({
            namespace: helpDocName.namespace,
            title: helpDocName.title
        });
        if(helpDoc?.contentExists) {
            const helpRev = await History.findOne({
                document: helpDoc.uuid
            }).sort({ rev: -1 });
            if(helpRev?.content) {
                const parseResult = parser(helpRev.content);
                const { html } = await toHtml(parseResult, {
                    document: helpDocName,
                    aclData: req.aclData,
                    req
                });
                dochelptext = html;
            }
        }
    }

    res.renderSkin(undefined, {
        viewName: isEditRequest ? (editingEditRequest ? 'edit_edit_request' : 'edit_request') : 'edit',
        contentName: 'document/edit',
        document,
        body: {
            baserev: docExists ? rev.rev.toString() : '0',
            baseuuid: docExists ? rev.uuid : 'create',
            section
        },
        serverData: {
            isEditRequest,
            aclMessage,
            content,
            contentHtml,
            captchaData: {
                use: await utils.checkCaptchaRequired(req, !docExists),
                force: !docExists
            },
            editagree_text: config[`namespace.${namespace}.editagree_text`] || config.editagree_text,
            dochelptext,
            conflict: req.flash.conflict,
            editagreeAgreed: req.session.editagreeAgreed,
            log: req.editRequest?.log
        }
    });
}
module.exports.editAndEditRequest = editAndEditRequest;

app.get('/edit/{*document}', middleware.parseDocumentName, editAndEditRequest);
app.get('/new_edit_request/{*document}', middleware.parseDocumentName, editAndEditRequest);
app.get('/edit_request/:url/edit', async (req, res, next) => {
    const editRequest = await EditRequest.findOne({
        url: req.params.url
    });
    if(!editRequest) return res.error('편집 요청을 찾을 수 없습니다.', 404);
    if(editRequest.createdUser !== req.user.uuid) return res.error('자신의 편집 요청만 수정할 수 있습니다.', 403);
    if(editRequest.status !== EditRequestStatusTypes.Open) return res.error('편집 요청 상태가 올바르지 않습니다.');

    req.editRequest = editRequest;
    req.dbDocument = await Document.findOne({
        uuid: editRequest.document
    });
    req.document = utils.dbDocumentToDocument(req.dbDocument);

    next();
}, editAndEditRequest);

app.post('/edit_request/:url/close', async (req, res) => {
    const lock = req.body.lock === 'Y';
    if(lock && !req.permissions.includes('manage_thread'))
        return res.status(403).send('권한이 부족합니다.');

    const editRequest = await EditRequest.findOne({
        url: req.params.url
    });
    if(!editRequest) return res.error('편집 요청을 찾을 수 없습니다.', 404);
    if([
        EditRequestStatusTypes.Closed,
        EditRequestStatusTypes.Locked
    ].includes(editRequest.status)) return res.error('편집 요청 상태가 올바르지 않습니다.');

    if(editRequest.createdUser !== req.user.uuid) {
        const dbDocument = await Document.findOne({
            uuid: editRequest.document
        }).lean();
        const document = utils.dbDocumentToDocument(dbDocument);

        const acl = await ACL.get({ document: dbDocument }, document);
        const { result: editable, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);
        if(!editable) return res.error(aclMessage, 403);
    }

    await EditRequest.updateOne({
        uuid: editRequest.uuid
    }, {
        lastUpdateUser: req.user.uuid,
        status: lock ? EditRequestStatusTypes.Locked : EditRequestStatusTypes.Closed,
        closedReason: req.body.close_reason
    });

    res.redirect(`/edit_request/${editRequest.url}`);
});

app.post('/edit_request/:url/reopen', async (req, res) => {
    const editRequest = await EditRequest.findOne({
        url: req.params.url
    });
    if(!editRequest) return res.error('편집 요청을 찾을 수 없습니다.', 404);
    if(![
        EditRequestStatusTypes.Closed,
        EditRequestStatusTypes.Locked
    ].includes(editRequest.status)) return res.error('편집 요청 상태가 올바르지 않습니다.');

    const dbDocument = await Document.findOne({
        uuid: editRequest.document
    }).lean();
    const document = utils.dbDocumentToDocument(dbDocument);

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: editable, aclMessage } = await acl.check(ACLTypes.EditRequest, req.aclData);
    if(!editable) return res.error(aclMessage, 403);

    const statusPerm = req.permissions.includes('manage_thread');
    if(editRequest.createdUser === req.user.uuid && !statusPerm) {
        if(editRequest.status === EditRequestStatusTypes.Locked)
            return res.error('이 편집 요청은 잠겨있어서 다시 열 수 없습니다.', 403);
    }
    else {
        if(!statusPerm)
            return res.status(403).send('권한이 부족합니다.');
    }

    await EditRequest.updateOne({
        uuid: editRequest.uuid
    }, {
        status: EditRequestStatusTypes.Open
    });

    res.redirect(`/edit_request/${editRequest.url}`);
});

app.post('/preview/{*document}', middleware.parseDocumentName, async (req, res) => {
    const isThread = req.body.mode === 'thread';
    const content = req.body.content;
    if(typeof content !== 'string') return res.status(400).send('내용을 입력해주세요.');

    const document = req.document;

    const dbDocument = await Document.findOne({
        namespace: document.namespace,
        title: document.title
    });

    const parseResult = parser(content, { thread: isThread });
    let { html: contentHtml, categories } = await toHtml(parseResult, {
        document,
        dbDocument,
        aclData: req.aclData,
        thread: isThread,
        req
    });

    res.json({
        contentHtml,
        categories: categories.map(a => ({
            ...a,
            text: undefined,
            document: utils.parseDocumentName('분류:' + a.document)
        }))
    });
});

const postEditAndEditRequest = async (req, res) => {
    const editingEditRequest = req.url.startsWith('/edit_request/');
    const isEditRequest = editingEditRequest || req.url.startsWith('/new_edit_request/');

    if(req.body.agree !== 'Y') return res.status(400).send('수정하기 전에 먼저 문서 배포 규정에 동의해 주세요.');
    if(req.body.log.length > 255) return res.status(400).send('요약의 값은 255글자 이하여야 합니다.');

    req.session.editagreeAgreed = true;

    const section = parseInt(req.body.section);

    const invalidSection = () => res.status(400).send('섹션이 올바르지 않습니다.');

    if(req.body.section && (isNaN(section) || section < 1)) return invalidSection();

    const document = req.document;

    const { namespace, title } = document;

    let dbDocument = req.dbDocument;
    dbDocument ??= await Document.findOne({
        namespace,
        title
    });

    let isCreate = !dbDocument || !dbDocument.contentExists;

    if(!req.isAPI && !await utils.middleValidateCaptcha(req, res, isCreate)) return;

    if(!dbDocument) {
        dbDocument = new Document({
            namespace,
            title
        });
        await dbDocument.save();
    }

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: editable, aclMessage } = await acl.check(isEditRequest ? ACLTypes.EditRequest : ACLTypes.Edit, req.aclData);

    if(!editable) return res.status(403).send(aclMessage);

    const rev = await History.findOne({
        document: dbDocument.uuid
    }).sort({ rev: -1 });

    if(!editingEditRequest && isEditRequest) {
        const checkEditRequest = await EditRequest.exists({
            document: dbDocument.uuid,
            createdUser: req.user.uuid,
            status: EditRequestStatusTypes.Open
        });
        if(checkEditRequest) return res.status(409).send('이미 해당 문서에 편집요청이 존재합니다. 해당 편집요청을 수정하시기 바랍니다.');
    }

    let editedRev = rev;
    if(req.body.baseuuid !== 'create' && (!rev || rev.uuid !== req.body.baseuuid)) {
        editedRev = await History.findOne({
            uuid: req.body.baseuuid
        });
        if(!editedRev) return res.status(400).send('baseuuid가 올바르지 않습니다.');
    }

    let content = req.body.text;
    let log = req.body.log;

    if(content == null) return res.status(400).send('content가 올바르지 않습니다.');

    if(rev?.content != null && req.body.section && !editingEditRequest) {
        const newLines = [];

        const fullLines = editedRev.content.split('\n');
        const parseResult = parser(rev.content);
        const headings = parseResult.result.filter(a => a.type === 'heading');
        const headingLines = headings.map(a => a.line - 1);
        if(section > headingLines.length) return invalidSection();

        const start = headingLines[section - 1];
        const next = headingLines[section] ?? fullLines.length;

        newLines.push(...fullLines.slice(0, start));
        newLines.push(content);
        newLines.push(...fullLines.slice(next));

        content = newLines.join('\n');
    }
    else {
        if(content.startsWith('#넘겨주기 ')) content = content.replace('#넘겨주기 ', '#redirect ');
        if(content.startsWith('#redirect ')) content = content.split('\n')[0];
        if(content.startsWith('#redirect 문서:')) content = content.replace('#redirect 문서:', '#redirect ');
    }

    if(rev?.content === content) return res.status(400).send('문서 내용이 같습니다.');

    isCreate = rev?.content == null;
    if(isCreate && isEditRequest) return res.status(404).send('문서를 찾을 수 없습니다.');

    if(isCreate ? (req.body.baseuuid !== 'create') : (rev.uuid !== req.body.baseuuid)) {
        const mergedContent = utils.mergeText(editedRev.content, content, rev.content);
        if(mergedContent != null) {
            content = mergedContent;
            if(!isEditRequest) log ||= `자동 병합됨 (r${editedRev.rev})`;
        }
        else {
            if(req.isAPI) return res.status(409).send('편집 도중에 다른 사용자가 먼저 편집을 했습니다.');

            const conflictData = {
                editedRev: editedRev.rev,
                diff: await utils.generateDiff(editedRev.content, content)
            }
            return res.partial({
                errorAlert: '편집 도중에 다른 사용자가 먼저 편집을 했습니다.',
                conflict: conflictData,
                content: rev.content,
                publicData: {
                    body: {
                        baserev: rev.rev,
                        baseuuid: rev.uuid,
                        section: null
                    }
                }
            });
        }
    }

    if(namespace === '파일' && isCreate) return res.status(400).send('invalid_namespace');
    if((namespace === '사용자' || namespace === '삭제된사용자') && isCreate && (!title.includes('/') || title.startsWith('*'))) return res.status(400).send('사용자 문서는 생성할 수 없습니다.');

    if(isEditRequest) {
        const editRequest = await EditRequest.findOneAndUpdate({
            document: dbDocument.uuid,
            createdUser: req.user.uuid,
            status: EditRequestStatusTypes.Open
        }, {
            content,
            log,
            baseUuid: editedRev.uuid,
            diffLength: content.length - editedRev.content.length
        }, {
            new: true,
            upsert: true
        });

        res.redirect(`/edit_request/${editRequest.url}`);
    }
    else {
        const rev = await History.create({
            user: req.user.uuid,
            sessionId: req.session.sessionId,
            type: isCreate ? HistoryTypes.Create : HistoryTypes.Modify,
            document: dbDocument.uuid,
            content,
            log,
            api: req.isAPI
        });

        if(req.isAPI) res.sendData({ rev });
        else res.redirect(globalUtils.doc_action_link(document, 'w'));
    }
}
module.exports.postEditAndEditRequest = postEditAndEditRequest;

app.post('/edit/{*document}', middleware.parseDocumentName, postEditAndEditRequest);
app.post('/new_edit_request/{*document}', middleware.parseDocumentName, postEditAndEditRequest);
app.post('/edit_request/:url/edit', async (req, res, next) => {
    const editRequest = await EditRequest.findOne({
        url: req.params.url
    });
    if(!editRequest) return res.error('편집 요청을 찾을 수 없습니다.', 404);
    if(editRequest.createdUser !== req.user.uuid) return res.error('자신의 편집 요청만 수정할 수 있습니다.', 403);
    if(editRequest.status !== EditRequestStatusTypes.Open) return res.error('편집 요청 상태가 올바르지 않습니다.');

    req.editRequest = editRequest;
    req.dbDocument = await Document.findOne({
        uuid: editRequest.document
    });
    req.document = utils.dbDocumentToDocument(req.dbDocument);

    next();
}, postEditAndEditRequest);

app.get('/edit_request/:url', async (req, res) => {
    let editRequest = await EditRequest.findOne({
        url: req.params.url
    }).lean();
    if(!editRequest) return res.error('편집 요청을 찾을 수 없습니다.', 404);

    const dbDocument = await Document.findOne({
        uuid: editRequest.document
    }).lean();
    const document = utils.dbDocumentToDocument(dbDocument);

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage, 403);

    let { result: editable } = await acl.check(ACLTypes.Edit, req.aclData);

    const baseRev = await History.findOne({
        uuid: editRequest.baseUuid
    }).lean();
    if(baseRev.content == null) editable = false;

    let contentHtml;
    let conflict = false;
    if(editRequest.status === EditRequestStatusTypes.Open) {
        const latestRev = await History.findOne({
            document: dbDocument.uuid
        })
            .sort({ rev: -1 })
            .lean();

        if(latestRev?.content) {
            const parseResult = parser(latestRev.content, { editorComment: true });
            const { html } = await toHtml(parseResult, {
                document,
                aclData: req.aclData,
                req
            });
            contentHtml = html;

            conflict = utils.mergeText(baseRev.content, editRequest.content, latestRev.content) == null;
        }
    }

    editRequest = await utils.findUsers(req, editRequest, 'createdUser');
    editRequest = await utils.findUsers(req, editRequest, 'lastUpdateUser');

    const userHtmlOptions = {
        isAdmin: req.permissions.includes('admin'),
        note: `편집 요청 ${editRequest.url} 긴급차단`
    }
    editRequest.createdUser.userHtml = utils.userHtml(editRequest.createdUser, userHtmlOptions);
    if(editRequest.lastUpdateUser)
        editRequest.lastUpdateUser.userHtml = utils.userHtml(editRequest.lastUpdateUser, userHtmlOptions);

    editRequest.acceptedRev &&= await History.findOne({
        uuid: editRequest.acceptedRev
    }).select('rev uuid -_id');

    const showContent = [
        EditRequestStatusTypes.Open,
        EditRequestStatusTypes.Closed
    ].includes(editRequest.status)
        || (editRequest.status === EditRequestStatusTypes.Locked && req.permissions.includes('manage_thread'));

    res.renderSkin(undefined, {
        viewName: 'edit_request',
        contentName: 'document/editRequest',
        document,
        serverData: {
            contentHtml,
            editRequest: utils.onlyKeys(editRequest, [
                'url',
                'createdUser',
                'lastUpdateUser',
                'createdAt',
                'lastUpdatedAt',
                'diffLength',
                'log',
                'status',
                'acceptedRev',
                'closedReason',
                ...(showContent ? ['content'] : [])
            ]),
            baseRev: utils.onlyKeys(baseRev, ['rev']),
            diff: showContent ? (await utils.generateDiff(baseRev.content, editRequest.content)) : null,
            showContent,
            conflict,
            editable,
            selfCreated: editRequest.createdUser.uuid === req.user?.uuid,
            permissions: {
                status: req.permissions.includes('manage_thread')
            }
        }
    });
});

app.post('/edit_request/:url/accept', async (req, res) => {
    const editRequest = await EditRequest.findOne({
        url: req.params.url
    });
    if(!editRequest) return res.error('편집 요청을 찾을 수 없습니다.', 404);
    if(editRequest.status !== EditRequestStatusTypes.Open) return res.error('편집 요청 상태가 올바르지 않습니다.');

    const dbDocument = await Document.findOne({
        uuid: editRequest.document
    }).lean();
    const document = utils.dbDocumentToDocument(dbDocument);

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: editable, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);
    if(!editable) return res.error(aclMessage, 403);

    const rev = await History.findOne({
        document: dbDocument.uuid
    }).sort({ rev: -1 });

    let content = editRequest.content;

    if(rev?.content === content) return res.status(400).send('문서 내용이 같습니다.');

    const isCreate = rev?.content == null;
    if(isCreate) return res.status(400).send('삭제된 문서입니다.');

    if(rev.uuid !== editRequest.baseUuid) {
        const baseRev = await History.findOne({
            uuid: editRequest.baseUuid
        });

        content = utils.mergeText(baseRev.content, editRequest.content, rev.content);
        if(content == null) return res.status(403).send('이 편집 요청은 충돌된 상태입니다. 요청자가 수정해야 합니다.');
    }

    const newRev = await History.create({
        user: editRequest.createdUser,
        sessionId: req.session.sessionId,
        type: isCreate ? HistoryTypes.Create : HistoryTypes.Modify,
        document: dbDocument.uuid,
        content,
        log: editRequest.log,
        editRequest: editRequest.uuid,
        editRequestAcceptedBy: req.user.uuid
    });

    await EditRequest.updateOne({
        uuid: editRequest.uuid
    }, {
        lastUpdateUser: req.user.uuid,
        status: EditRequestStatusTypes.Accepted,
        acceptedRev: newRev.uuid
    });

    res.redirect(`/edit_request/${editRequest.url}`);
});

app.get('/history/{*document}', middleware.parseDocumentName, async (req, res) => {
    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage, 403);

    let revs;
    let latestRev;
    if(dbDocument) {
        const query = {
            document: dbDocument.uuid
        };

        if(!isNaN(req.query.until)) query.rev = { $gte: parseInt(req.query.until) };
        else if(!isNaN(req.query.from)) query.rev = { $lte: parseInt(req.query.from) };

        const revKeys = 'type rev uuid user createdAt diffLength log revertRev moveOldDoc moveNewDoc troll trollBy hideLog hideLogBy hidden editRequest sessionId -_id'.split(' ');
        if(req.permissions.includes('config'))
            revKeys.push('fileKey');
        revs = await History.find(query)
            .sort({ rev: query.rev?.$gte ? 1 : -1 })
            .limit(30)
            .select(revKeys)
            .lean();

        if(query.rev?.$gte) revs.reverse();

        latestRev = await History.findOne({
            document: dbDocument.uuid
        })
            .sort({ rev: -1 })
            .select('uuid -_id');
    }

    if(!dbDocument || !revs.length) return res.error('문서를 찾을 수 없습니다.');

    revs = await utils.findUsers(req, revs);
    revs = await utils.findUsers(req, revs, 'trollBy');
    revs = await utils.findUsers(req, revs, 'hideLogBy');

    for(let rev of revs) {
        if(rev.editRequest) rev.editRequest = await EditRequest.findOne({
            uuid: rev.editRequest
        }).select('url -_id');
        else if(req.user?.type === UserTypes.Account
            && rev.user.type === UserTypes.IP
            && rev.sessionId === req.session.sessionId)
            rev.transfer = true;
        delete rev.sessionId;
    }

    res.renderSkin(undefined, {
        viewName: 'history',
        document,
        serverData: {
            revs: revs.map(a => utils.addHistoryData(req, a, req.permissions.includes('admin'), req.document)),
            latestRev,
            permissions: {
                troll: req.permissions.includes('mark_troll_revision'),
                log: req.permissions.includes('hide_document_history_log'),
                hide: req.permissions.includes('hide_revision'),
                config: req.permissions.includes('config')
            }
        },
        contentName: 'document/history'
    });
});

app.get('/raw/{*document}', middleware.parseDocumentName, async (req, res) => {
    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result: readable, aclMessage: read_acl_message } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(read_acl_message, 403);

    if(!dbDocument) return res.error('문서를 찾을 수 없습니다.', 404);

    const rev = await History.findOne({
        document: dbDocument.uuid,
        ...(req.query.uuid ? { uuid: req.query.uuid } : {})
    }).sort({ rev: -1 });

    if(req.query.uuid && !rev) return res.error('해당 리비전이 존재하지 않습니다.', 404);

    if(rev.hidden) return res.error('숨겨진 리비전입니다.', 403);

    res.renderSkin(undefined, {
        contentName: 'document/raw',
        viewName: 'raw',
        document,
        rev: rev.rev,
        uuid: rev.uuid,
        serverData: {
            content: rev?.content ?? ''
        }
    });
});

app.get('/revert/{*document}', middleware.parseDocumentName, middleware.checkCaptcha(), async (req, res) => {
    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);
    if(!result) return res.error(aclMessage, 403);

    if(!dbDocument) return res.error('문서를 찾을 수 없습니다.', 404);

    const rev = await History.findOne({
        document: dbDocument.uuid,
        uuid: req.query.uuid
    });

    if(!req.query.uuid || !rev) return res.error('해당 리비전이 존재하지 않습니다.', 404);

    if(![
        HistoryTypes.Create,
        HistoryTypes.Modify,
        HistoryTypes.Revert
    ].includes(rev.type)) return res.error('이 리비전으로 되돌릴 수 없습니다.');

    if(rev.troll) return res.error('이 리비전은 반달로 표시되었기 때문에 되돌릴 수 없습니다.', 403);
    if(rev.hidden) return res.error('숨겨진 리비전입니다.', 403);

    let contentHtml;
    const latestRev = await History.findOne({
        document: dbDocument.uuid
    })
        .sort({ rev: -1 })
        .lean();
    if(latestRev.content) {
        const parseResult = parser(latestRev.content, { editorComment: true });
        const { html } = await toHtml(parseResult, {
            document,
            aclData: req.aclData,
            req
        });
        if(html) contentHtml = html;
    }

    res.renderSkin(undefined, {
        contentName: 'document/revert',
        viewName: 'revert',
        document,
        rev: rev.rev,
        uuid: rev.uuid,
        serverData: {
            content: rev?.content ?? '',
            contentHtml
        }
    });
});

app.post('/revert/{*document}', middleware.parseDocumentName, middleware.captcha(), async (req, res) => {
    if(req.body.log.length > 255) return res.error('요약의 값은 255글자 이하여야 합니다.');

    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);
    if(!result) return res.error(aclMessage, 403);

    if(!dbDocument) return res.error('문서를 찾을 수 없습니다.', 404);

    const rev = await History.findOne({
        document: dbDocument.uuid,
        uuid: req.body.uuid
    });

    if(!req.body.uuid || !rev) return res.error('해당 리비전이 존재하지 않습니다.', 404);

    if(![
        HistoryTypes.Create,
        HistoryTypes.Modify,
        HistoryTypes.Revert
    ].includes(rev.type)) return res.error('이 리비전으로 되돌릴 수 없습니다.');

    if(rev.troll) return res.error('이 리비전은 반달로 표시되었기 때문에 되돌릴 수 없습니다.', 403);
    if(rev.hidden) return res.error('숨겨진 리비전입니다.', 403);

    const currentRev = await History.findOne({
        document: dbDocument.uuid
    }).sort({ rev: -1 });

    if(currentRev.content == null && (namespace === '사용자' || namespace === '삭제된사용자') && (!title.includes('/') || title.startsWith('*')))
        return res.status(400).send('사용자 문서는 생성할 수 없습니다.');

    if(rev.content === currentRev.content) return res.error('문서 내용이 같습니다.');

    await History.create({
        user: req.user.uuid,
        sessionId: req.session.sessionId,
        type: HistoryTypes.Revert,
        document: dbDocument.uuid,
        revertRev: rev.revertRev || rev.rev,
        revertUuid: rev.uuid,
        content: rev.content,
        fileKey: rev.fileKey,
        fileSize: rev.fileSize,
        fileWidth: rev.fileWidth,
        fileHeight: rev.fileHeight,
        log: req.body.log
    });

    res.redirect(globalUtils.doc_action_link(document, 'w'));
});

app.get('/diff/{*document}', middleware.parseDocumentName, async (req, res) => {
    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result: readable, aclMessage: read_acl_message } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(read_acl_message, 403);

    if(!dbDocument) return res.error('문서를 찾을 수 없습니다.', 404);

    const noRev = () => res.error('해당 리비전이 존재하지 않습니다.', 404);

    const rev = await History.findOne({
        document: dbDocument.uuid,
        uuid: req.query.uuid
    });

    if(!req.query.uuid || !rev) return noRev();

    const oldRev = await History.findOne({
        document: dbDocument.uuid,
        ...(req.query.olduuid
            ? { uuid: req.query.olduuid }
            : { rev: rev?.rev - 1 }
        )
    });

    if(!oldRev || oldRev.rev >= rev.rev) return noRev();

    if(rev.hidden || oldRev.hidden) return res.error('숨겨진 리비전입니다.', 403);

    let diff;
    try {
        diff = await utils.generateDiff(oldRev.content, rev.content);
    } catch(e) {
        console.error(e);
        return res.status(500).send(e.message);
    }

    res.renderSkin(undefined, {
        contentName: 'document/diff',
        viewName: 'diff',
        document,
        oldRev: oldRev.rev,
        rev: rev.rev,
        olduuid: oldRev.uuid,
        uuid: rev.uuid,
        serverData: {
            diff
        }
    });
});

app.get('/blame/{*document}', middleware.parseDocumentName, async (req, res) => {
    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result: readable, aclMessage: read_acl_message } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(read_acl_message, 403);

    if(!dbDocument) return res.error('문서를 찾을 수 없습니다.', 404);

    const rev = await History.findOne({
        document: dbDocument.uuid,
        uuid: req.query.uuid
    });

    if(!req.query.uuid || !rev) return res.error('해당 리비전이 존재하지 않습니다.', 404);

    if(rev.hidden) return res.error('숨겨진 리비전입니다.', 403);

    if(!rev.blame?.length) return res.error('blame 데이터를 찾을 수 없습니다.');

    let blame = await utils.findHistories(req, rev.blame, req.permissions.includes('admin'));
    blame = await utils.findUsers(req, blame, 'user', { getColor: true });

    const lines = rev.content?.split('\n') ?? [''];

    const blameLines = [];
    let remainingCount = 0;
    const blameCopy = blame.slice();
    for(let i in lines) {
        i = parseInt(i);
        const obj = { content: lines[i] };

        if(!remainingCount) {
            const diff = blameCopy.shift();
            remainingCount = diff.count;
            obj.diff = diff;
        }
        remainingCount--;

        blameLines.push(obj);
    }

    res.renderSkin(undefined, {
        contentName: 'document/blame',
        viewName: 'blame',
        document,
        rev: rev.rev,
        uuid: rev.uuid,
        serverData: {
            blameLines
        }
    });
});

const getBacklinks = async (req, res) => {
    const document = req.document;
    const docName = globalUtils.doc_fulltitle(document);

    const baseQuery = {
        backlinks: {
            $elemMatch: {
                docName
            }
        }
    }

    const namespaceCounts = [];
    for(let namespace of config.namespaces) {
        const count = await Document.countDocuments({
            namespace,
            ...baseQuery
        });
        if(count) namespaceCounts.push({
            namespace,
            count
        });
    }

    const selectedNamespace = namespaceCounts.some(a => a.namespace === req.query.namespace)
        ? req.query.namespace
        : namespaceCounts[0]?.namespace;

    let backlinks = [];
    const backlinksPerChar = {};
    let prevItem;
    let nextItem;

    if(selectedNamespace) {
        const numFlag = Number(req.query.flag);
        if(Object.values(BacklinkFlags).includes(numFlag))
            baseQuery.backlinks.$elemMatch.flags = numFlag;

        const query = {
            namespace: selectedNamespace,
            ...baseQuery
        }

        const pageQuery = req.query.until || req.query.from;
        if(pageQuery) {
            const checkExists = await Document.findOne({
                title: pageQuery
            });
            if(checkExists) {
                if(req.query.until) query.upperTitle = {
                    $lte: checkExists.upperTitle
                }
                else query.upperTitle = {
                    $gte: checkExists.upperTitle
                }
            }
        }

        backlinks = await Document.find(query)
            .sort({ upperTitle: query.upperTitle?.$lte ? -1 : 1 })
            .limit(50)
            .lean();

        if(query.upperTitle?.$lte) backlinks.reverse();

        if(backlinks.length) {
            prevItem = await Document.findOne({
                ...query,
                upperTitle: {
                    $lt: backlinks[0].upperTitle
                }
            })
                .sort({ upperTitle: -1 })
                .select('title -_id')
                .lean();

            nextItem = await Document.findOne({
                ...query,
                upperTitle: {
                    $gt: backlinks[backlinks.length - 1].upperTitle
                }
            })
                .sort({ upperTitle: 1 })
                .select('title -_id')
                .lean();
        }
    }

    for(let document of backlinks) {
        let char = document.upperTitle[0];
        const choseong = getChoseong(char);
        if(choseong) char = choseong;

        document.parsedName = utils.parseDocumentName(`${document.namespace}:${document.title}`);
        document.flags = document.backlinks.find(a => a.docName === docName).flags;

        const arr = backlinksPerChar[char] ??= [];
        arr.push(utils.onlyKeys(document, ['parsedName', 'flags']));
    }

    res.renderSkin(undefined, {
        contentName: 'document/backlink',
        viewName: 'backlink',
        document,
        serverData: {
            selectedNamespace,
            namespaceCounts,
            backlinksPerChar,
            prevItem,
            nextItem,
            ...(req.isAPI ? {
                backlinks
            } : {})
        }
    });
}
module.exports.getBacklinks = getBacklinks;

app.get('/backlink/{*document}', middleware.parseDocumentName, getBacklinks);

app.get('/delete/{*document}', middleware.parseDocumentName, middleware.checkCaptcha(true), async (req, res) => {
    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result, aclMessage } = await acl.check(ACLTypes.Delete, req.aclData);
    if(!result) return res.error(aclMessage, 403);

    if(!dbDocument?.contentExists) return res.error('문서를 찾을 수 없습니다.', 404);

    res.renderSkin(undefined, {
        contentName: 'document/delete',
        viewName: 'delete',
        document
    });
});

app.post('/delete/{*document}', middleware.parseDocumentName, middleware.captcha(true), async (req, res) => {
    if(!req.permissions.includes('edit_protected_file')
        && Object.keys(config.external_link_icons).includes(globalUtils.doc_fulltitle(req.document)))
        return res.error('protect_file', 403);

    if(req.body.agree !== 'Y') return res.status(400).send('문서 삭제에 대한 안내를 확인해 주세요.');
    if(req.body.log.length < 5) return res.status(400).send('5자 이상의 요약을 입력해 주세요.');
    if(req.body.log.length > 255) return res.status(400).send('요약의 값은 255글자 이하여야 합니다.');

    const document = req.document;

    const { namespace, title } = document;

    if((namespace === '사용자' || namespace === '삭제된사용자') && !title.includes('/')) return res.status(403).send('disable_user_document');

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result, aclMessage } = await acl.check(ACLTypes.Delete, req.aclData);
    if(!result) return res.status(403).send(aclMessage);

    if(!dbDocument?.contentExists) return res.status(404).send('문서를 찾을 수 없습니다.');

    await History.create({
        user: req.user.uuid,
        sessionId: req.session.sessionId,
        type: HistoryTypes.Delete,
        document: dbDocument.uuid,
        content: null,
        log: req.body.log
    });

    res.redirect(globalUtils.doc_action_link(document, 'w'));
});

app.get('/move/{*document}', middleware.parseDocumentName, middleware.checkCaptcha(true), async (req, res) => {
    const document = req.document;

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result, aclMessage } = await acl.check(ACLTypes.Move, req.aclData);
    if(!result) return res.error(aclMessage, 403);

    if(!dbDocument) return res.error('문서를 찾을 수 없습니다.', 404);

    res.renderSkin(undefined, {
        contentName: 'document/move',
        viewName: 'move',
        document
    });
});

app.post('/move/{*document}', middleware.parseDocumentName, middleware.captcha(true), async (req, res) => {
    if(req.body.log.length < 5) return res.status(400).send('5자 이상의 요약을 입력해 주세요.');
    if(req.body.log.length > 255) return res.status(400).send('요약의 값은 255글자 이하여야 합니다.');
    if(!req.body.title || req.body.title.length > 255) return res.status(400).send('문서 이름이 올바르지 않습니다.');

    const document = req.document;
    const otherDocument = utils.parseDocumentName(req.body.title);

    const protectedFiles = Object.keys(config.external_link_icons);
    if(!req.permissions.includes('edit_protected_file')
        && (protectedFiles.includes(globalUtils.doc_fulltitle(document))
            || protectedFiles.includes(globalUtils.doc_fulltitle(otherDocument))))
        return res.error('protect_file', 403);

    if(document.namespace.includes('파일')) {
        const ext = document.title.split('.').pop();
        const newExt = otherDocument.title.split('.').pop();
        if(ext !== newExt) return res.status(400).send(`문서 이름과 확장자가 맞지 않습니다. (파일 확장자: ${ext})`);
    }

    const isSwap = req.body.mode === 'swap';

    const dbDocument = await Document.findOne({
        namespace: document.namespace,
        title: document.title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result, aclMessage } = await acl.check(ACLTypes.Move, req.aclData);
    if(!result) return res.error(aclMessage, 403);

    if(!dbDocument) return res.error('문서를 찾을 수 없습니다.', 404);

    let dbOtherDocument = await Document.findOne({
        namespace: otherDocument.namespace,
        title: otherDocument.title
    });
    let dbOtherDocumentExists = !!dbOtherDocument;

    if(!dbOtherDocument) {
        dbOtherDocument = new Document({
            namespace: otherDocument.namespace,
            title: otherDocument.title
        });
    }

    const otherAcl = await ACL.get({ document: dbOtherDocument }, otherDocument);

    const { result: otherResult, aclMessage: otherAclMessage } = await otherAcl.check(ACLTypes.Move, req.aclData);
    if(!otherResult) return res.error(otherAclMessage, 403);

    const isUserDoc = document.namespace === '사용자' && !document.title.includes('/');
    const otherIsUserDoc = otherDocument.namespace === '사용자' && (!otherDocument.title.includes('/') || otherDocument.title.startsWith('*'));
    if(isUserDoc || otherIsUserDoc || (document.namespace.includes('파일') !== otherDocument.namespace.includes('파일')))
        return res.error('이 문서를 해당 이름공간으로 이동할 수 없습니다.', 403);

    const revExists = await History.exists({
        document: dbOtherDocument.uuid
    });

    if(isSwap) {
        if(!revExists || dbDocument.uuid === dbOtherDocument.uuid) return res.error('문서를 찾을 수 없습니다.', 404);

        if(!dbOtherDocumentExists) await dbOtherDocument.save();

        await Document.updateOne({
            uuid: dbDocument.uuid
        }, {
            namespace: 'internal temp',
            title: otherDocument.title
        });
        await Document.updateOne({
            uuid: dbOtherDocument.uuid
        }, {
            namespace: document.namespace,
            title: document.title
        });
        await Document.updateOne({
            uuid: dbDocument.uuid
        }, {
            namespace: otherDocument.namespace
        });
    }
    else {
        if(revExists) return res.error('문서가 이미 존재합니다.', 409);

        if(dbOtherDocumentExists) {
            await Document.deleteOne({
                uuid: dbOtherDocument.uuid
            });
            await Thread.updateMany({
                document: dbOtherDocument.uuid
            }, {
                document: dbDocument.uuid
            });
        }

        await Document.updateOne({
            uuid: dbDocument.uuid
        }, {
            namespace: otherDocument.namespace,
            title: otherDocument.title
        });
    }

    await History.create({
        user: req.user.uuid,
        sessionId: req.session.sessionId,
        type: HistoryTypes.Move,
        document: dbDocument.uuid,
        log: req.body.log,
        moveOldDoc: globalUtils.doc_fulltitle(document),
        moveNewDoc: globalUtils.doc_fulltitle(otherDocument)
    });
    if(isSwap) await History.create({
        user: req.user.uuid,
        sessionId: req.session.sessionId,
        type: HistoryTypes.Move,
        document: dbOtherDocument.uuid,
        log: req.body.log,
        moveOldDoc: globalUtils.doc_fulltitle(otherDocument),
        moveNewDoc: globalUtils.doc_fulltitle(document)
    });

    res.redirect(globalUtils.doc_action_link(otherDocument, 'w'));
});

app.post('/transfer_contribution/{*document}', middleware.parseDocumentName, async (req, res) => {
    const document = req.document;
    const { namespace, title } = document;
    const dbDocument = await Document.findOne({
        namespace,
        title
    });
    const acl = await ACL.get({ document: dbDocument }, document);

    const { result, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);
    if(!result) return res.status(403).send(aclMessage);

    if(!dbDocument?.contentExists) return res.status(404).send('문서를 찾을 수 없습니다.');

    const rev = await History.findOne({
        document: dbDocument.uuid,
        uuid: req.body.uuid
    });
    if(!rev) return res.status(404).send('rev를 찾을 수 없습니다.');

    const user = await User.findOne({
        uuid: rev.user
    });
    if(rev.editRequest || user.type !== UserTypes.IP || rev.sessionId !== req.session.sessionId)
        return res.status(400).send('not_transferable');

    await History.updateOne({
        _id: rev._id
    }, {
        user: req.user.uuid
    });

    res.reload();
});

module.exports.router = app;