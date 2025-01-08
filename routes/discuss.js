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

const threadCommentMapper = ({
    req,
    thread,
    parser,
    user
} = {}) => async comment => {
    comment.userHtml = utils.userHtml(user ?? comment.user, {
        isAdmin: req?.permissions.includes('admin'),
        note: `토론 ${thread.url} #${comment.id} 긴급차단`,
        thread: true,
        threadAdmin: comment.admin
    });

    if(comment.type === ThreadCommentTypes.Default) {
        const { html } = await parser.parse(comment.content);
        comment.contentHtml = html;
    }
    else if(comment.type === ThreadCommentTypes.UpdateStatus) {
        comment.contentHtml = `스레드 상태를 <b>${utils.getKeyFromObject(ThreadStatusTypes, parseInt(comment.content)).toLowerCase()}</b>로 변경`;
    }
    else if(comment.type === ThreadCommentTypes.UpdateTopic) {
        comment.contentHtml = `스레드 주제를 <b>${comment.prevContent}</b>에서 <b>${comment.content}</b>로 변경`;
    }
    else if(comment.type === ThreadCommentTypes.UpdateDocument) {
        comment.contentHtml = `스레드를 <b>${comment.prevContent}</b>에서 <b>${comment.content}</b>로 이동`;
    }

    if(typeof comment.user === 'object')
        comment.user = comment.user.uuid;

    return utils.onlyKeys(comment, [
        'id',
        'hidden',

        'type',
        'createdAt',
        'user',
        'userHtml',
        'hideUserHtml',
        'contentHtml'
    ]);
}

const threadCommentEvent = async ({
    req,
    thread,
    document,
    dbComment
} = {}) => {
    const parser = new NamumarkParser({
        document,
        thread: true
    });

    const comment = await threadCommentMapper({
        thread,
        parser,
        user: req.user
    })(dbComment.toJSON());

    SocketIO.of('/thread').to(thread.uuid).emit('comment', comment);
}

SocketIO.of('/thread').use(async (socket, next) => {
    const req = socket.request;

    const url = socket.handshake.query.thread;
    if(!url) return next(new Error('missing thread'));

    const thread = await Thread.findOne({
        url,
        deleted: false
    });
    if(!thread) return next(new Error('thread not found'));

    const dbDocument = await Document.findOne({
        uuid: thread.document
    });
    const document = utils.dbDocumentToDocument(dbDocument);

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return next(new Error(readAclMessage));

    socket.join(thread.uuid);

    next();
});

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

    if(req.query.state === 'close') {
        const threads = await Thread.find({
            document: dbDocument.uuid,
            status: ThreadStatusTypes.Close,
            deleted: false
        })
            .sort({
                lastUpdatedAt: -1
            })
            .lean();
        return res.renderSkin(undefined, {
            viewName: 'thread_list_close',
            contentName: 'document/closedDiscuss',
            document,
            serverData: {
                threads
            }
        });
    }

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
        .notEmpty({
            ignore_whitespace: true
        })
        .withMessage('topic의 값은 필수입니다.'),
    body('text')
        .notEmpty({
            ignore_whitespace: true
        })
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

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage, 403);

    const comments = await ThreadComment.find({
        thread: thread.uuid
    })
        .sort({
            id: 1
        })
        .select([
            '-_id',
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

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage, 403);

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

    comments = await Promise.all(comments.map(threadCommentMapper({
        req,
        thread,
        parser
    })));

    res.json(comments);
});

app.post('/thread/:url', async (req, res) => {
    if(!req.body.text.trim()) return res.status(400).send('본문의 값은 필수입니다.');

    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    if(thread.status !== ThreadStatusTypes.Normal) return res.status(403).send('thread_invalid_status');

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ document });
    const { result: writable, aclMessage } = await acl.check(ACLTypes.WriteThreadComment, req.aclData);
    if(!writable) return res.status(403).send(aclMessage);

    const dbComment = await ThreadComment.create({
        thread: thread.uuid,
        user: req.user.uuid,
        admin: req.permissions.includes('admin'),
        content: req.body.text
    });
    await threadCommentEvent({
        req,
        thread,
        document,
        dbComment
    });

    res.status(204).end();
});

app.post('/admin/thread/:url/status', middleware.permission('update_thread_status'),
    body('status')
        .isIn(Object.keys(ThreadStatusTypes))
        .withMessage('status의 값이 올바르지 않습니다.'),
    async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ document });
    const { result: readable, aclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(aclMessage, 403);

    const status = ThreadStatusTypes[req.body.status];
    await Thread.updateOne({
        uuid: thread.uuid
    }, {
        status
    });
    SocketIO.of('/thread').to(thread.uuid).emit('updateThread', { status });

    const dbComment = await ThreadComment.create({
        thread: thread.uuid,
        user: req.user.uuid,
        admin: req.permissions.includes('admin'),
        type: ThreadCommentTypes.UpdateStatus,
        content: status
    });
    await threadCommentEvent({
        req,
        thread,
        document,
        dbComment
    });

    res.status(204).end();
});

app.post('/admin/thread/:url/topic', middleware.permission('update_thread_topic'),
    body('topic')
        .notEmpty({
            ignore_whitespace: true
        })
        .withMessage('topic의 값은 필수입니다.'),
    async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ document });
    const { result: readable, aclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(aclMessage, 403);

    const topic = req.body.topic;
    await Thread.updateOne({
        uuid: thread.uuid
    }, {
        topic
    });
    SocketIO.of('/thread').to(thread.uuid).emit('updateThread', { topic });

    const dbComment = await ThreadComment.create({
        thread: thread.uuid,
        user: req.user.uuid,
        admin: req.permissions.includes('admin'),
        type: ThreadCommentTypes.UpdateTopic,
        content: topic,
        prevContent: thread.topic
    });
    await threadCommentEvent({
        req,
        thread,
        document,
        dbComment
    });

    res.status(204).end();
});

app.post('/admin/thread/:url/document', middleware.permission('update_thread_document'),
    body('document')
        .notEmpty({
            ignore_whitespace: true
        })
        .withMessage('document의 값은 필수입니다.'),
    async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const dbDocument = await Document.findOne({
        uuid: thread.document
    });
    const document = utils.dbDocumentToDocument(dbDocument);

    const acl = await ACL.get({ document: dbDocument });
    const { result: readable, aclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(aclMessage, 403);

    const targetDocument = utils.parseDocumentName(req.body.document);
    let dbTargetDocument = await Document.findOne({
        namespace: targetDocument.namespace,
        title: targetDocument.title
    });

    if(!dbTargetDocument) {
        dbTargetDocument = new Document({
            namespace: targetDocument.namespace,
            title: targetDocument.title
        });
        await dbTargetDocument.save();
    }

    const targetAcl = await ACL.get({ document: dbTargetDocument });
    const { result: targetReadable, aclMessage: targetAclMessage } = await targetAcl.check(ACLTypes.Read, req.aclData);
    if(!targetReadable) return res.status(403).send(targetAclMessage);

    await Thread.updateOne({
        uuid: thread.uuid
    }, {
        document: dbTargetDocument.uuid
    });

    const dbComment = await ThreadComment.create({
        thread: thread.uuid,
        user: req.user.uuid,
        admin: req.permissions.includes('admin'),
        type: ThreadCommentTypes.UpdateDocument,
        content: globalUtils.doc_fulltitle(dbTargetDocument),
        prevContent: globalUtils.doc_fulltitle(document)
    });
    await threadCommentEvent({
        req,
        thread,
        document: dbTargetDocument,
        dbComment
    });

    res.status(204).end();
});

module.exports = app;