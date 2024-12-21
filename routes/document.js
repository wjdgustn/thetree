const express = require('express');
const { Address4, Address6 } = require('ip-address');
// const { body, validationResult } = require('express-validator');

const NamumarkParser = require('../utils/namumark');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const {
    ACLTypes,
    ACLConditionTypes,
    ACLActionTypes,
    HistoryTypes
} = require('../utils/types');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const ACLModel = require('../schemas/acl');
const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');

const ACL = require('../class/acl');

const app = express.Router();

app.get('/', (req, res) => {
    res.redirect(`/w/${config.front_page}`);
});

app.get('/w/*', async (req, res) => {
    const document = utils.parseDocumentName(req.params[0]);

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    let rev;
    if(dbDocument) rev = await History.findOne({
        document: dbDocument.uuid,
        ...(req.query.uuid ? { uuid: req.query.uuid } : {})
    }).sort({ rev: -1 });

    const acl = await ACL.get({ document: dbDocument }, document);

    const defaultData = {
        viewName: 'wiki',
        date: undefined,
        discuss_progress: false,
        document,
        edit_acl_message: null,
        editable: false,
        rev: req.query.uuid && req.query.uuid === rev?.uuid ? rev.rev : null,
        uuid: req.query.uuid && req.query.uuid === rev?.uuid ? rev.uuid : null,
        star_count: undefined,
        starred: null,
        user: null
    };

    const { result: readable, aclMessage: read_acl_message } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.renderSkin(undefined, {
        ...defaultData,
        date: null,
        contentHtml: `<h2>${read_acl_message}</h2>`
    });

    if(req.query.uuid && !rev) return res.renderSkin(undefined, {
        ...defaultData,
        date: null,
        contentHtml: '<h2>해당 리비전이 존재하지 않습니다.</h2>'
    });

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
            .lean();

        revs = await utils.findUsers(revs);

        return res.renderSkin(undefined, {
            ...defaultData,
            viewName: 'notfound',
            contentName: 'notfound',
            serverData: {
                document,
                revs
            }
        });
    }

    if(!req.query.noredirect && rev.content?.startsWith('#redirect ')) {
        const redirectName = rev.content.split('\n')[0].slice(10);
        const redirectDoc = utils.parseDocumentName(redirectName);
        const checkDoc = await Document.exists({
            namespace: redirectDoc.namespace,
            title: redirectDoc.title
        });
        if(checkDoc) return res.redirect(globalUtils.doc_action_link(redirectDoc, 'w', {
            from: globalUtils.doc_fulltitle(document),
            anchor: redirectDoc.anchor
        }));
    }

    let user;
    if(namespace === '사용자') {
        user = await User.findOne({
            name: title
        });
        if(user) defaultData.user = {
            uuid: user.uuid
        }
    }

    const parser = new NamumarkParser({
        document,
        aclData: req.aclData,
        req
    });

    let { html: contentHtml, categories } = await parser.parse(rev.content);
    let categoryHtml;
    try {
        categoryHtml = await utils.renderCategory(categories, namespace !== '사용자');
    } catch (e) {
        return res.status(500).send('카테고리 렌더 오류');
    }

    if(user) {
        if(user.permissions.includes('admin')) contentHtml = `
<div style="border-width: 5px 1px 1px; border-style: solid; border-color: orange gray gray; border-image: initial; padding: 10px; margin-bottom: 10px;" onmouseover="this.style.borderTopColor='red';" onmouseout="this.style.borderTopColor='orange';">
<span>이 사용자는 특수 권한을 가지고 있습니다.</span>
</div>
        `.replaceAll('\n', '').trim() + contentHtml;

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

        if(blockedItem) contentHtml = `
<div onmouseover="this.style.borderTopColor='blue';" onmouseout="this.style.borderTopColor='red';" style="border-width: 5px 1px 1px; border-style: solid; border-color: red gray gray; border-image: initial; padding: 10px; margin-bottom: 10px;">
<span>이 사용자는 차단된 사용자입니다. (#${blockedItem.id})</span>
<br><br>
이 사용자는 ${globalUtils.getFullDateTag(blockedItem.createdAt)}에 ${blockedItem.expiresAt ? globalUtils.getFullDateTag(blockedItem.expiresAt) + ' 까지' : '영구적으로'} 차단되었습니다.
<br>
차단 사유: ${blockedItem.note ?? '없음'}
</div>
        `.replaceAll('\n', '').trim() + contentHtml;
    }

    res.renderSkin(undefined, {
        ...defaultData,
        serverData: {
            rev
        },
        contentHtml,
        categoryHtml,
        date: rev.createdAt.getTime(),
        star_count: 0,
        starred: false
    });
});

