const express = require('express');
const util = require('util');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { highlight } = require('highlight.js');
const multer = require('multer');

// openNAMU migration things
const sqlite3 = require('sqlite3').verbose();
const { Address4, Address6 } = require('ip-address');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const sharp = require('sharp');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const utils = require('../utils');
const {
    GrantablePermissions,
    DevPermissions,
    UserTypes,
    HistoryTypes,
    BlockHistoryTypes
} = require('../utils/types');
const AllPermissions = [...GrantablePermissions, ...DevPermissions];
const middleware = require('../utils/middleware');
const minifyManager = require('../utils/minifyManager');
const docUtils = require('../utils/docUtils');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const BlockHistory = require('../schemas/blockHistory');

const app = express.Router();

app.get('/admin/config', middleware.permission('developer'), (req, res) => {
    const customStaticFiles = [];
    const customStaticRoot = './customStatic';
    const readDir = path => {
        const files = fs.readdirSync(path);
        if(path !== customStaticRoot && !files.length) {
            fs.rmSync(path, { recursive: true });
        }
        else for(let file of files) {
            const filePath = path + '/' + file;
            const stat = fs.statSync(filePath);
            if(stat.isDirectory()) {
                readDir(filePath);
            } else {
                customStaticFiles.push(filePath.slice(customStaticRoot.length));
            }
        }
    }
    readDir(customStaticRoot);

    res.renderSkin('개발자 설정', {
        contentName: 'config',
        customStaticFiles
    });
});

app.post('/admin/config/eval', middleware.permission('developer'), async (req, res) => {
    const Models = mongoose.models;

    let result;
    try {
        const evalResult = await eval(req.body.code);
        result = util.inspect(evalResult, { depth: 2, maxArrayLength: 200 });
    } catch(e) {
        res.status(400);
        result = e.stack;
    }

    result = highlight(result, { language: 'javascript' }).value.replaceAll('\n', '<br>');
    res.send(result);
});

