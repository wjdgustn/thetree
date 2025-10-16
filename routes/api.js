const express = require('express');
const { body } = require('express-validator');

const middleware = require('../utils/middleware');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const {
    BacklinkFlags,
    ThreadStatusTypes,
    ThreadCommentTypes
} = require('../utils/types');
const {
    editAndEditRequest,
    postEditAndEditRequest,
    getBacklinks,
    getCate, getCategoryDocuments
} = require('./document');

const User = require('../schemas/user');
const EditToken = require('../schemas/editToken');
const Thread = require('../schemas/thread');
const ThreadComment = require('../schemas/threadComment');

const app = express.Router();

app.all('/api/*route', async (req, res, next) => {
    req.isAPI = true;
    res.error = (status, code = 400) => res.status(code).json({
        status
    });

    const [type, apiToken] = (req.get('Authorization') || '').split(' ');
    if(type === 'Bearer') {
        const user = await User.findOne({
            apiToken
        });
        if(user?.permissions.includes('api_access') || user?.permissions.includes('developer')) {
            req.user = user;
            await utils.makeACLData(req);
            return next();
        }
    }

    return res.json({
        status: '권한이 부족합니다.'
    })
});

const apiWrapper = fn => async (req, res, next) => {
    let finalData = null;

    const fakeRes = {
        error: res.error,
        status: code => ({
            send: status => res.status(code).json({
                status
            })
        }),
        renderSkin(title, data) {
            finalData = data;
        },
        sendData(data) {
            finalData = data;
        }
    }
    await fn(req, fakeRes);

    if(res.headersSent) return;

    req.apiData = finalData;
    next?.();
    return finalData;
}

app.get('/api/edit/{*document}', middleware.parseDocumentName, apiWrapper(editAndEditRequest), async (req, res) => {
    const baseuuid = req.apiData.body.baseuuid;
    const editToken = await EditToken.create({
        baseuuid,
        namespace: req.document.namespace,
        title: req.document.title,
        user: req.user.uuid
    });

    res.json({
        text: req.apiData.serverData.content,
        exists: baseuuid !== 'create',
        token: editToken.token
    });
});

app.post('/api/edit/{*document}',
    middleware.parseDocumentName,
    body('text')
        .exists()
        .withMessage('본문의 값은 필수입니다.'),
    body('log')
        .exists()
        .withMessage('요약의 값은 필수입니다.'),
    body('token')
        .notEmpty()
        .withMessage('token의 값은 필수입니다.'),
    middleware.singleFieldError,
    async (req, res) => {
    const token = await EditToken.findOne({
        token: req.body.token,
        namespace: req.document.namespace,
        title: req.document.title,
        user: req.user.uuid
    });
    if(!token) return res.error('invalid_token');

    req.body = {
        baseuuid: token.baseuuid,
        text: req.body.text,
        log: req.body.log,
        agree: 'Y'
    }

    const finalData = await apiWrapper(postEditAndEditRequest)(req, res);
    if(!finalData) return;

    res.json({
        status: 'success',
        rev: finalData.rev.rev
    });
});

app.get('/api/backlink/{*document}', middleware.parseDocumentName, async (req, res) => {
    if(req.document.namespace === '분류') {
        const categoriesData = await getCategoryDocuments(req, { limit: 50 });

        let selectedNamespace = req.query.namespace;
        if(!selectedNamespace || !categoriesData[selectedNamespace])
            selectedNamespace = Object.keys(categoriesData)[0];
        const selectedData = categoriesData[selectedNamespace];

        res.json({
            namespaces: Object.entries(categoriesData).map(([namespace, data]) => ({
                namespace,
                count: data.count
            })),
            backlinks: Object.values(selectedData.categoriesPerChar).flat().map(a => ({
                document: globalUtils.doc_fulltitle(a.parsedName)
            })),
            from: selectedData.nextItem ?? null,
            until: selectedData.prevItem ?? null
        });
    }
    else {
        const finalData = await apiWrapper(getBacklinks)(req, res);
        const data = finalData.serverData;
        res.json({
            namespaces: data.namespaceCounts,
            backlinks: data.backlinks.map(a => ({
                document: globalUtils.doc_fulltitle(utils.dbDocumentToDocument(a)),
                flags: a.flags.map(a => utils.getKeyFromObject(BacklinkFlags, a).toLowerCase()).join(',')
            })),
            from: data.nextItem?.title ?? null,
            until: data.prevItem?.title ?? null
        });
    }
});

if(config.testwiki) {
    app.get('/engine/notification', async (req, res) => {
        let after = parseInt(req.query.after);
        after ||= 0;

        const thread = await Thread.findOne({
            specialType: 'notification',
            status: ThreadStatusTypes.Normal,
            deleted: false
        })
            .sort({ _id: -1 })
            .lean();
        if(!thread) return res.status(404).send('Notification thread not found');

        const comments = await ThreadComment.find({
            thread: thread.uuid,
            createdAt: {
                $gt: new Date(after)
            },
            type: ThreadCommentTypes.Default,
            id: {
                $ne: 1
            },
            hidden: false
        })
            .select('content createdAt -_id')
            .lean();

        res.json(comments);
    });

    app.get('/engine/verify_developer', async (req, res) => {
        if(!req.query.text) return res.status(400).send('missing_text');

        const thread = await Thread.findOne({
            specialType: 'verification',
            status: ThreadStatusTypes.Normal,
            deleted: false
        })
            .sort({ _id: -1 })
            .lean();
        if(!thread) return res.status(404).send('Verification thread not found');

        const exists = await ThreadComment.exists({
            thread: thread.uuid,
            content: req.query.text,
            type: ThreadCommentTypes.Default,
            hidden: false
        });
        res.json({ result: !!exists });
    });
}

module.exports = app;