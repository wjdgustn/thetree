const express = require('express');
const { body } = require('express-validator');

const middleware = require('../utils/middleware');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const {
    BacklinkFlags
} = require('../utils/types');
const {
    editAndEditRequest,
    postEditAndEditRequest,
    getBacklinks
} = require('./document');

const User = require('../schemas/user');
const EditToken = require('../schemas/editToken');
const Document = require('../schemas/document');

const app = express.Router();

app.all('/api/*', async (req, res, next) => {
    req.isAPI = true;
    res.error = (status, code = 400) => res.status(code).json({
        status
    });

    const [type, apiToken] = (req.get('Authorization') || '').split(' ');
    if(type === 'Bearer') {
        const user = await User.findOne({
            apiToken
        });
        if(user?.permissions.includes('api_access')) {
            req.user = user;
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

app.get('/api/edit/?*', middleware.parseDocumentName, apiWrapper(editAndEditRequest), async (req, res) => {
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

app.post('/api/edit/?*',
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

app.get('/api/backlink/?*', middleware.parseDocumentName, async (req, res) => {
    if(req.document.namespace === '분류' && false) {

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
            to: data.prevItem?.title,
            from: data.nextItem?.title
        });
    }
});
module.exports = app;