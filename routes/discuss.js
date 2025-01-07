const express = require('express');
const { body, validationResult } = require('express-validator');

const NamumarkParser = require('../utils/namumark');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const middleware = require('../utils/middleware');
const {
    ThreadStatusTypes,
    ThreadCommentTypes,
    ACLTypes
} = require('../utils/types');

const Document = require('../schemas/document');
const Thread = require('../schemas/thread');
const ThreadComment = require('../schemas/threadComment');

const ACL = require('../class/acl');

const app = express.Router();

const COMMENT_LOAD_AMOUNT = 10;

app.get('/discuss/?*', middleware.parseDocumentName, async (req, res) => {
    const document = req.document;
    const { namespace, title } = document;
    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage, 403);

    let openThreads = [];
    if(dbDocument) {
        openThreads = await Thread.find({
            document: dbDocument.uuid,
            status: ThreadStatusTypes.Normal,
            deleted: false
        })
            .sort({
                lastUpdatedAt: -1
            })
            .lean();
    }

    res.renderSkin(undefined, {
        viewName: 'thread_list',
        contentName: 'document/discuss',
        document,
        serverData: {
            openThreads
        }
    });
});

app.post('/discuss/?*', middleware.parseDocumentName,
    body('topic')
        .notEmpty()
        .withMessage('topic의 값은 필수입니다.'),
    body('text')
        .notEmpty()
        .withMessage('본문의 값은 필수입니다.'),
    async (req, res) => {
    const result = validationResult(req);
    if(!result.isEmpty()) return res.status(400).send({
        fieldErrors: result.mapped()
    });

    const document = req.document;
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
    const { result: hasPerm, aclMessage } = await acl.check(ACLTypes.CreateThread, req.aclData);
    if(!hasPerm) return res.status(403).send(aclMessage);

    const thread = await Thread.create({
        document: dbDocument.uuid,
        topic: req.body.topic,
        createdUser: req.user.uuid,
        lastUpdateUser: req.user.uuid
    });

    await ThreadComment.create({
        thread: thread.uuid,
        user: req.user.uuid,
        admin: req.permissions.includes('admin'),
        content: req.body.text
    });

    res.redirect(`/thread/${thread.url}`);
});

app.get('/thread/:url', async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const dbDocument = await Document.findOne({
        uuid: thread.document
    });
    const document = utils.dbDocumentToDocument(dbDocument);

    const comments = await ThreadComment.find({
        thread: thread.uuid
    })
        .sort({
            id: 1
        })
        .select([
            'id',
            'hidden'
        ])
        .lean();

    res.renderSkin(undefined, {
        viewName: 'thread',
        contentName: 'thread',
        document,
        comments,
        commentLoadAmount: COMMENT_LOAD_AMOUNT,
        thread: {
            url: thread.url,
            topic: thread.topic,
            createdUser: thread.createdUser,
            status: thread.status
        },
        // comments: [
        //     {
        //         id: 1,
        //         createdAt: new Date(),
        //
        //         userHtml: utils.userHtml(req.user, {
        //             isAdmin: req.permissions.includes('admin'),
        //             note: `토론 asdf #1 긴급차단`,
        //             thread: true,
        //             threadAdmin: true
        //         }),
        //         starter: true,
        //         contentHtml: namumarkSample.html
        //     },
        //     {
        //         id: 2,
        //         hidden: true
        //     },
        //     {
        //         id: 3
        //     },
        //     {
        //         id: 4
        //     },
        //     {
        //         id: 5
        //     },
        //     {
        //         id: 6
        //     }
        // ],
        hideHiddenComments: !req.permissions.includes('hide_thread_comment')
    });
});

app.get('/thread/:url/:num', middleware.referer('/thread'), async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const dbDocument = await Document.findOne({
        uuid: thread.document
    });
    const document = utils.dbDocumentToDocument(dbDocument);

    let comments = await ThreadComment.find({
        thread: thread.uuid,
        id: {
            $gte: parseInt(req.params.num)
        }
    })
        .sort({
            id: 1
        })
        .limit(COMMENT_LOAD_AMOUNT)
        .lean();
    comments = await utils.findUsers(comments);

    const parser = new NamumarkParser({
        document,
        dbDocument,
        thread: true
    });

    for(let comment of comments) {
        comment.userHtml = utils.userHtml(comment.user, {
            isAdmin: req.permissions.includes('admin'),
            note: `토론 ${thread.url} #${comment.id} 긴급차단`,
            thread: true,
            threadAdmin: comment.admin
        });

        if(comment.type === ThreadCommentTypes.Default) {
            const { html } = await parser.parse(comment.content);
            comment.contentHtml = html;
        }
        else if(comment.type === ThreadCommentTypes.UpdateStatus) {

        }
        else if(comment.type === ThreadCommentTypes.UpdateTopic) {

        }
        else if(comment.type === ThreadCommentTypes.UpdateDocument) {

        }
    }

    res.json(comments.map(a => ({
        id: a.id,
        hidden: a.hidden,

        createdAt: a.createdAt,
        user: a.user.uuid,
        userHtml: a.userHtml,
        hideUserHtml: a.hideUserHtml,
        contentHtml: a.contentHtml
    })));
});

app.post('/thread/:url', async (req, res) => {
    if(!req.body.text) return res.status(400).send('본문의 값은 필수입니다.');

    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const comment = await ThreadComment.create({
        thread: thread.uuid,
        user: req.user.uuid,
        admin: req.permissions.includes('admin'),
        content: req.body.text
    });

    // TODO: send updated packet with comment

    res.status(204).end();
});

module.exports = app;