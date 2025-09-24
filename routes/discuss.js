const express = require('express');
const { body, validationResult } = require('express-validator');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const middleware = require('../utils/middleware');
const {
    ThreadStatusTypes,
    ThreadCommentTypes,
    ACLTypes,
    EditRequestStatusTypes,
    UserTypes,
    AuditLogTypes,
    NotificationTypes
} = require('../utils/types');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const Thread = require('../schemas/thread');
const ThreadComment = require('../schemas/threadComment');
const EditRequest = require('../schemas/editRequest');
const AuditLog = require('../schemas/auditLog');
const Vote = require('../schemas/vote');
const Notification = require('../schemas/notification');

const ACL = require('../class/acl');

const app = express.Router();

const COMMENT_LOAD_AMOUNT = 30;

const threadCommentEvent = async ({
    req,
    thread,
    document,
    dbComment,
    hideUser
} = {}) => {
    const commentUser = await User.findOne({
        uuid: dbComment.user
    });
    hideUser &&= await User.findOne({
        uuid: hideUser.uuid
    });

    const comment = await utils.threadCommentMapper(dbComment.toJSON(), {
        thread,
        toHtmlParams: {
            document,
            dbComment,
            thread: true,
            commentId: dbComment.id,
            req
        },
        user: {
            ...commentUser.publicUser,
            userCSS: await utils.getUserCSS(commentUser)
        },
        hideUser: hideUser?.publicUser
    });

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

    const acl = await ACL.get({ thread }, document);
    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return next(new Error(readAclMessage));

    socket.join(thread.uuid);

    next();
});

app.get('/discuss/?*', middleware.parseDocumentName, middleware.checkCaptcha(false, true), async (req, res) => {
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
        let threads = [];
        if(dbDocument) threads = await Thread.find({
            document: dbDocument.uuid,
            status: ThreadStatusTypes.Close,
            deleted: false
        })
            .sort({
                lastUpdatedAt: -1
            })
            .select('url topic -_id')
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
    if(req.query.state === 'closed_edit_requests') {
        let editRequests = [];
        if(dbDocument) editRequests = await EditRequest.find({
            document: dbDocument.uuid,
            status: {
                $in: [
                    EditRequestStatusTypes.Closed,
                    EditRequestStatusTypes.Locked
                ]
            }
        })
            .sort({
                lastUpdatedAt: -1
            })
            .select('url -_id')
            .lean();
        return res.renderSkin(undefined, {
            viewName: 'edit_request_close',
            contentName: 'document/closedEditRequest',
            document,
            serverData: {
                editRequests
            }
        });
    }

    let openThreads = [];
    let openEditRequests = [];
    if(dbDocument) {
        openThreads = await Thread.find({
            document: dbDocument.uuid,
            status: {
                $ne: ThreadStatusTypes.Close
            },
            deleted: false
        })
            .sort({
                lastUpdatedAt: -1
            })
            .select('uuid url topic -_id')
            .lean();

        openEditRequests = await EditRequest.find({
            document: dbDocument.uuid,
            status: EditRequestStatusTypes.Open
        })
            .sort({
                lastUpdatedAt: -1
            })
            .select('url -_id')
            .lean();
    }

    for(let thread of openThreads) {
        const acl = await ACL.get({ thread }, document);
        const { result: readable } = await acl.check(ACLTypes.Read, req.aclData);
        if(!readable) {
            thread.recentComments = [];
            continue;
        }

        let comments = await ThreadComment.find({
            thread: thread.uuid
        })
            .sort({
                id: -1
            })
            .limit(3)
            .lean();
        comments.reverse();

        if(comments[0].id !== 1) {
            const firstComment = await ThreadComment.findOne({
                thread: thread.uuid,
                id: 1
            }).lean();
            comments.unshift(firstComment);
        }

        comments = await utils.findUsers(req, comments);
        comments = await utils.findUsers(req, comments, 'hiddenBy');

        comments = await Promise.all(comments.map(c => utils.threadCommentMapper(c, {
            req,
            thread,
            toHtmlParams: {
                document,
                dbDocument,
                aclData: req.aclData,
                dbComment: c,
                thread: true,
                commentId: c.id,
                req
            }
        })));

        thread.recentComments = comments;
    }

    res.renderSkin(undefined, {
        viewName: 'thread_list',
        contentName: 'document/discuss',
        document,
        serverData: {
            openThreads,
            openEditRequests,
            permissions: {
                delete: req.permissions.includes('delete_thread')
            }
        }
    });
});

