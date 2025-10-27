const express = require('express');
const { body } = require('express-validator');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const multer = require('multer');
const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const middleware = require('../utils/middleware');
const {
    HistoryTypes,
    ACLTypes,
    ThreadStatusTypes,
    EditRequestStatusTypes
} = require('../utils/types');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const BlockHistory = require('../schemas/blockHistory');
const ACLGroup = require('../schemas/aclGroup');
const Thread = require('../schemas/thread');
const EditRequest = require('../schemas/editRequest');

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
        ...(logType != null ? { type: logType } : {}),
        api: false
    })
        .sort({ _id: -1 })
        .limit(100)
        .select('type document rev revertRev uuid user createdAt log moveOldDoc moveNewDoc hideLog diffLength api -_id')
        .lean();

    revs = await utils.findUsers(req, revs);
    revs = await utils.findDocuments(revs);

    const logTypeText = logType != null ? req.query.logtype : 'all';
    if(logTypeText === 'all'
        && (!req.permissions.includes('admin') || req.query.userDoc !== '1')) revs = revs.filter(a => !['사용자', '삭제된사용자'].includes(a.document.parsedName.namespace));

    for(let rev of revs) {
        if(rev.troll || (rev.hideLog && !req.permissions.includes('hide_document_history_log')))
            delete rev.log;
    }

    res.renderSkin('최근 변경내역', {
        contentName: 'special/recentChanges',
        serverData: {
            revs: revs.map(a => utils.addHistoryData(req, a, req.permissions.includes('admin'), null)),
            logType: logTypeText
        }
    });
});

app.get('/RecentDiscuss', async (req, res) => {
    let threads = [];
    let editRequests = [];

    const logType = req.query.logtype || 'normal_thread';

    const isThread = logType.endsWith('_thread');

    if(isThread) {
        const query = {
            status: ThreadStatusTypes.Normal,
            deleted: false,
            ...(req.permissions.includes('developer') ? {} : {
                $or: [
                    {
                        specialType: {
                            $exists: false
                        }
                    },
                    {
                        specialType: 'notification'
                    }
                ]
            })
        };
        const sort = {
            lastUpdatedAt: -1
        };

        if(logType === 'old_thread')
            sort.lastUpdatedAt = 1;
        else if(logType === 'pause_thread')
            query.status = ThreadStatusTypes.Pause;
        else if(logType === 'closed_thread')
            query.status = ThreadStatusTypes.Close;

        threads = await Thread.find(query)
            .sort(sort)
            .limit(100)
            .select('url topic document lastUpdateUser lastUpdatedAt -_id')
            .lean();
    }
    else {
        const query = {
            status: EditRequestStatusTypes.Open
        };
        const sort = {
            lastUpdatedAt: -1
        };

        if(logType === 'old_editrequest')
            sort.lastUpdatedAt = 1;
        else if(logType === 'accepted_editrequest')
            query.status = EditRequestStatusTypes.Accepted;
        else if(logType === 'closed_editrequest')
            query.status = { $in: [EditRequestStatusTypes.Closed, EditRequestStatusTypes.Locked] };

        editRequests = await EditRequest.find(query)
            .sort(sort)
            .limit(100)
            .select('url document status lastUpdatedAt diffLength createdUser -_id')
            .lean();
    }

    threads = await utils.findUsers(req, threads, 'lastUpdateUser');
    threads = await utils.findDocuments(threads);

    editRequests = await utils.findUsers(req, editRequests, 'createdUser');
    editRequests = await utils.findUsers(req, editRequests, 'lastUpdateUser');
    editRequests = await utils.findDocuments(editRequests);

    res.renderSkin('최근 토론', {
        contentName: 'special/recentDiscuss',
        serverData: {
            threads,
            editRequests,
            logType
        }
    });
});

let sidebarCache = [];
let discussSidebarCache = [];
let lastSidebarUpdate = 0;

