const express = require('express');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const multer = require('multer');
const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const {
    HistoryTypes,
    ACLTypes
} = require('../utils/types');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const BlockHistory = require('../schemas/blockHistory');
const ACLGroup = require('../schemas/aclGroup');

const ACL = require('../class/acl');

const app = express.Router();

app.get('/RecentChanges', async (req, res) => {
    const logType = {
        create: HistoryTypes.Create,
        delete: HistoryTypes.Delete,
        move: HistoryTypes.Move,
        revert: HistoryTypes.Revert
    }[req.query.logtype];

    let revs = await History.find({
        ...(logType != null ? { type: logType } : {})
    })
        .sort({ _id: -1 })
        .limit(100)
        .lean();

    revs = await utils.findUsers(revs);
    revs = await utils.findDocuments(revs);

    const logTypeText = logType != null ? req.query.logtype : 'all';
    if(logTypeText === 'all') revs = revs.filter(a => a.document.namespace !== '사용자');

    res.renderSkin('최근 변경내역', {
        contentName: 'recentChanges',
        serverData: {
            revs,
            logType: logTypeText
        }
    });
});

let sidebarCache = [];
let lastSidebarUpdate = 0;
app.get('/sidebar.json', async (req, res) => {
    if(Date.now() - lastSidebarUpdate > 1000 * 10) {
        const documents = await Document.find({
            namespace: '문서'
        })
            .sort({ updatedAt: -1 })
            .limit(15);

        let newSidebar = [];
        for(let doc of documents) {
            const latestRev = await History.findOne({
                document: doc.uuid
            }).sort({ rev: -1 });
            if(!latestRev) continue;

            newSidebar.push({
                document: globalUtils.doc_fulltitle(utils.dbDocumentToDocument(doc)),
                status: latestRev.type === HistoryTypes.Delete ? 'delete' : 'normal',
                date: Math.floor(doc.updatedAt / 1000)
            });
        }

        sidebarCache = newSidebar;
        lastSidebarUpdate = Date.now();
    }

    return res.json(sidebarCache);
});

let commitId;
let skinCommitId = {};
let openSourceLicense;
app.get('/License', (req, res) => {
    let skin = req.user?.skin;
    if(!skin || skin === 'default') skin = config.default_skin;

    commitId ??= execSync('git rev-parse HEAD').toString().trim().slice(0, 7);
    skinCommitId[skin] ??= execSync('git rev-parse HEAD', {
        cwd: `./skins/${skin}`
    }).toString().trim().slice(0, 7);

    openSourceLicense ??= fs.readFileSync('./OPEN_SOURCE_LICENSE.txt').toString();

    res.renderSkin('라이선스', {
        viewName: 'license',
        contentName: 'license',
        serverData: {
            commitId,
            skinCommitId: skinCommitId[skin],
            openSourceLicense
        }
    });
});

const getImageDropdowns = async () => {
    const licenses = await Document.find({
        isFileLicense: true,
        contentExists: true
    })
        .sort({ _id: 1 })
        .select('title')
        .lean();

    const catgories = await Document.find({
        isFileCategory: true,
        contentExists: true
    })
        .sort({ title: 1 })
        .select('title')
        .lean();

    return {
        licenses: licenses.map(doc => doc.title.slice('이미지 라이선스/'.length)),
        categories: catgories.map(doc => doc.title.slice('파일/'.length))
    }
}

app.get('/Upload', async (req, res) => {
    const {
        licenses,
        categories
    } = await getImageDropdowns();

    res.renderSkin('파일 올리기', {
        contentName: 'upload',
        serverData: {
            licenses,
            categories
        }
    });
});