app.post('/discuss/?*', middleware.parseDocumentName,
    body('topic')
        .notEmpty({
            ignore_whitespace: true
        })
        .withMessage('topic의 값은 필수입니다.')
        .isLength({
            max: 255
        })
        .withMessage('topic의 값은 255글자 이하여야 합니다.'),
    body('text')
        .notEmpty({
            ignore_whitespace: true
        })
        .withMessage('본문의 값은 필수입니다.')
        .isLength({
            max: 65536
        })
        .withMessage('본문의 값은 65536글자 이하여야 합니다.'),
    middleware.fieldErrors,
    middleware.captcha(false, true),
    async (req, res) => {
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

    if(document.namespace === '사용자') {
        const user = await User.findOneAndUpdate({
            name: document.title
        }, {
            lastUserDocumentDiscuss: thread.lastUpdatedAt
        });
        if(user) await Notification.create({
            user: user.uuid,
            type: NotificationTypes.UserDiscuss,
            data: thread.uuid
        });
    }

    res.redirect(`/thread/${thread.url}`);
});

app.get('/thread/:url', middleware.checkCaptcha(), async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const dbDocument = await Document.findOne({
        uuid: thread.document
    });
    const document = utils.dbDocumentToDocument(dbDocument);

    const acl = await ACL.get({ thread }, document);
    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage, 403);

    const { result: writable } = await acl.check(ACLTypes.WriteThreadComment, req.aclData, true);

    const checkPerm = name => writable && req.permissions.includes(name);

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

    if(thread.pinnedComment) {
        const comment = comments.find(a => a.id === thread.pinnedComment);
        if(comment) {
            let pinnedComment = await ThreadComment.findOne({
                thread: thread.uuid,
                id: comment.id
            }).lean();
            pinnedComment = await utils.findUsers(req, pinnedComment);
            pinnedComment = await utils.findUsers(req, pinnedComment, 'hiddenBy');
            pinnedComment = await utils.threadCommentMapper(pinnedComment, {
                req,
                thread,
                toHtmlParams: {
                    document,
                    dbDocument,
                    aclData: req.aclData,
                    dbComment: pinnedComment,
                    thread: true,
                    commentId: pinnedComment.id,
                    req
                }
            });
            Object.assign(comment, pinnedComment);
        }
    }

    res.renderSkin(undefined, {
        viewName: 'thread',
        contentName: 'thread',
        document,
        comments,
        commentLoadAmount: COMMENT_LOAD_AMOUNT,
        thread: utils.onlyKeys(thread, [
            'url',
            'topic',
            'createdUser',
            'status',
            'pinnedComment'
        ]),
        permissions: {
            delete: checkPerm('delete_thread'),
            manage: checkPerm('manage_thread')
        },
        hideHiddenComments: true
        // hideHiddenComments: !req.permissions.includes('manage_thread')
    });
});