app.get('/acl/*', async (req, res) => {
    const document = utils.parseDocumentName(req.params[0]);

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

    res.renderSkin(undefined, {
        viewName: 'acl',
        document,
        serverData: {
            acl,
            namespaceACL,
            editableACL,
            editableNSACL
        },
        contentName: 'acl'
    });
});

app.post('/acl/*', async (req, res) => {
    const target = req.body.target;

    const document = utils.parseDocumentName(req.params[0]);

    const { namespace, title } = document;

    let dbDocument;
    if(target === 'document') {
        dbDocument = await Document.findOne({
            namespace,
            title
        });

        if(dbDocument) {
            const acl = await ACL.get({document: dbDocument}, document);
            const {result: editable, aclMessage} = await acl.check(ACLTypes.ACL, req.aclData);

            if(!editable) return res.status(403).send(aclMessage);
        }
    }
    else if(target === 'namespace') {
        if(!req.permissions.includes('nsacl')) return res.status(403).send('이름공간 ACL 수정은 nsacl 권한이 필요합니다!');
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
        if(!req.body.permission) return res.status(400).send('권한 값을 입력해주세요!');
        conditionContent = req.body.permission;
        rawConditionContent = req.body.permission;
    }
    else if(conditionType === ACLConditionTypes.Member) {
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
        conditionType,
        conditionContent,
        actionType
    }

    if(actionType === ACLActionTypes.GotoOtherNS) {
        if(!req.permissions.includes('developer')) return res.status(403).send(`${req.body.actionType}는 개발자 전용입니다!`);

        if(!req.body.actionContent) return res.status(400).send('이동할 이름공간을 입력하세요!');
        if(!config.namespaces.includes(req.body.actionContent)) return res.status(400).send(`${req.body.actionContent} 이름공간은 존재하지 않습니다!`);

        newACL.actionContent = req.body.actionContent;
    }

    if(target === 'document') {
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

    if(dbDocument) await History.create({
        user: req.user.uuid,
        type: HistoryTypes.ACL,
        document: dbDocument.uuid,
        log: [
            'insert',
            utils.camelToSnakeCase(req.body.aclType),
            req.body.actionType.toLowerCase(),
            req.body.conditionType.toLowerCase() + ':' + rawConditionContent
        ].join(',')
    });

    res.redirect(req.originalUrl);
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
    if(dbACL.document) {
        dbDocument = await Document.findOne({
            uuid: dbACL.document
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
    }

    await ACLModel.deleteOne({
        uuid: aclId
    });

    if(dbDocument) {
        const conditionType = dbACL.conditionType;
        let conditionContent = dbACL.conditionContent;
        if(conditionType === ACLConditionTypes.Member) {
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

        await History.create({
            user: req.user.uuid,
            type: HistoryTypes.ACL,
            document: dbDocument.uuid,
            log: [
                'delete',
                utils.camelToSnakeCase(utils.getKeyFromObject(ACLTypes, dbACL.type)),
                utils.getKeyFromObject(ACLActionTypes, dbACL.actionType).toLowerCase(),
                utils.getKeyFromObject(ACLConditionTypes, conditionType).toLowerCase() + ':' + conditionContent
            ].join(',')
        });
    }

    res.redirect(req.get('Referer'));
});

app.patch('/action/acl/reorder', async (req, res) => {
    const uuids = JSON.parse(req.body.acls);

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

    res.redirect(303, req.get('Referer'));
});

app.get('/edit/*', async (req, res) => {
    const section = parseInt(req.query.section);

    const invalidSection = () => res.error('섹션이 올바르지 않습니다.')

    if(req.query.section && (isNaN(section) || section < 0)) return invalidSection();

    const document = utils.parseDocumentName(req.params[0]);

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage);

    const { result: editable, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);
    const { result: editRequestable } = await acl.check(ACLTypes.EditRequest, req.aclData);

    if(!editable && editRequestable) return res.redirect(globalUtils.doc_action_link(document, 'new_edit_request', {
        redirected: 1
    }));

    let rev;
    if(dbDocument) rev = await History.findOne({
        document: dbDocument.uuid
    }).sort({ rev: -1 });

    const docExists = rev?.content != null;

    // TODO: edit one section(after implement parser)

    let contentHtml;
    if(rev?.content) {
        const parser = new NamumarkParser({
            document,
            aclData: req.aclData
        });
        const { html } = await parser.parseEditorComment(rev.content);
        contentHtml = html;
    }

    res.renderSkin(undefined, {
        viewName: 'edit',
        contentName: 'edit',
        document,
        body: {
            baserev: docExists ? rev.rev.toString() : '0',
            baseuuid: docExists ? rev.uuid : 'create',
            section
        },
        serverData: {
            aclMessage,
            content: docExists ? rev.content : '',
            contentHtml
        }
    });
});

app.post('/preview/*', async (req, res) => {
    const content = req.body.content;
    if(typeof content !== 'string') return res.status(400).send('내용을 입력해주세요.');

    const document = utils.parseDocumentName(req.params[0]);

    const parser = new NamumarkParser({
        document,
        aclData: req.aclData
    });
    const { html: contentHtml, categories } = await parser.parse(content);
    let categoryHtml = '';
    try {
        categoryHtml = await utils.renderCategory(categories);
    } catch (e) {
        return res.status(500).send('카테고리 렌더 오류');
    }

    return res.send(categoryHtml + contentHtml);
});

app.post('/edit/*', async (req, res) => {
    if(req.body.agree !== 'Y') return res.status(400).send('수정하기 전에 먼저 문서 배포 규정에 동의해 주세요.');
    if(req.body.log.length > 255) return res.status(400).send('요약의 값은 255글자 이하여야 합니다.');

    const section = parseInt(req.query.section);

    const invalidSection = () => res.error('섹션이 올바르지 않습니다.');

    if(req.query.section && (isNaN(section) || section < 0)) return invalidSection();

    const document = utils.parseDocumentName(req.params[0]);

    const { namespace, title } = document;

    let dbDocument = await Document.findOne({
        namespace,
        title
    });

    if(!dbDocument) {
        dbDocument = new Document({
            namespace,
            title
        });
        await dbDocument.save();
    }

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: editable, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);

    if(!editable) return res.status(403).send(aclMessage);

    const rev = await History.findOne({
        document: dbDocument.uuid
    }).sort({ rev: -1 });

    let content = req.body.text;

    if(content.startsWith('#넘겨주기 ')) content = content.replace('#넘겨주기 ', '#redirect');
    if(content.startsWith('#redirect ')) content = content.split('\n')[0];
    if(content.startsWith('#redirect 문서:')) content = content.replace('#redirect 문서:', '#redirect ');

    if((rev?.content ?? '') === content) return res.status(400).send('문서 내용이 같습니다.');

    // TODO: automerge
    const isCreate = rev?.content == null;
    if(isCreate ? (req.body.baseuuid !== 'create') : (rev.uuid !== req.body.baseuuid))
        return res.status(400).send('편집 도중에 다른 사용자가 먼저 편집을 했습니다.');

    if(namespace === '사용자' && isCreate) return res.status(400).send('사용자 문서는 생성할 수 없습니다.');

    await History.create({
        user: req.user.uuid,
        type: isCreate ? HistoryTypes.Create : HistoryTypes.Modify,
        document: dbDocument.uuid,
        content,
        log: req.body.log
    });

    res.redirect(globalUtils.doc_action_link(document, 'w'));
});

app.get('/history/*', async (req, res) => {
    const document = utils.parseDocumentName(req.params[0]);

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);

    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage);

    let revs;
    let latestRev;
    if(dbDocument) {
        const query = {
            document: dbDocument.uuid
        };

        if(!isNaN(req.query.until)) query.rev = { $gte: parseInt(req.query.until) };
        else if(!isNaN(req.query.from)) query.rev = { $lte: parseInt(req.query.from) };

        revs = await History.find(query)
            .sort({ rev: query.rev?.$gte ? 1 : -1 })
            .limit(30)
            .lean();

        if(query.rev?.$gte) revs.reverse();

        latestRev = await History.findOne({
            document: dbDocument.uuid
        }).sort({ rev: -1 });
    }

    if(!dbDocument || !revs.length) return res.error('문서를 찾을 수 없습니다.');

    revs = await utils.findUsers(revs);

    res.renderSkin(undefined, {
        viewName: 'history',
        document,
        serverData: {
            revs,
            latestRev
        },
        contentName: 'history'
    });
});

module.exports = app;