const updateSidebar = async () => {
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

        const threads = await Thread.find({
            status: ThreadStatusTypes.Normal,
            deleted: false
        })
            .sort({
                lastUpdatedAt: -1
            })
            .limit(15);

        let newDiscussSidebar = [];
        for(let thread of threads) {
            const doc = await Document.findOne({
                uuid: thread.document
            });

            newDiscussSidebar.push({
                url: thread.url,
                topic: thread.topic,
                document: globalUtils.doc_fulltitle(utils.dbDocumentToDocument(doc)),
                date: Math.floor(thread.lastUpdatedAt / 1000)
            });
        }

        sidebarCache = newSidebar;
        discussSidebarCache = newDiscussSidebar;
        lastSidebarUpdate = Date.now();
    }
}

app.get('/sidebar.json', async (req, res) => {
    await updateSidebar();
    return res.json(sidebarCache);
});

app.get('/sidebar', middleware.internal, async (req, res) => {
    await updateSidebar();
    return res.json({
        document: sidebarCache,
        discuss: discussSidebarCache
    });
});

let openSourceLicense;
app.get('/License', (req, res) => {
    let skin = req.user?.skin;
    if(!skin || skin === 'default') skin = config.default_skin;

    openSourceLicense ??= fs.readFileSync('./OPEN_SOURCE_LICENSE.txt').toString();

    res.renderSkin('라이선스', {
        viewName: 'license',
        contentName: 'special/license',
        serverData: {
            version: global.versionInfo.versionData.version,
            branch: global.versionInfo.branch !== 'master' ? global.versionInfo.branch : undefined,
            commitDate: global.versionInfo.commitDate,
            commitId: global.versionInfo.commitId.slice(0, 7),
            openSourceLicense
        }
    });
});

const getImageDropdowns = async () => {
    const licenses = await Document.find({
        isFileLicense: true,
        contentExists: true
    })
        .sort({ title: 1 })
        .select('title')
        .lean();
    const mappedLicenses = licenses.map(doc => doc.title.slice('이미지 라이선스/'.length));

    const catgories = await Document.find({
        isFileCategory: true,
        contentExists: true
    })
        .sort({ title: 1 })
        .select('title')
        .lean();

    return {
        licenses: [
            ...(config.file_top_license ?? []).filter(a => mappedLicenses.includes(a)),
            ...mappedLicenses.filter(a => !config.file_top_license || !config.file_top_license.includes(a))
        ],
        categories: catgories.map(doc => doc.title.slice('파일/'.length))
    }
}

app.get('/Upload', async (req, res) => {
    const {
        licenses,
        categories
    } = await getImageDropdowns();

    let file_upload_template = config.file_upload_template ?? '';
    if(!file_upload_template && config.upload_help_document) {
        const helpDocName = utils.parseDocumentName(config.upload_help_document);
        const helpDoc = await Document.findOne({
            namespace: helpDocName.namespace,
            title: helpDocName.title
        });
        if(helpDoc?.contentExists) {
            const helpRev = await History.findOne({
                document: helpDoc.uuid
            }).sort({ rev: -1 });
            if(helpRev?.content) file_upload_template = helpRev.content;
        }
    }

    let defaultLicense = config.file_default_license;
    const imageLicensePrefix = '틀:이미지 라이선스/';
    if(defaultLicense?.startsWith(imageLicensePrefix))
        defaultLicense = defaultLicense.slice(imageLicensePrefix.length);

    res.renderSkin('파일 올리기', {
        contentName: 'special/upload',
        serverData: {
            licenses,
            defaultLicense,
            categories,
            file_upload_template,
            licenseText: config.file_license_text,
            editagree_text: config[`namespace.파일.editagree_text`] || config.editagree_text
        }
    });
});