app.get('/thread/:url/acl', async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const dbDocument = await Document.findOne({
        uuid: thread.document
    });
    const document = utils.dbDocumentToDocument(dbDocument);

    const acl = await ACL.get({ thread }, document);
    const documentACL = acl.documentACL;
    const namespaceACL = acl.namespaceACL;

    const { result: editableACL } = await acl.check(ACLTypes.ACL, req.aclData);
    const editableNSACL = req.permissions.includes('nsacl');

    const aclData = acl.aclTypes.map(a => a.map(b => utils.aclStrMapper(b)));
    const docaclData = documentACL.aclTypes.map(a => a.map(b => utils.aclStrMapper(b)));
    const nsaclData = namespaceACL.aclTypes.map(a => a.map(b => utils.aclStrMapper(b)));

    res.renderSkin(undefined, {
        viewName: 'acl',
        document,
        serverData: {
            thread: {
                url: thread.url,
                topic: thread.topic
            },
            threadACL: aclData,
            acl: docaclData,
            namespaceACL: nsaclData,
            editableACL,
            editableNSACL
        },
        contentName: 'document/acl'
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

    const acl = await ACL.get({ thread }, document);
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
    comments = await utils.findUsers(req, comments);
    comments = await utils.findUsers(req, comments, 'hiddenBy');

    comments = await Promise.all(comments.map(c => utils.threadCommentMapper(c, {
        req,
        thread,
        toHtmlParams: {
            document,
            dbDocument,
            aclData: req.aclData,
            dbComment: c,
            thread: true,
            commentId: c.id,
            req
        }
    })));

    res.json(comments);
});

app.post('/thread/:url', middleware.captcha(), async (req, res) => {
    if(!req.body.text?.trim()) return res.status(400).send('본문의 값은 필수입니다.');
    if(req.body.text.length > 65536) return res.status(400).send('본문의 값은 65536글자 이하여야 합니다.');

    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    if(thread.status !== ThreadStatusTypes.Normal) return res.status(403).send('thread_invalid_status');

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ thread }, utils.dbDocumentToDocument(document));
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

    if(document.namespace === '사용자') {
        const user = await User.findOneAndUpdate({
            name: document.title
        }, {
            lastUserDocumentDiscuss: dbComment.createdAt
        });
        if(user) {
            const exists = await Notification.exists({
                user: user.uuid,
                type: NotificationTypes.UserDiscuss,
                data: thread.uuid,
                read: false
            });
            if(!exists) await Notification.create({
                user: user.uuid,
                type: NotificationTypes.UserDiscuss,
                data: thread.uuid
            });
        }
    }

    await Notification.updateMany({
        user: req.user.uuid,
        type: NotificationTypes.Mention,
        thread: thread.uuid,
        read: false
    }, {
        read: true
    });

    res.json({ captchaData: { use: utils.checkCaptchaRequired(req) } });
});

app.post('/admin/thread/:url/status', middleware.permission('manage_thread'),
    body('status')
        .isIn(Object.keys(ThreadStatusTypes))
        .withMessage('status의 값이 올바르지 않습니다.'),
    middleware.fieldErrors,
    async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ thread }, utils.dbDocumentToDocument(document));
    const { result: readable, aclMessage } = await acl.check(ACLTypes.WriteThreadComment, req.aclData);
    if(!readable) return res.error(aclMessage, 403);

    const status = ThreadStatusTypes[req.body.status];

    if(thread.status === status) return res.status(409).send(`이미 ${req.body.status.toLowerCase()} 상태입니다.`);

    await Thread.updateOne({
        uuid: thread.uuid
    }, {
        status
    });
    SocketIO.of('/thread').to(thread.uuid).emit('updateThread', { status });

    const latestComment = await ThreadComment.findOne({
        thread: thread.uuid
    })
        .sort({
            id: -1
        })
        .lean();

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

    if(status === ThreadStatusTypes.Close && document.namespace === '사용자') {
        const user = await User.findOne({
            name: document.title
        });
        if(user.lastUserDocumentDiscuss <= latestComment.createdAt) {
            await User.updateOne({
                uuid: user.uuid
            }, {
                lastUserDocumentDiscuss: null
            });
            await Notification.updateMany({
                user: user.uuid,
                type: NotificationTypes.UserDiscuss,
                data: thread.uuid,
                read: false
            }, {
                read: true
            });
        }
    }

    res.status(204).end();
});

app.post('/admin/thread/:url/topic', middleware.permission('manage_thread'),
    body('topic')
        .notEmpty({
            ignore_whitespace: true
        })
        .withMessage('topic의 값은 필수입니다.')
        .isLength({
            max: 255
        })
        .withMessage('topic의 값은 255글자 이하여야 합니다.'),
    middleware.fieldErrors,
    async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ thread }, utils.dbDocumentToDocument(document));
    const { result: readable, aclMessage } = await acl.check(ACLTypes.WriteThreadComment, req.aclData);
    if(!readable) return res.error(aclMessage, 403);

    const topic = req.body.topic;

    if(thread.topic === topic) return res.status(409).send('현재 주제와 동일합니다.');

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

