const express = require('express');
const { Address4, Address6 } = require('ip-address');
// const { body, validationResult } = require('express-validator');

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
        type: {
            $in: [
                HistoryTypes.Create,
                HistoryTypes.Edit,
                HistoryTypes.Delete,
                HistoryTypes.Rollback
            ]
        },
        rev: parseInt(req.query.rev) || undefined
    }).sort({ rev: -1 });

    const acl = await ACL.get({ document: dbDocument }, document);

    const defaultData = {
        viewName: 'wiki',
        date: undefined,
        discuss_progress: false,
        document,
        edit_acl_message: null,
        editable: false,
        rev: req.query.rev ?? null,
        star_count: undefined,
        starred: null,
        user: null,
        uuid: null
    }

    const { result: readable, aclMessage: read_acl_message } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.renderSkin(undefined, {
        ...defaultData,
        date: null,
        contentHtml: `<h2>${read_acl_message}</h2>`
    });

    const { result: editable, aclMessage: edit_acl_message } = await acl.check(ACLTypes.Edit, req.aclData);
    const { result: editRequestable } = await acl.check(ACLTypes.EditRequest, req.aclData);
    defaultData.editable = editable || editRequestable;
    defaultData.edit_acl_message = edit_acl_message;

    if(!dbDocument || !rev) return res.renderSkin(undefined, {
        ...defaultData,
        contentHtml: `
<p>해당 문서를 찾을 수 없습니다.</p>
<p><a href="${globalUtils.doc_action_link(document, 'edit')}">[새 문서 만들기]</a></p>
        `.trim()
    });

    res.renderSkin(undefined, {
        ...defaultData,
        contentHtml: rev.content,
        date: rev.createdAt.getTime(),
        star_count: 0,
        starred: false,
        user: null
        // user: {
        //     uuid: 'asdf'
        // }
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
    const { result: editableNSACL } = await namespaceACL.check(ACLTypes.ACL, req.aclData);

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

    const duration = parseInt(req.body.duration);
    if(isNaN(duration)) return res.status(400).send('유효하지 않은 duration');

    let conditionContent = req.body.conditionContent;

    if(conditionType === ACLConditionTypes.Perm) {
        if(!req.body.permission) return res.status(400).send('권한 값을 입력해주세요!');
        conditionContent = req.body.permission;
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
        || actionType > (target === 'document' ? ACLActionTypes.GotoOtherNS : ACLActionTypes.Allow)) {
        return res.status(400).send(`${req.body.actionType}은 이 카테고리에 사용할 수 없습니다!`);
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

    res.redirect(req.originalUrl);
});

app.get('/action/acl/delete', async (req, res) => {
    const aclId = req.query.acl;
    if(!aclId) return res.status(400).send('ACL UUID 없음');

    const dbACL = await ACLModel.findOne({
        uuid: aclId
    });
    if(!dbACL) return res.status(400).send('ACL 찾을 수 없음');

    if(dbACL.type === ACLTypes.ACL && !req.permissions.includes('nsacl')) return res.status(403).send('이름공간 ACL 수정은 nsacl 권한이 필요합니다!');

    if(dbACL.document) {
        const dbDocument = await Document.findOne({
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

    const invalidSection = () => res.renderSkin('오류', {
        contentHtml: '섹션이 올바르지 않습니다.'
    });

    if(req.query.section && (isNaN(section) || section < 0)) return invalidSection();

    const document = utils.parseDocumentName(req.params[0]);

    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: editable, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);
    const { result: editRequestable } = await acl.check(ACLTypes.EditRequest, req.aclData);

    if(!editable && editRequestable) return res.redirect(globalUtils.doc_action_link(document, 'new_edit_request', {
        redirected: 1
    }));

    let rev;
    if(dbDocument) rev = await History.findOne({
        document: dbDocument.uuid,
        type: {
            $in: [
                HistoryTypes.Create,
                HistoryTypes.Edit,
                HistoryTypes.Delete,
                HistoryTypes.Rollback
            ]
        }
    }).sort({ rev: -1 });

    const docExists = !!rev?.content;

    // TODO: edit one section(after implement parser)

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
            content: docExists ? rev.content : ''
        }
    });
});

module.exports = app;