app.get('/admin/config/tools/:tool', middleware.permission('developer'), middleware.referer('/admin/config'), async (req, res) => {
    const tool = req.params.tool;
    if(tool === 'getgrant') {
        await User.updateOne({
            uuid: req.user.uuid
        }, {
            $addToSet: {
                permissions: 'grant'
            }
        });
        return res.status(204).end();
    }

    else if(tool === 'deletestaticfile') {
        const path = req.query.path;
        if(!path) return res.status(400).send('path not provided');
        if(path.includes('..')) return res.status(400).send('invalid path');
        fs.unlinkSync('./customStatic' + path);

        return res.reload();
    }

    else if(tool === 'fixstringconfig') {
        const newStringConfig = {};
        const exampleStringConfig = JSON.parse(fs.readFileSync('./stringConfig.example.json').toString());
        for(let [key, defaultValue] of Object.entries(exampleStringConfig)) {
            newStringConfig[key] = config[key] || defaultValue;
        }
        fs.writeFileSync('./stringConfig.json', JSON.stringify(newStringConfig, null, 2));
        updateConfig();

        return res.reload();
    }

    else if(tool === 'minifyjs') {
        minifyManager.minifyJS(true);
        return res.status(204).end();
    }

    else if(tool === 'minifycss') {
        minifyManager.minifyCSS(true);
        return res.status(204).end();
    }

    else if(tool === 'clearpublicmindir') {
        const files = fs.readdirSync('./publicMin');
        for(let file of files) {
            const dirPath = path.join('./publicMin', file);
            const stat = fs.statSync(dirPath);
            if(!stat.isDirectory()) continue;

            fs.rmSync(dirPath, { recursive: true });
        }
        return res.status(204).end();
    }

    else if(tool === 'clearcachedir') {
        const files = fs.readdirSync('./cache');
        for(let file of files) {
            const dirPath = path.join('./cache', file);
            const stat = fs.statSync(dirPath);
            if(!stat.isDirectory()) continue;

            fs.rmSync(dirPath, { recursive: true });
        }
        return res.status(204).end();
    }

    else if(tool === 'generateblame') {
        const noBlameRevs = await History.find({
            blame: {
                $exists: false
            }
        }).sort({ rev: 1 }).lean();

        const total = noBlameRevs.length;
        console.log(`creating blame... total: ${total}`);

        while(true) {
            const rev = noBlameRevs.shift();
            if(!rev) break;

            const prevRev = await History.findOne({
                document: rev.document,
                rev: rev.rev - 1
            });

            const newBlame = docUtils.generateBlame(prevRev, rev);
            await History.updateOne({
                uuid: rev.uuid
            }, {
                blame: newBlame
            });

            console.log(`created blame for ${rev.uuid}, ${total - noBlameRevs.length}/${total}`);
        }

        return res.status(204).end();
    }

    else if(tool.startsWith('generatebacklink')) {
        const documents = await Document.find().lean();

        const total = documents.length;
        console.log(`generating backlink info... total: ${total}`);

        while(true) {
            const document = documents.shift();
            if(!document) break;

            const rev = await History.findOne({
                document: document.uuid
            }).sort({ rev: -1 });
            if(!rev) {
                console.log(`no rev for ${document.uuid}`);
                continue;
            }

            await docUtils.postHistorySave(rev, !tool.endsWith('_searchonly'), !tool.endsWith('_backlinkonly'));

            console.log(`generated backlink info for ${document.uuid}, ${total - documents.length}/${total}`);
        }

        return res.status(204).end();
    }

    else if(tool === 'resetsearchindex') {
        await MeiliSearch.deleteIndex(process.env.MEILISEARCH_INDEX);
        await MeiliSearch.createIndex(process.env.MEILISEARCH_INDEX);
        global.documentIndex = MeiliSearch.index(process.env.MEILISEARCH_INDEX);
        documentIndex.updateSettings({
            searchableAttributes: [
                'choseong',
                'title',
                'content',
                'raw'
            ],
            filterableAttributes: [
                'namespace',
                'anyoneReadable'
            ]
        });

        return res.status(204).end();
    }

    else if(tool === 'migrateopennamu') {
        if(!fs.existsSync('./opennamu_data/data.db')) return res.status(400).send('서버 폴더에 opennamu_data 폴더를 생성한 후 opennamu의 data 폴더 파일들을 넣고 시도하세요.');
        const db = new sqlite3.Database('./opennamu_data/data.db', sqlite3.OPEN_READONLY);

        let logs = [];
        const log = msg => {
            logs.push(msg);
            console.log(msg);
        }

        db.serialize(() => {
            const rows = [];
            log('loading all rows...');
            db.each('SELECT * FROM history ORDER BY date', (err, row) => {
                rows.push(row);
            }, async () => {
                log('loaded all rows, migrating...');
                for(let i in rows) {
                    const row = rows[i];

                    console.log(utils.withoutKeys(row, ['data']));
                    let title = row.title;

                    if(title.startsWith('file:')) title = title.replace('file:', '파일:');
                    else if(title.startsWith('category:')) title = title.replace('category:', '분류:');
                    else if(title.startsWith('user:')) title = title.replace('user:', '사용자:');

                    const document = utils.parseDocumentName(title);

                    if(document.namespace === '사용자') {
                        log(`skip: ${title}, reason: user document`);
                        continue;
                    }

                    let content = row.data
                        .replaceAll('\r\n', '\n')
                        .replaceAll('[[file:', '[[파일:')
                        .replaceAll('[[category:', '[[분류:')
                        .replaceAll(`direct_input\n[[category:direct_input]]\n`, '')
                        .replaceAll(`direct_input\n[[분류:direct_input]]\n`, '');

                    const isIp = Address4.isValid(row.ip) || Address6.isValid(row.ip);
                    let user;
                    if(isIp) {
                        user = await User.findOne({
                            ip: row.ip
                        });
                        if(!user) {
                            user = new User({
                                ip: row.ip,
                                type: UserTypes.IP
                            });
                            await user.save();

                            log(`created IP user: ${row.ip}`);
                        }
                    }
                    else {
                        user = await User.findOne({
                            name: 'O:' + row.ip
                        });
                        if(!user) {
                            user = new User({
                                email: `O:${row.ip}@migrated.internal`,
                                password: await bcrypt.hash(process.env.SESSION_SECRET, 12),
                                name: `O:${row.ip}`,
                                type: UserTypes.Migrated
                            });
                            await user.save();

                            log(`created openNAMU user: O:${row.ip}`);
                        }
                    }

                    let dbDocument = await Document.findOne({
                        namespace: document.namespace,
                        title: document.title
                    });
                    if(!dbDocument) {
                        dbDocument = new Document({
                            namespace: document.namespace,
                            title: document.title
                        });
                        await dbDocument.save();

                        log(`create document: ${document.namespace}:${document.title}, uuid: ${dbDocument.uuid}`);
                    }

                    let isFile = false;
                    let fileInfo = {};
                    if(document.namespace === '파일' && row.id === '1') {
                        const splittedTitle = document.title.split('.');
                        const ext = splittedTitle.pop();
                        const filename = splittedTitle.join('.');
                        const hash = crypto.createHash('sha224').update(filename).digest('hex');
                        const imgPath = path.resolve(`./opennamu_data/data/images/${hash}.${ext}`);

                        if(fs.existsSync(imgPath)) {
                            const img = fs.readFileSync(imgPath);
                            try {
                                const metadata = await sharp(img).metadata();
                                fileInfo.fileWidth = metadata.width;
                                fileInfo.fileHeight = metadata.height;
                                fileInfo.fileSize = metadata.size;
                            } catch(e) {}

                            const fileHash = crypto.createHash('sha256').update(img).digest('hex');
                            const Key = 'i/' + fileHash + '.' + ext;

                            fileInfo.fileKey = Key;

                             try {
                                 await S3.send(new PutObjectCommand({
                                     Bucket: process.env.S3_BUCKET_NAME,
                                     Key,
                                     Body: img,
                                     ContentType: ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
                                 }));
                                 log(`uploaded file: ${imgPath}`);
                                 isFile = true;
                             } catch(e) {
                                 console.error(e);
                                 log(`failed to upload file: ${imgPath}`);
                             }
                        }
                    }
                    if(!isFile) fileInfo = {};

                    if(row.type === 'delete') await History.create({
                        user: user.uuid,
                        type: HistoryTypes.Delete,
                        document: dbDocument.uuid,
                        content: null,
                        log: row.send,
                        createdAt: new Date(row.date),
                        migrated: true
                    });
                    else await History.create({
                        user: user.uuid,
                        type: row.type === 'r1' ? HistoryTypes.Create : HistoryTypes.Modify,
                        document: dbDocument.uuid,
                        content,
                        log: row.send,
                        createdAt: new Date(row.date),
                        migrated: true,
                        ...fileInfo
                    });

                    log(`create history: ${document.namespace}:${document.title}, id: ${row.id}, ${i - -1} / ${rows.length}`);
                }
                log('migration complete!');

                fs.writeFileSync(`./opennamu_data/migration_${Date.now()}.log`, logs.join('\n'));
            });
        });
    }

    else return res.status(404).send('tool not found');
});