app.post('/admin/thread/:url/document', middleware.permission('manage_thread'),
    body('document')
        .notEmpty({
            ignore_whitespace: true
        })
        .withMessage('document의 값은 필수입니다.')
        .isLength({
            max: 255
        })
        .withMessage('문서 이름이 올바르지 않습니다.'),
    middleware.fieldErrors,
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

    const acl = await ACL.get({ thread }, document);
    const { result: readable, aclMessage } = await acl.check(ACLTypes.WriteThreadComment, req.aclData);
    if(!readable) return res.error(aclMessage, 403);

    const targetDocument = utils.parseDocumentName(req.body.document);
    let dbTargetDocument = await Document.findOne({
        namespace: targetDocument.namespace,
        title: targetDocument.title
    });

    if(dbTargetDocument?.uuid === dbDocument.uuid) return res.status(409).send('현재 문서와 동일합니다.');

    dbTargetDocument ??= await Document.create({
        namespace: targetDocument.namespace,
        title: targetDocument.title
    });

    const targetAcl = await ACL.get({ document: dbTargetDocument });
    const { result: targetReadable, aclMessage: targetAclMessage } = await targetAcl.check(ACLTypes.WriteThreadComment, req.aclData);
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
        content: globalUtils.doc_fulltitle(targetDocument),
        prevContent: globalUtils.doc_fulltitle(document)
    });
    await threadCommentEvent({
        req,
        thread,
        document: dbTargetDocument,
        dbComment
    });

    if(document.namespace === '사용자') {
        const user = await User.findOne({
            name: document.title
        });
        if(user.lastUserDocumentDiscuss <= dbComment.createdAt) {
            await User.updateOne({
                uuid: user.uuid
            }, {
                lastUserDocumentDiscuss: null
            });
            await Notification.deleteMany({
                user: user.uuid,
                type: NotificationTypes.UserDiscuss,
                data: thread.uuid,
                read: false
            });
        }
    }
    if(dbTargetDocument.namespace === '사용자' && thread.status !== ThreadStatusTypes.Close) {
        const user = await User.findOne({
            name: dbTargetDocument.title
        });
        if(user.lastUserDocumentDiscuss <= dbComment.createdAt) {
            await User.updateOne({
                uuid: user.uuid
            }, {
                lastUserDocumentDiscuss: dbComment.createdAt
            });
            await Notification.create({
                user: user.uuid,
                type: NotificationTypes.UserDiscuss,
                data: thread.uuid
            });
        }
    }

    res.status(204).end();
});

app.post('/admin/thread/:url/delete', middleware.permission('delete_thread'), async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ thread }, utils.dbDocumentToDocument(document));
    const { result: readable, aclMessage } = await acl.check(ACLTypes.WriteThreadComment, req.aclData);
    if(!readable) return res.error(aclMessage, 403);

    await Thread.updateOne({
        uuid: thread.uuid
    }, {
        deleted: true
    });
    await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.DeleteThread,
        content: thread.uuid
    });
    SocketIO.of('/thread').to(thread.uuid).emit('updateThread', { deleted: true });

    const referer = new URL(req.get('referer'));
    if(referer.pathname.startsWith('/discuss/')) res.reload();
    else res.status(204).end();
});

app.post('/admin/thread/:url/:id/pin', middleware.permission('manage_thread'), async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ thread }, utils.dbDocumentToDocument(document));
    const { result: readable, aclMessage } = await acl.check(ACLTypes.WriteThreadComment, req.aclData);
    if(!readable) return res.error(aclMessage, 403);

    const commentId = parseInt(req.params.id);
    if(commentId === 0) {
        if(!thread.pinnedComment) return res.status(409).send('고정된 댓글이 없습니다.');
    }
    else {
        if(thread.pinnedComment === commentId) return res.status(409).send('이미 고정된 댓글입니다.');

        const comment = await ThreadComment.findOne({
            thread: thread.uuid,
            id: commentId
        });
        if(!comment) return res.status(404).send('댓글이 존재하지 않습니다.');
        if(comment.type !== ThreadCommentTypes.Default) return res.status(400).send('고정할 수 없는 댓글입니다.');

        await threadCommentEvent({
            req,
            thread,
            document,
            dbComment: comment
        });
    }

    await Thread.updateOne({
        uuid: thread.uuid
    }, {
        pinnedComment: commentId
    });

    const dbComment = await ThreadComment.create({
        thread: thread.uuid,
        user: req.user.uuid,
        admin: req.permissions.includes('admin'),
        type: commentId ? ThreadCommentTypes.PinComment : ThreadCommentTypes.UnpinComment,
        content: commentId
    });
    await threadCommentEvent({
        req,
        thread,
        document,
        dbComment
    });

    SocketIO.of('/thread').to(thread.uuid).emit('updateThread', { pinnedComment: commentId });

    res.status(204).end();
});