const uploadFile = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 1024 * 1024 * (config.max_file_size || 10)
    }
}).array('file', 10);
app.post('/Upload', (req, res, next) => {
        uploadFile(req, res, err => {
            if(err instanceof multer.MulterError)
                return res.status(400).send(err.message);
            else if(err)
                return next(err);

            next();
        });
    },
    body('document')
        .if((value, { req }) => req.files.length === 1)
        .notEmpty()
        .withMessage('문서 제목을 입력해주세요.')
        .isLength({ max: 200 })
        .withMessage('document의 값은 200글자 이하여야 합니다.')
        .custom((value, { req }) => {
            req.document = utils.parseDocumentName(value);
            return req.document.namespace.includes('파일');
        })
        .withMessage('업로드는 파일 이름공간에서만 가능합니다.'),
    body('license')
        .notEmpty()
        .withMessage('라이선스를 선택해주세요.'),
    body('category')
        .notEmpty()
        .withMessage('카테고리를 선택해주세요.'),
    body('log')
        .isLength({ max: 255 })
        .withMessage('요약의 값은 255글자 이하여야 합니다.'),
    middleware.fieldErrors,
    async (req, res) => {
    if(!req.files.length) return res.status(400).send('파일이 업로드되지 않았습니다.');

    for(let file of req.files) {
        if(![
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/bmp',
            'image/svg+xml',
            'image/ico'
        ].includes(file.mimetype)) return res.status(400).send(
            '올바르지 않은 파일입니다.'
            + (req.permissions.includes('developer') ? ` (${file.mimetype})` : '')
        );
    }

    const {
        licenses,
        categories
    } = await getImageDropdowns();

    if(!licenses.includes(req.body.license)) return res.status(400).send('잘못된 라이선스입니다.');
    if(!categories.includes(req.body.category)) return res.status(400).send('잘못된 분류입니다.');

    for(let file of req.files) {
        const { ext } = path.parse(file.originalname);
        const document = req.document ?? utils.parseDocumentName(`파일:${file.originalname}`);
        const { namespace, title } = document;

        const possibleExts = [];
        if(file.mimetype === 'image/jpeg')
            possibleExts.push('jpg', 'jpeg');
        else possibleExts.push(file.mimetype.replace('image/', '').match(/[a-z]*/i)[0]);

        if(!possibleExts.some(a => title.endsWith('.' + a)))
            return res.status(400).send(`문서 이름과 확장자가 맞지 않습니다. (파일 확장자: ${possibleExts[0]})`);

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

        let metadata;
        let buffer = file.buffer;
        let fileWidth = 0;
        let fileHeight = 0;
        try {
            metadata = await sharp(buffer).metadata();
            if(!metadata) return res.status(400).send('올바르지 않은 파일입니다.');
            fileWidth = metadata.width;
            fileHeight = metadata.height;
        } catch(e) {}

        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        const Key = 'i/' + hash + ext;

        const checkExists = await History.findOne({
            fileKey: Key
        });
        if(checkExists) {
            const dupDoc = await Document.findOne({
                uuid: checkExists.document
            });
            let latestRev;
            if(dupDoc.contentExists) latestRev = await History.findOne({
                document: dupDoc.uuid
            }).sort({ rev: -1 });

            if(latestRev?.fileKey === Key) {
                const doc = utils.dbDocumentToDocument(dupDoc);
                return res.status(409).send(`이미 업로드된 파일입니다.<br>중복 파일: <a href="${globalUtils.doc_action_link(doc, 'w')}">${globalUtils.doc_fulltitle(doc)}</a>`);
            }
        }

        if(metadata.format === 'svg') {
            const svgCode = buffer.toString();
            const window = new JSDOM('').window;
            const DOMPurify = createDOMPurify(window);
            DOMPurify.addHook('afterSanitizeAttributes', node => {
                const href = node.getAttribute('xlink:href') || node.getAttribute('href');
                if(href && !href.startsWith('#')) {
                    node.removeAttribute('xlink:href');
                    node.removeAttribute('href');
                }
            });
            const clean = DOMPurify.sanitize(svgCode, {
                USE_PROFILES: {
                    svg: true
                },
                ADD_TAGS: ['use']
            });
            buffer = Buffer.from(clean);
        }

        if(!checkExists) try {
            await S3.send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key,
                Body: buffer,
                ContentType: file.mimetype
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
            sessionId: req.session.sessionId,
            type: HistoryTypes.Create,
            document: dbDocument.uuid,
            content,
            fileKey: Key,
            fileSize: file.size,
            fileWidth,
            fileHeight,
            log: req.body.log || `파일 ${Buffer.from(file.originalname, 'latin1').toString('utf-8')}을 올림`
        });
    }

    if(req.files.length === 1) res.redirect(globalUtils.doc_action_link(req.document, 'w'));
    else res.renderSkin('파일 업로드', {
        contentHtml: `${req.files.length}개의 파일을 업로드했습니다.`
    });
});