app.post('/admin/config/configjson', middleware.permission('developer'), (req, res) => {
    const config = req.body.config;
    if(config.includes('/') || !config.endsWith('.json')) return res.status(400).send('Invalid config file');

    try {
        JSON.parse(req.body.content);
    } catch (e) {
        return res.status(400).send('Invalid JSON');
    }

    fs.writeFileSync(config, req.body.content);
    updateConfig();
    return res.status(204).end();
});

app.post('/admin/config/stringconfig', middleware.permission('developer'), (req, res) => {
    let newObj = {};
    for(let key of Object.keys(stringConfig)) {
        newObj[key] = req.body[key] || '';
    }
    fs.writeFileSync('./stringConfig.json', JSON.stringify(newObj, null, 2));
    updateConfig();
    return res.status(204).end();
});

const uploadStaticFile = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            if(req.body.path.includes('..')) return cb('invalid path');
            if(req.body.path === '/admin') return cb(`can't override admin page`);

            const path = './customStatic' + req.body.path;
            if(!fs.existsSync(path)) {
                fs.mkdirSync(path, { recursive: true });
            }

            cb(null, path);
        },
        filename: (req, file, cb) => {
            const filename = req.body.filename || file.originalname;
            if(filename.includes('/') || filename.includes('..')) return cb('invalid filename');

            cb(null, filename);
        }
    }),
    limits: {
        fileSize: 1024 * 1024 * 50
    }
}).single('file');
app.post('/admin/config/staticfile', middleware.permission('developer'), uploadStaticFile, (req, res) => {
    return res.redirect('/admin/config');
});

app.get('/admin/grant', middleware.permission('grant'), async (req, res) => {
    let targetUser;

    if(req.query.username) {
        targetUser = await User.findOne({
            name: req.query.username
        });
    }

    res.renderSkin('권한 부여', {
        contentName: 'grant',
        targetUser,
        grantablePermissions: [
            ...GrantablePermissions,
            ...(req.permissions.includes('developer') ? DevPermissions : [])
        ]
    });
});

app.post('/admin/grant', middleware.permission('grant'), async (req, res) => {
    const targetUser = await User.findOne({
        uuid: req.body.uuid
    });
    if(!targetUser) return res.status(404).send('User not found');

    const grantablePermissions = [
        ...GrantablePermissions,
        ...(req.permissions.includes('developer') ? DevPermissions : [])
    ]

    let newPerm = [];
    for(let perm of AllPermissions) {
        if(grantablePermissions.includes(perm)) {
            if(req.body[perm]) {
                newPerm.push(perm);
            }
        }
        else {
            if(targetUser.permissions.includes(perm)) {
                newPerm.push(perm);
            }
        }
    }

    await User.updateOne({
        uuid: req.body.uuid
    }, {
        permissions: newPerm
    });

    const addedPerms = [];
    const removedPerms = [];

    for(let perm of newPerm) {
        if(!targetUser.permissions.includes(perm)) addedPerms.push(perm);
    }
    for(let perm of targetUser.permissions) {
        if(!newPerm.includes(perm)) removedPerms.push(perm);
    }

    await BlockHistory.create({
        type: BlockHistoryTypes.Grant,
        createdUser: req.user.uuid,
        targetUser: targetUser.uuid,
        targetUsername: targetUser.name,
        content: [
            ...addedPerms.map(a => `+${a}`),
            ...removedPerms.map(r => `-${r}`)
        ].join(' ')
    });

    return res.reload();
});

module.exports = app;