const uploadFile = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 1024 * 1024 * 10
    }
}).single('file');
app.post('/Upload', uploadFile,
    body('document')
        .notEmpty()
        .withMessage('문서 제목을 입력해주세요.')
        .isLength({ max: 200 })
        .withMessage('document의 값은 200글자 이하여야 합니다.')
        .custom(value => value.startsWith('파일:'))
        .withMessage('업로드는 파일 이름 공간에서만 가능합니다.'),
    body('license')
        .notEmpty()
        .withMessage('라이선스를 선택해주세요.'),
    body('category')
        .notEmpty()
        .withMessage('카테고리를 선택해주세요.'),
    body('log')
        .isLength({ max: 200 })
        .withMessage('요약의 값은 255글자 이하여야 합니다.'),
    async (req, res) => {
    const result = validationResult(req);
    if(!result.isEmpty()) return res.status(400).send({
        fieldErrors: result.mapped()
    });

    if(!req.file) return res.status(400).send('파일이 업로드되지 않았습니다.');
    if(![
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/svg+xml',
        'image/ico'
    ].includes(req.file.mimetype)) return res.status(400).send('올바르지 않은 파일입니다.');

    const {
        licenses,
        categories
    } = await getImageDropdowns();

    if(!licenses.includes(req.body.license)) return res.status(400).send('잘못된 라이선스입니다.');
    if(!categories.includes(req.body.category)) return res.status(400).send('잘못된 분류입니다.');

    const document = utils.parseDocumentName(req.body.document);
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
    if(rev?.content != null) return res.status(409).send('문서가 이미 존재합니다.');

    let fileWidth = 0;
    let fileHeight = 0;
    try {
        const metadata = await sharp(req.file.buffer).metadata();
        fileWidth = metadata.width;
        fileHeight = metadata.height;
    } catch(e) {}

    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const { ext } = path.parse(req.file.originalname);
    const Key = 'i/' + hash + ext;

    const checkExists = await History.findOne({
        fileKey: Key
    });
    if(checkExists) {
        const dupDoc = await Document.findOne({
            uuid: checkExists.document
        });
        const latest = await History.findOne({
            document: checkExists.document
        });

        if(latest.uuid === checkExists.uuid) {
            const doc = utils.dbDocumentToDocument(dupDoc);
            return res.status(409).send(`이미 업로드된 파일입니다.<br>중복 파일: <a href="${globalUtils.doc_action_link(doc, 'w')}">${globalUtils.doc_fulltitle(doc)}</a>`);
        }
    }

    try {
        await S3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        }));
    } catch(e) {
        console.error(e);
        return res.status(500).send((debug || req.permissions.includes('developer'))
            ? e.toString()
            : '파일 업로드 중 오류가 발생했습니다.');
    }

    const content = [
        `[include(틀:이미지 라이선스/${req.body.license})]`,
        `[[분류:파일/${req.body.category}]]`,
        req.body.text
    ].join('\n');

    await History.create({
        user: req.user.uuid,
        type: HistoryTypes.Create,
        document: dbDocument.uuid,
        content,
        fileKey: Key,
        fileSize: req.file.size,
        fileWidth,
        fileHeight,
        log: req.body.log || `파일 ${Buffer.from(req.file.originalname, 'latin1').toString('utf-8')}을 올림`
    });

    res.redirect(globalUtils.doc_action_link(document, 'w'));
});

app.get('/BlockHistory', async (req, res) => {
    const baseQuery = {};

    const query = req.query.query;
    if(query) {
        if(req.query.target === 'author') {
            if(query.includes('-')) baseQuery.createdUser = query;
            else {
                const checkUser = await User.findOne({
                    name: query
                });
                if(checkUser) baseQuery.createdUser = checkUser.uuid;
            }
        }
        else {
            const regex = {
                $regex: new RegExp(utils.escapeRegExp(query), 'i')
            };
            baseQuery.$or = [
                { targetUser: query },
                { targetUsername: query },
                { targetContent: regex },
                { content: regex }
            ]
        }
    }

    const findQuery = { ...baseQuery };

    const pageQuery = req.query.until || req.query.from;
    if(pageQuery) {
        const log = await BlockHistory.findOne({
            uuid: pageQuery
        });
        if(log) {
            if(req.query.until) findQuery._id = { $gte: log._id };
            else findQuery._id = { $lte: log._id };
        }
    }

    let logs = await BlockHistory.find(findQuery)
        .sort({ _id: findQuery._id?.$gte ? 1 : -1 })
        .limit(100)
        .lean();

    if(findQuery._id?.$gte) logs.reverse();

    let prevItem;
    let nextItem;
    if(logs.length) {
        prevItem = await BlockHistory.findOne({
            ...baseQuery,
            _id: { $gt: logs[0]._id }
        }).sort({ _id: 1 });
        nextItem = await BlockHistory.findOne({
            ...baseQuery,
            _id: { $lt: logs[logs.length - 1]._id }
        }).sort({ _id: -1 });

        logs = await utils.findUsers(logs, 'createdUser', true);
        logs = await utils.findUsers(logs, 'targetUser', true);

        const aclGroups = await ACLGroup.find();
        for(let log of logs) {
            if(log.aclGroup) {
                const foundGroup = aclGroups.find(a => a.uuid === log.aclGroup);
                if(foundGroup) log.aclGroup = foundGroup;
            }
        }
    }

    res.renderSkin('차단 내역', {
        contentName: 'blockHistory',
        serverData: {
            logs,
            prevItem,
            nextItem
        }
    });
});

app.get('/RandomPage', async (req, res) => {
    const namespace = config.namespaces.includes(req.query.namespace) ? req.query.namespace : '문서';
    const docs = await Document.aggregate([
        { $match: { namespace } },
        { $sample: { size: 20 } }
    ]);

    res.renderSkin('RandomPage', {
        contentName: 'randomPage',
        serverData: {
            docs: docs.map(a => utils.dbDocumentToDocument(a))
        }
    });
});

app.get('/random', async (req, res) => {
    const docs = await Document.aggregate([
        { $match: { namespace: '문서' } },
        { $sample: { size: 1 } }
    ]);
    const document = utils.dbDocumentToDocument(docs[0]);

    res.redirect(globalUtils.doc_action_link(document, 'w'));
});

module.exports = app;