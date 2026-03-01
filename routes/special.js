const express = require('express');
const { body } = require('express-validator');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const ffmpeg = require('fluent-ffmpeg');
const stream = require('stream');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const middleware = require('../utils/middleware');
const {
    HistoryTypes,
    ACLTypes,
    ThreadStatusTypes,
    EditRequestStatusTypes,
    BacklinkFlags
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

    const logTypeText = logType != null ? req.query.logtype : 'all';
    const showAll = req.query.showAll === '1';

    const blacklistedNamespaces = [];
    if(!req.permissions.includes('config'))
        blacklistedNamespaces.push(...(config.hidden_namespaces ?? []));

    if(logTypeText === 'all' && (!req.permissions.includes('admin') || !showAll))
        blacklistedNamespaces.push('사용자', '삭제된사용자');

    let revs = await History.find({
        ...(logType != null ? { type: logType } : {}),
        ...(showAll ? {} : {
            api: false,
        }),
        ...(blacklistedNamespaces.length ? {
            namespace: {
                $nin: blacklistedNamespaces
            }
        } : {})
    })
        .sort({ _id: -1 })
        .limit(100)
        .select('type document rev revertRev uuid user createdAt log moveOldDoc moveNewDoc hideLog diffLength api -_id')
        .lean();

    revs = await utils.findUsers(req, revs);
    revs = await utils.findDocuments(revs);

    for(let rev of revs) {
        if(rev.troll || (rev.hideLog && !req.permissions.includes('hide_document_history_log')))
            delete rev.log;
    }

    res.renderSkin('recent_changes', {
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

    res.renderSkin('recent_discuss', {
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
    if(Date.now() - lastSidebarUpdate > 1000 * 5) {
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

    res.renderSkin('license', {
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
        $or: [
            {
                isFileLicense: true
            },
            ...(config.lang && i18next.exists('special_document_name.file_license', { lng: config.lang }) ? [{
                namespace: '틀',
                title: {
                    $regex: new RegExp('^' + i18next.t('special_document_name.file_license', { lng: config.lang }) + '\\/.+')
                }
            }] : [])
        ],
        contentExists: true
    })
        .sort({ title: 1 })
        .select('title')
        .lean();
    const mappedLicenses = licenses.map(doc => doc.title.slice(doc.title.indexOf('/') + 1));

    const categories = await Document.find({
        $or: [
            {
                isFileCategory: true
            },
            ...(config.lang && i18next.exists('special_document_name.file_category', { lng: config.lang }) ? [{
                namespace: '분류',
                title: {
                    $regex: new RegExp('^' + i18next.t('special_document_name.file_category', { lng: config.lang }) + '\\/.+')
                }
            }] : [])
        ],
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
        categories: categories.map(doc => doc.title.slice(doc.title.indexOf('/') + 1))
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
    const parsedDefaultLicense = utils.parseDocumentName(defaultLicense);
    if(parsedDefaultLicense.namespace === '틀')
        defaultLicense = defaultLicense.slice(defaultLicense.indexOf('/') + 1);

    res.renderSkin('upload', {
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

app.post('/Upload', (req, res, next) => {
        const uploadFile = multer({
            storage: multer.memoryStorage(),
            ...(req.permissions.includes('developer') ? {} : {
                limits: {
                    fileSize: 1024 * 1024 * (config.max_file_size || 10)
                }
            })
        }).array('file', 10);

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
        .withMessage('routes.special.errors.document_required')
        .isLength({ max: 200 })
        .withMessage('routes.special.errors.document_max_length')
        .custom((value, { req }) => {
            req.document = utils.parseDocumentName(value);
            return req.document.namespace.includes('파일');
        })
        .withMessage('routes.special.errors.document_file_namespace_only'),
    body('license')
        .notEmpty()
        .withMessage('routes.special.errors.license_required'),
    body('category')
        .notEmpty()
        .withMessage('routes.special.errors.category_required'),
    body('log')
        .isLength({ max: 255 })
        .withMessage('routes.special.errors.log_max_length'),
    middleware.fieldErrors,
    async (req, res) => {
    if(!req.files.length) return res.status(400).send('routes.special.errors.file_required');

    for(let file of req.files) {
        if(![
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/bmp',
            'image/svg+xml',
            'image/ico',
            'video/mp4',
            'video/x-matroska',
            'video/quicktime',
            'video/x-msvideo'
        ].includes(file.mimetype)) return res.status(400).send(
            req.t('routes.special.errors.invalid_file_type')
            + (req.permissions.includes('developer') ? ` (${file.mimetype})` : '')
        );
    }

    const {
        licenses,
        categories
    } = await getImageDropdowns();

    if(!licenses.includes(req.body.license)) return res.status(400).send('invalid_license');
    if(!categories.includes(req.body.category)) return res.status(400).send('invalid_category');

    for(let file of req.files) {
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf-8');
        const { ext } = path.parse(originalName);
        const document = req.document ?? utils.parseDocumentName(`파일:${originalName}`);
        const { namespace, title } = document;

        const possibleExts = [...({
            'image/jpeg': ['jpg', 'jpeg'],
            'video/x-matroska': ['mkv'],
            'video/quicktime': ['mov'],
            'video/x-msvideo': ['avi']
        }[file.mimetype] ?? [])];
        if(!possibleExts.length) possibleExts.push(file.mimetype.split('/')[1].match(/[a-z0-9]*/i)[0]);

        if(!possibleExts.some(a => title.toLowerCase().endsWith('.' + a.toLowerCase())))
            return res.status(400).send(req.t('routes.document.errors.file_ext_mismatch', { value: possibleExts[0] }));

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
        if(rev?.content != null) return res.status(409).send(req.t('routes.document.errors.dup_document'));

        const isImage = file.mimetype.startsWith('image/');

        let buffer = file.buffer;
        let fileWidth = 0;
        let fileHeight = 0;

        if(isImage) {
            let metadata;
            try {
                metadata = await sharp(buffer).metadata();
                if(!metadata) return res.status(400).send(req.t('routes.special.errors.invalid_file_type'));
                fileWidth = metadata.width;
                fileHeight = metadata.height;
            } catch(e) {}

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
        }
        else {
            let metadata;
            try {
                metadata = await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(stream.Readable.from(buffer), (err, data) => {
                        if(err) return reject(err);
                        resolve(data);
                    });
                });
            } catch(e) {}
            if(!metadata) return res.status(400).send(req.t('routes.special.errors.invalid_file_type'));

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            fileWidth = videoStream?.width || 0;
            fileHeight = videoStream?.height || 0;
        }

        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        let Key = 'i/' + hash + ext;

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
                return res.status(409).send(req.t('routes.special.errors.dup_file', {
                    link: `<a href="${globalUtils.doc_action_link(doc, 'w')}">${globalUtils.doc_fulltitle(doc)}</a>`
                }).replaceAll('\n', '<br>'));
            }
        }

        let videoFileKey;
        let videoFileSize;
        let videoFileBuffer;
        if(file.mimetype === 'image/gif') {
            try {
                videoFileBuffer = await utils.gifToMp4(buffer);
                const videoHash = crypto.createHash('sha256').update(videoFileBuffer).digest('hex');
                videoFileKey = 'i/' + videoHash + '.mp4';
                videoFileSize = videoFileBuffer.length;
            } catch (e) {}
        }

        if(videoFileKey) {
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
                    return res.status(409).send(req.t('routes.special.errors.dup_file', {
                        link: `<a href="${globalUtils.doc_action_link(doc, 'w')}">${globalUtils.doc_fulltitle(doc)}</a>`
                    }).replaceAll('\n', '<br>'));
                }
            }
        }

        if(!isImage) {
            videoFileBuffer = buffer;
            videoFileSize = buffer.length;
            buffer = null;
            videoFileKey = Key;
            Key = undefined;
        }

        if(!checkExists) try {
            if(Key) await S3.send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key,
                Body: buffer,
                ContentType: file.mimetype
            }));
            if(videoFileKey) await S3.send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: videoFileKey,
                Body: videoFileBuffer,
                ContentType: file.mimetype === 'image/gif' ? 'video/mp4' : file.mimetype
            }));
        } catch(e) {
            console.error(e);
            return res.status(500).send((debug || req.permissions.includes('developer'))
                ? e.toString()
                : req.t('routes.special.errors.file_upload_error'));
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
            fileSize: buffer?.length ?? undefined,
            fileWidth,
            fileHeight,
            videoFileKey,
            videoFileSize,
            log: req.body.log || req.t('routes.special.file_upload_log', { filename: originalName })
        });
    }

    if(req.files.length === 1) res.redirect(globalUtils.doc_action_link(req.document, 'w'));
    else res.renderSkin('upload', {
        contentHtml: req.t('routes.special.multiple_file_uploaded', { count: req.files.length })
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

    res.renderSkin('block_history', {
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
                contentExists: true,
                backlinks: {
                    $not: {
                        $elemMatch: {
                            flags: BacklinkFlags.Redirect
                        }
                    }
                }
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
                contentExists: true,
                backlinks: {
                    $not: {
                        $elemMatch: {
                            flags: BacklinkFlags.Redirect
                        }
                    }
                }
            }
        },
        { $sample: { size: 1 } }
    ]);
    if(!docs.length) return res.status(404).send(req.t('routes.special.errors.no_document'));
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