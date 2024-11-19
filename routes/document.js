const express = require('express');
// const { body, validationResult } = require('express-validator');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const { ACLTypes, HistoryTypes } = require('../utils/types');

const Document = require('../schemas/document');
const History = require('../schemas/history');

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
        rev: parseInt(req.query.rev) ?? undefined
    }).sort({ rev: -1 });

    let acl;
    if(dbDocument) acl = await ACL.get({ document: dbDocument }, document);
    else acl = await ACL.get({ namespace }, document);

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
    defaultData.editable = editable;
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
    const aclType = parseInt(req.body.aclType);

    if(isNaN(aclType)) return res.status(400).send('invalid aclType');

    const document = utils.parseDocumentName(req.params[0]);

    const { namespace, title } = document;

    if(target === 'document') {
        const dbDocument = await Document.findOne({
            namespace,
            title
        });

        const acl = await ACL.get({ document: dbDocument }, document);
        const { result: editable } = await acl.check(ACLTypes.ACL, req.aclData);

        if(!editable) return res.status(403).send('missing document ACL permission');
    }
    else if(target === 'namespace') {
        if(!req.permissions.includes('nsacl')) return res.status(403).send('missing namespace ACL permission');
    }
    else return res.status(400).send('invalid target');
});

module.exports = app;