app.post('/admin/thread/:url/:id/:action', middleware.permission('manage_thread'), async (req, res) => {
    if(![
        'hide',
        'show'
    ].includes(req.params.action)) return res.error('잘못된 요청입니다.');
    const isHide = req.params.action === 'hide';

    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ thread }, utils.dbDocumentToDocument(document));
    const { result: readable, aclMessage } = await acl.check(ACLTypes.WriteThreadComment, req.aclData);
    if(!readable) return res.status(403).send(aclMessage);

    let dbComment = await ThreadComment.findOne({
        thread: thread.uuid,
        id: parseInt(req.params.id)
    });
    if(!dbComment) return res.status(404).send('댓글이 존재하지 않습니다.');
    if(dbComment.type !== ThreadCommentTypes.Default) return res.status(400).send('숨길 수 없는 댓글입니다.');
    if(isHide && dbComment.hidden) return res.status(409).send('이미 숨겨진 댓글입니다.');
    if(!isHide && !dbComment.hidden) return res.status(409).send('숨겨지지 않은 댓글입니다.');

    dbComment = await ThreadComment.findOneAndUpdate({
        uuid: dbComment.uuid
    }, {
        hidden: isHide,
        hiddenBy: req.user.uuid
    }, {
        new: true
    });
    await threadCommentEvent({
        req,
        thread,
        document,
        dbComment,
        hideUser: req.user
    });

    res.status(204).end();
});

app.get('/thread/:url/:id/raw', middleware.referer('/thread'), async (req, res) => {
    const thread = await Thread.findOne({
        url: req.params.url,
        deleted: false
    });
    if(!thread) return res.error('토론이 존재하지 않습니다.', 404);

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ thread }, utils.dbDocumentToDocument(document));
    const { result: readable, aclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.status(403).send(aclMessage);

    const dbComment = await ThreadComment.findOne({
        thread: thread.uuid,
        id: parseInt(req.params.id)
    });
    if(!dbComment) return res.status(404).send('댓글이 존재하지 않습니다.');
    if(dbComment.hidden
        && !req.permissions.includes('manage_thread'))
        return res.status(403).send('권한이 부족합니다.');
    if(dbComment.type !== ThreadCommentTypes.Default) return res.status(400).send('원문을 볼 수 없는 댓글입니다.');

    res.send(dbComment.content);
});

app.post('/vote/:commentId/:voteIndex', async (req, res) => {
    const comment = await ThreadComment.findOne({
        uuid: req.params.commentId
    });
    if(!comment) return res.error('댓글이 존재하지 않습니다.', 404);

    const thread = await Thread.findOne({
        uuid: comment.thread,
        deleted: false
    });
    if(!thread) return res.error('댓글이 존재하지 않습니다.', 404);

    if(thread.status !== ThreadStatusTypes.Normal) return res.status(403).send('thread_invalid_status');

    const document = await Document.findOne({
        uuid: thread.document
    });

    const acl = await ACL.get({ thread }, utils.dbDocumentToDocument(document));
    const { result: readable, aclMessage } = await acl.check(ACLTypes.WriteThreadComment, req.aclData);
    if(!readable) return res.status(403).send(aclMessage);

    const baseData = {
        comment: comment.uuid,
        voteIndex: parseInt(req.params.voteIndex),
        user: req.user.uuid
    }
    await Vote.deleteMany(baseData);
    try {
        await Vote.create({
            ...baseData,
            value: parseInt(req.body[`vote-${req.params.voteIndex}`])
        });
    } catch(e) {
        return res.status(403).send('유효성 검사에 실패했습니다.');
    }

    await threadCommentEvent({
        req,
        thread,
        document,
        dbComment: comment
    });
    res.status(204).end();
});

module.exports = app;