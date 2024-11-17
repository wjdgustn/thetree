const express = require('express');

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
    });

    let acl;
    if(dbDocument) acl = await ACL.get({ document: dbDocument.uuid }, document);
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

    const { result: readable, aclMessage: read_acl_message } = await acl.check(ACLTypes.Read, document);
    if(!readable) return res.renderSkin(undefined, {
        ...defaultData,
        date: null,
        contentHtml: `<h2>${read_acl_message}</h2>`
    });

    const { result: editable, aclMessage: edit_acl_message } = await acl.check(ACLTypes.Edit, document);
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

    let acl;
    if(dbDocument) acl = await ACL.get({ document: dbDocument.uuid }, document);
    const namespaceACL = await ACL.get({ namespace }, document);

    res.renderSkin(undefined, {
        viewName: 'acl',
        document,
        serverData: {
            acl,
            namespaceACL
        },
        contentName: 'acl'
    });
});

module.exports = app;