app.get('/BlockHistory', async (req, res) => {
    const typeNum = parseInt(req.query.type);
    const baseQuery = {
        ...(isNaN(typeNum) ? {} : {
            type: typeNum
        })
    }

    if(!req.permissions.includes('developer') || req.query.showHidden !== '1')
        baseQuery.hideLog = {
            $ne: true
        }

    const query = req.query.query;
    if(query) {
        if(req.query.target === 'author') {
            if(query.includes('-')) baseQuery.createdUser = query;
            else {
                const checkUser = await User.findOne({
                    $or: [
                        {
                            name: query
                        },
                        {
                            ip: query
                        }
                    ]
                });
                baseQuery.createdUser = checkUser?.uuid;
            }
        }
        else {
            const regex = {
                $regex: new RegExp(utils.escapeRegExp(query), 'i')
            };
            const exactRegex = {
                $regex: new RegExp(`^${utils.escapeRegExp(query)}$`, 'i')
            }
            baseQuery.$or = [
                { targetUser: query },
                { targetUsername: exactRegex },
                { targetContent: regex },
                { content: regex },
                { aclGroupName: regex },
                ...(isNaN(query) ? [] : [{ aclGroupId: query }])
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
        })
            .select('uuid -_id')
            .sort({ _id: 1 });
        nextItem = await BlockHistory.findOne({
            ...baseQuery,
            _id: { $lt: logs[logs.length - 1]._id }
        })
            .select('uuid -_id')
            .sort({ _id: -1 });

        logs = await utils.findUsers(req, logs, 'createdUser', { noCSS: true });
        logs = await utils.findUsers(req, logs, 'targetUser', { noCSS: true });

        const aclGroups = await ACLGroup.find()
            .select('name uuid -_id');
        for(let log of logs) {
            if(log.aclGroup) {
                const foundGroup = aclGroups.find(a => a.uuid === log.aclGroup);
                if(foundGroup) log.aclGroup = foundGroup;
            }
        }
    }

    res.renderSkin('차단 내역', {
        contentName: 'special/blockHistory',
        serverData: {
            logs: utils.withoutKeys(logs, ['_id', '__v']),
            prevItem,
            nextItem,
            permissions: {
                dev: req.permissions.includes('developer')
            }
        }
    });
});

app.get('/RandomPage', async (req, res) => {
    const namespace = config.namespaces.includes(req.query.namespace) ? req.query.namespace : '문서';
    const dbDocs = await Document.aggregate([
        {
            $match: {
                namespace,
                contentExists: true
            }
        },
        { $sample: { size: 20 } }
    ]);
    const docs = dbDocs.map(a => utils.dbDocumentToDocument(a));

    const acl = await ACL.get({
        namespace
    });
    const { result: readable } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) docs.length = 0;

    res.renderSkin('RandomPage', {
        contentName: 'special/randomPage',
        serverData: {
            docs,
            namespaces: config.namespaces
        }
    });
});

app.get('/random', async (req, res) => {
    const docs = await Document.aggregate([
        {
            $match: {
                namespace: '문서',
                contentExists: true
            }
        },
        { $sample: { size: 1 } }
    ]);
    if(!docs.length) return res.status(404).send('문서가 없습니다.');
    const document = utils.dbDocumentToDocument(docs[0]);

    res.redirect(globalUtils.doc_action_link(document, 'w'));
});

app.get('/opensearch.xml', (req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.send(`
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/" xmlns:moz="http://www.mozilla.org/2006/browser/search/">
  <ShortName>${config.site_name}</ShortName>
  <Description>${config.site_name}</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="16" height="16">${new URL('/favicon.ico', config.base_url)}</Image>
  <Url type="text/html" method="GET" template="${new URL(`/Go?q={searchTerms}`, config.base_url)}"/>
  <moz:SearchForm>${new URL('/', config.base_url)}</moz:SearchForm>
</OpenSearchDescription>
    `.trim());
});

app.get('/ip', (req, res) => {
    res.send(req.ip);
});

module.exports = app;