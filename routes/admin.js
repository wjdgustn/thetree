const express = require('express');
const util = require('util');
const fs = require('fs-extra');
const path = require('path');
const mongoose = require('mongoose');
const { highlight } = require('highlight.js');
const multer = require('multer');
const { body } = require('express-validator');
const ms = require('ms');
const crypto = require('crypto');
const { exec } = require('child_process');
const execPromise = util.promisify(exec);
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const JSON5 = require('json5');
const { modify, applyEdits } = require('jsonc-parser');
const randomstring = require('randomstring');

// openNAMU migration things
let sqlite3;
const { Address4, Address6 } = require('ip-address');
const bcrypt = require('bcrypt');
const sharp = require('sharp');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const namumarkUtils = require('../utils/namumark/utils');
const {
    AllPermissions,
    ProtectedPermissions,
    AlwaysProtectedPermissions,
    NoGrantPermissions,
    UserTypes,
    HistoryTypes,
    BlockHistoryTypes,
    ACLTypes,
    EditRequestStatusTypes,
    disabledFeaturesTemplates,
    ThreadCommentTypes,
    AuditLogTypes
} = require('../utils/types');
const middleware = require('../utils/middleware');
const docUtils = require('../utils/docUtils');
const {
    changeNameAction,
    withdrawAction
} = require('./member');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const BlockHistory = require('../schemas/blockHistory');
const EditRequest = require('../schemas/editRequest');
const ThreadComment = require('../schemas/threadComment');
const LoginHistory = require('../schemas/loginHistory');
const SignupToken = require('../schemas/signupToken');
const AuditLog = require('../schemas/auditLog');
const Thread = require('../schemas/thread');
const ACLGroup = require('../schemas/aclGroup');
const ACLModel = require('../schemas/acl');

const ACL = require('../class/acl');

const app = express.Router();

app.get('/admin/config', middleware.permission('config'), async (req, res) => {
    const jsonConfigs = await Promise.all(['publicConfig.json', 'serverConfig.json'].map(async name => ({
        name,
        content: (await fs.readFile(process.env.IS_DOCKER ? `./config/${name}` : `./${name}`)).toString()
    })));

    res.renderSkin('Config', {
        contentName: 'admin/config',
        serverData: {
            jsonConfigs,
            stringConfig,
            disabledFeatures,
            disabledFeaturesTemplates
        }
    });
});

app.get('/admin/developer', middleware.permission('developer'), async (req, res) => {
    const customStaticFiles = [];
    const customStaticRoot = './customStatic';
    const readDir = async path => {
        const files = await fs.readdir(path);
        if(path !== customStaticRoot && !files.length) {
            await fs.rm(path, { recursive: true });
        }
        else for(let file of files) {
            const filePath = path + '/' + file;
            const stat = await fs.stat(filePath);
            if(stat.isDirectory()) {
                await readDir(filePath);
            } else {
                customStaticFiles.push(filePath.slice(customStaticRoot.length));
            }
        }
    }
    await readDir(customStaticRoot);

    const jsonConfigs = await Promise.all(['devConfig.json'].map(async name => ({
        name,
        content: (await fs.readFile(process.env.IS_DOCKER ? `./config/${name}` : `./${name}`)).toString()
    })));

    let skinCommitIds = [];
    try {
        const installedSkins = await fs.readdir('./frontend/skins');
        skinCommitIds = Object.fromEntries(await Promise.all(
            installedSkins.map(async name => [name, (await execPromise('git rev-parse --short HEAD', { cwd: path.join('./frontend/skins', name) })).stdout.trim()])
        ));
    } catch(e) {}

    res.renderSkin('개발자 설정', {
        contentName: 'admin/developer',
        serverData: {
            customStaticFiles,
            jsonConfigs,
            versionInfo: global.versionInfo,
            newVersionInfo: global.newVersionInfo,
            newCommits: global.newCommits,
            newFECommits: global.newFECommits,
            checkUpdate: config.check_update !== false,
            skinInfos: Object.fromEntries(Object.entries(global.skinInfos).map(([key, value]) => [key, utils.withoutKeys(value, ['template'])])),
            skinCommitIds
        }
    });
});

app.post('/admin/developer/eval', middleware.permission('developer'), async (req, res) => {
    if(process.env.DISABLE_EVAL === 'true') return res.status(403).send('disable_eval');

    const Models = mongoose.models;

    let result;
    let isStr = false;
    try {
        const evalResult = await eval(req.body.code);
        if(typeof evalResult === 'string') {
            isStr = true;
            result = evalResult;
        }
        else result = util.inspect(evalResult, { depth: 2, maxArrayLength: 200 });
    } catch(e) {
        res.status(400);
        result = e.stack;
    }

    if(isStr) result = namumarkUtils.escapeHtml(result);
    else result = highlight(result, { language: 'javascript' }).value.replaceAll('\n', '<br>');

    res.partial({ evalOutput: result });
});

app.get('/admin/config/tools/:tool', middleware.permission('config'), middleware.referer('/admin/'), async (req, res) => {
    const tool = req.params.tool;

    const configPath = str => process.env.IS_DOCKER ? `./config/${str}` : `./${str}`;

    if(tool === 'deletedisabledfeature') {
        const index = parseInt(req.query.index);
        global.disabledFeatures.splice(index, 1);
        if(global.disabledFeatures.length) await fs.writeFile('./cache/disabledFeatures.json', JSON.stringify(global.disabledFeatures, null, 2));
        else await fs.rm('./cache/disabledFeatures.json');

        return res.reload();
    }

    if(!req.permissions.includes('developer')) return res.status(403).send('권한이 부족합니다.');

    if(tool === 'deletestaticfile') {
        const path = req.query.path;
        if(!path) return res.status(400).send('path not provided');
        if(path.includes('..')) return res.status(400).send('invalid path');
        await fs.unlink('./customStatic' + path);

        return res.reload();
    }

    else if(tool === 'fixstringconfig') {
        const newStringConfig = {};
        const exampleStringConfig = JSON.parse((await fs.readFile('./stringConfig.example.json')).toString());
        for(let [key, defaultValue] of Object.entries(exampleStringConfig)) {
            newStringConfig[key] = config[key] || defaultValue;
        }
        const additionalEntries = Object.entries(global.stringConfig).filter(([key]) => !exampleStringConfig[key]);
        for(let [key, value] of additionalEntries) {
            newStringConfig[key] = value;
        }
        await fs.writeFile(configPath('stringConfig.json'), JSON.stringify(newStringConfig, null, 2));
        updateConfig();

        return res.reload();
    }

    else if(tool === 'removestringconfig') {
        const newStringConfig = { ...global.stringConfig };
        delete newStringConfig[req.query.key];

        const filePath = configPath('stringConfig.json');
        const oldContent = (await fs.readFile(filePath)).toString();
        const newContent = JSON.stringify(newStringConfig, null, 2);

        await fs.writeFile(filePath, newContent);
        updateConfig();

        if(oldContent !== newContent) await AuditLog.create({
            user: req.user.uuid,
            action: AuditLogTypes.ModifyConfig,
            target: 'stringConfig.json',
            diffOld: oldContent,
            diffNew: newContent
        });

        return res.reload();
    }

    else if(tool === 'generateblame') {
        res.status(204).end();

        const noBlameRevs = await History.find({
            $or: [
                {
                    blame: {
                        $exists: false
                    }
                },
                {
                    blame: null
                }
            ]
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

            const newBlame = await docUtils.generateBlame(prevRev, rev);
            await History.updateOne({
                uuid: rev.uuid
            }, {
                blame: newBlame
            });

            console.log(`created blame for ${rev.uuid}, ${total - noBlameRevs.length}/${total}`);
        }
    }

    else if(tool.startsWith('generatebacklink')) {
        res.status(204).end();

        const documents = await Document.find()
            .sort({
                updatedAt: 1
            })
            // .select('uuid')
            .lean();

        // const total = await Document.countDocuments();

        const total = documents.length;
        console.log(`generating backlink info... total: ${total}`);

        // let documents = [];
        let completed = 0;

        // while(true) {
        //     if(!documents.length) {
        //         documents = await Document.find({
        //             ...(lastDocument ? {
        //                 _id: {
        //                     $gt: lastDocument._id
        //                 }
        //             } : {})
        //         })
        //             .sort({
        //                 _id: 1
        //             })
        //             .limit(50)
        //             .select('uuid')
        //             .lean();
        //
        //         lastDocument = documents[documents.length - 1];
        //
        //         console.log(`refill documents, length: ${documents.length}`);
        //     }
        //
        //     const document = documents.shift();
        //     if(!document) break;
        //
        //     const rev = await History.findOne({
        //         document: document.uuid
        //     }).sort({ rev: -1 }).lean();
        //     if(!rev) {
        //         console.log(`no rev for ${document.uuid}`);
        //         completed++;
        //         continue;
        //     }
        //
        //     await docUtils.postHistorySave(rev, !tool.endsWith('_searchonly'), !tool.endsWith('_backlinkonly'));
        //
        //     console.log(`generated backlink info for ${document.uuid}, ${++completed}/${total}`);
        // }

        for(let smallSet of utils.groupArray(documents, 50)) {
            await Promise.all(smallSet.map(document => new Promise(async resolve => {
                const rev = await History.findOne({
                    document: document.uuid
                }).sort({ rev: -1 }).lean();
                if(!rev?.content) {
                    console.log(`no rev for ${document.uuid}`);
                    completed++;
                    return resolve();
                }

                console.log(`processing ${document.title}`);

                try {
                    await docUtils.postHistorySave(rev, !tool.endsWith('_searchonly'), !tool.endsWith('_backlinkonly'), document);

                    console.log(`generated backlink info for ${document.uuid}, ${++completed}/${total}`);
                } catch(e) {
                    console.error(`failed to generate backlink info for ${document.uuid}`, e);
                }
                resolve();
            })));
        }
    }

    else if(tool === 'resetsearchindex') {
        res.status(204).end();
        await global.resetSearchIndex();
    }

    else if(tool === 'migrateopennamu') {
        if(!(await fs.exists('./opennamu_data/data.db'))) return res.status(400).send('서버 폴더에 opennamu_data 폴더를 생성한 후 opennamu의 data 폴더 파일들을 넣고 시도하세요.');

        try {
            sqlite3 ??= require('sqlite3').verbose();
        } catch(e) {
            return res.status(400).send('sqlite3 import 중 오류가 발생하였습니다. sqlite3 라이브러리 설치 후 시도하세요.');
        }

        res.status(204).end();

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

                    if(row.type === 'setting') {
                        log(`skip: ${row.title}, reason: setting`);
                        continue;
                    }

                    console.log(utils.withoutKeys(row, ['data']));
                    let title = row.title;
                    if(!title) continue;

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

                    if(content.startsWith('#넘겨주기 ')) content.replace('#넘겨주기 ', '#redirect ');

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

                    const isFileRev1 = document.namespace === '파일' && row.id === '1';
                    let isFile = false;
                    let fileInfo = {};
                    if(isFileRev1) {
                        const splittedTitle = document.title.split('.');
                        const ext = splittedTitle.pop();
                        const filename = splittedTitle.join('.');
                        const hash = crypto.createHash('sha224').update(filename).digest('hex');
                        const imgPath = path.resolve(`./opennamu_data/data/images/${hash}.${ext}`);

                        console.log(`file rev 1 detected, filename: ${filename} ext: ${ext} hash: ${hash} imgPath: ${imgPath}`);

                        if(await fs.exists(imgPath)) {
                            const img = await fs.readFile(imgPath);
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
                                     ContentType: {
                                         svg: 'image/svg+xml',
                                         jpg: 'image/jpeg'
                                     }[ext] ?? `image/${ext}`
                                 }));
                                 log(`uploaded file: ${imgPath}`);
                                 isFile = true;
                             } catch(e) {
                                 console.error(e);
                                 log(`failed to upload file: ${imgPath}`);
                             }
                        }
                        else log(`file not found: ${imgPath}`);
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
                        type: (row.type === 'r1' || isFileRev1) ? HistoryTypes.Create : HistoryTypes.Modify,
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

                await fs.writeFile(`./opennamu_data/migration_${Date.now()}.log`, logs.join('\n'));
            });
        });
    }

    else if(tool === 'checkupdate') {
        await global.checkUpdate(true);
        res.reload();
    }

    else if(tool === 'update') {
        if(global.updatingEngine)
            return res.status(409).send('이미 업데이트가 진행중입니다.');
        res.status(204).end();
        global.updateEngine();
    }

    else if(tool === 'updatesubmodule') {
        if(global.updatingEngine)
            return res.status(409).send('이미 업데이트가 진행중입니다.');
        res.status(204).end();
        global.updateEngine(false);
    }

    else if(tool === 'updateskin') {
        res.status(204).end();
        for(let skin of Object.keys(global.skinInfos)) {
            const checkGit = await fs.exists(`./skins/${skin}/.git`);
            if(!checkGit) continue;

            exec('git pull', {
                cwd: `./skins/${skin}`
            }, (err, stdout, stderr) => {
                if(err) console.error(err);
                if(stdout) console.log(stdout);
                if(stderr) console.error(stderr);
                delete global.skinCommitId[skin];
            });
        }
    }

    else if(tool === 'mailtest') {
        if(!config.use_email_verification) return res.status(400).send('이메일 인증이 비활성화되어 있습니다.');

        try {
            await mailTransporter.sendMail({
                from: config.smtp_sender,
                to: req.user.email,
                subject: `[${config.site_name}] 이메일 전송 테스트`,
                html: `
축하합니다! 이메일을 읽으셨습니다.
        `.trim().replaceAll('\n', '<br>')
            });
        } catch(e) {
            const result = highlight(e.stack, { language: 'javascript' }).value.replaceAll('\n', '<br>');
            return res.partial({ evalOutput: result });
        }

        return res.status(204).end();
    }

    else return res.status(404).send('tool not found');
});

app.post('/admin/config/configjson', middleware.permission('config'), async (req, res) => {
    const config = req.body.config;
    // if(config.includes('/') || !config.endsWith('.json')) return res.status(400).send('Invalid config file');

    const isDev = req.permissions.includes('developer');

    const availableConfigs = [
        'publicConfig.json',
        'serverConfig.json'
    ];
    if(isDev)
        availableConfigs.push('devConfig.json');

    if(!availableConfigs.includes(config)) return res.status(400).send('Invalid config file');

    const filePath = process.env.IS_DOCKER ? `./config/${config}` : `./${config}`;
    const oldContent = (await fs.readFile(filePath)).toString();

    let parsedJson;
    let content = req.body.content;
    if(req.body.key && req.body.value) {
        content = oldContent;
        const edits = modify(content, req.body.key.split('.'), req.body.value, {});
        content = applyEdits(content, edits);
    }

    try {
        parsedJson = JSON5.parse(content);
    } catch (e) {
        return res.status(400).send(e.message);
    }

    if(config !== 'devConfig.json') for(let key in parsedJson) {
        if(global.devConfig.hasOwnProperty(key)) return res.status(400).send(`Invalid key "${key}"`);
    }

    await fs.writeFile(filePath, content);
    updateConfig();

    if(oldContent !== content) await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.ModifyConfig,
        target: config,
        diffOld: oldContent,
        diffNew: content,
        devOnly: config === 'devConfig.json'
    });

    return res.status(204).end();
});

app.post('/admin/config/stringconfig', middleware.permission('config'), async (req, res) => {
    // let newObj = {};
    // for(let key of Object.keys(stringConfig)) {
    //     newObj[key] = req.body[key] || '';
    // }
    // fs.writeFileSync('./stringConfig.json', JSON.stringify(newObj, null, 2));
    // updateConfig();
    // return res.status(204).end();

    const newObj = { ...global.stringConfig };
    newObj[req.body.key] = req.body.value;

    const filePath = process.env.IS_DOCKER ? `./config/stringConfig.json` : `./stringConfig.json`;
    const oldContent = (await fs.readFile(filePath)).toString();
    const newContent = JSON.stringify(newObj, null, 2);

    await fs.writeFile(filePath, newContent);
    updateConfig();

    if(oldContent !== newContent) await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.ModifyConfig,
        target: 'stringConfig.json',
        diffOld: oldContent,
        diffNew: newContent
    });

    return res.status(204).end();
});

app.post('/admin/config/stringconfig/add', middleware.permission('config'), async (req, res) => {
    const newObj = { ...global.stringConfig };
    newObj[req.body.key] = '';
    await fs.writeFile(process.env.IS_DOCKER ? `./config/stringConfig.json` : `./stringConfig.json`, JSON.stringify(newObj, null, 2));
    updateConfig();
    return res.reload();
});

const uploadStaticFile = multer({
    storage: multer.diskStorage({
        destination: async (req, file, cb) => {
            if(req.body.path.includes('..')) return cb('invalid path');
            if(req.body.path === '/admin') return cb(`can't override admin page`);

            const path = './customStatic' + req.body.path;
            if(!await fs.exists(path)) {
                await fs.mkdir(path, { recursive: true });
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
app.post('/admin/developer/staticfile', middleware.permission('developer'), uploadStaticFile, (req, res) => {
    res.reload();
});

app.post('/admin/developer/skin/add', middleware.permission('developer'), async (req, res) => {
    let url;
    try {
        url = new URL(req.body.url);
    } catch(e) {
        return res.status(400).send('Invalid URL');
    }

    const name = req.body.name;
    if(!name?.trim() || name.includes('..') || name.includes('/')) return res.status(400).send('Invalid name');

    const checkSkinsDir = await fs.exists('./frontend/skins');
    if(!checkSkinsDir) await fs.mkdir('./frontend/skins');
    try {
        await execPromise(`git clone "${url}" "${name}"`, {cwd: './frontend/skins'});
    } catch(e) {
        return res.status(400).send('Invalid repository');
    }

    res.reload();
});

app.post('/admin/developer/skin/update', middleware.permission('developer'), async (req, res) => {
    const name = req.body.name;
    if(name.includes('..')) return res.status(400).send('Invalid name');
    const dir = path.join('./frontend/skins', name);
    const skinExists = await fs.exists(dir);
    if(!skinExists) return res.status(400).send('Invalid skin');

    try {
        await execPromise('git pull', {cwd: dir});
    } catch(e) {
        return res.status(400).send('pull failed');
    }

    res.reload();
});

app.post('/admin/developer/skin/delete', middleware.permission('developer'), async (req, res) => {
    const name = req.body.name;
    if(name.includes('..') || name === 'plain') return res.status(400).send('Invalid name');
    const dir = path.join('./frontend/skins', name);
    const skinExists = await fs.exists(dir);
    if(!skinExists) return res.status(400).send('Invalid skin');

    const skinPath = path.join('./skins', name);

    await fs.rm(dir, { recursive: true }).catch(() => {});
    await fs.rm(skinPath, { recursive: true }).catch(() => {});

    global.updateSkinInfo();
    res.reload();
});

app.post('/admin/developer/skin/build', middleware.permission('developer'), async (req, res) => {
    let names = req.body.name;
    if(!names) return res.status(403).send('missing name');
    if(typeof names === 'string') names = [...names.split(',')].map(a => a.trim());

    for(let name of names) {
        if(name.includes('..')) return res.status(400).send('Invalid name');
        const dir = path.join('./frontend/skins', name);
        const skinExists = await fs.exists(dir);
        if(!skinExists) return res.status(400).send('Invalid skin');
    }

    const updatingSkin = names.find(a => global.updatingSkins.includes(a));
    if(updatingSkin) return res.status(409).send(`${updatingSkin} already building`);

    const { failed } = await global.updateSkins(names);
    if(failed.length) return res.status(400).send(`build failed: ${failed.join(', ')}`);

    res.reload();
});

app.post('/admin/developer/signup',
    middleware.permission('developer'),
    body('email')
        .notEmpty().withMessage('이메일의 값은 필수입니다.')
        .isEmail().withMessage('이메일의 값을 형식에 맞게 입력해주세요.')
        .normalizeEmail(),
    async (req, res) => {
    const email = req.body.email;
    const name = req.body.name;

    const checkUserExists = await User.exists({
        email
    });
    if(checkUserExists) return res.status(409).json({
        fieldErrors: {
            email: {
                msg: '이미 계정이 생성된 이메일입니다.'
            }
        }
    });

    await SignupToken.deleteMany({
        email
    });

    const newToken = await SignupToken.create({
        email,
        name
    });

    const signupUrl = `/member/signup/${newToken.token}`;
    res.redirect(signupUrl);
});

app.get('/admin/grant', middleware.permission('grant'), async (req, res) => {
    let targetUser;

    if(req.query.username) {
        targetUser = await User.findOne({
            name: {
                $regex: new RegExp(`^${utils.escapeRegExp(req.query.username)}$`, 'i')
            }
        });
    }

    const grantPerms = AllPermissions.filter(a => config.grant_permissions.includes(a) || req.permissions.includes(a));
    const configPerms = AllPermissions.filter(a => !grantPerms.includes(a));
    const grantablePermissions = [...grantPerms, ...(req.permissions.includes('config') ? configPerms : [])]
        .filter(a => !NoGrantPermissions.includes(a)
            && (req.permissions.includes(a) || !ProtectedPermissions.includes(a))
            && !AlwaysProtectedPermissions.includes(a));

    res.renderSkin('권한 부여', {
        contentName: 'admin/grant',
        serverData: {
            targetUser: targetUser ? {
                ...await utils.getPublicUser(targetUser),
                permissions: targetUser.permissions
            } : null,
            grantablePermissions: grantablePermissions,
            allPermissions: AllPermissions.filter(a => !NoGrantPermissions.includes(a)),
            hidelogPerm: req.permissions.includes('grant_hidelog')
        }
    });
});

app.post('/admin/grant',
    middleware.permission('grant'),
    body('hidelog')
        .custom((value, { req }) => {
            if(value === 'Y' && !req.permissions.includes('grant_hidelog')) throw new Error('권한이 부족합니다.');
            return true;
        }),
    middleware.fieldErrors,
    async (req, res) => {
    const targetUser = await User.findOne({
        uuid: req.body.uuid
    });
    if(!targetUser) return res.status(404).send('User not found');

    const grantablePermissions = AllPermissions.filter(a =>
        !NoGrantPermissions.includes(a)
        && (req.permissions.includes(a) || !ProtectedPermissions.includes(a))
        && !AlwaysProtectedPermissions.includes(a)
        && (req.permissions.includes('config') || config.grant_permissions.includes(a) || req.permissions.includes(a)));

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

    const addedPerms = [];
    const removedPerms = [];

    for(let perm of newPerm) {
        if(!targetUser.permissions.includes(perm)) addedPerms.push(perm);
    }
    for(let perm of targetUser.permissions) {
        if(!newPerm.includes(perm)) removedPerms.push(perm);
    }

    if(removedPerms.includes('developer')) {
        const devCount = await User.countDocuments({
            permissions: 'developer'
        });
        if(devCount <= 1) return res.status(400).send('최소 1명은 developer 권한을 보유해야 합니다.');
    }

    await User.updateOne({
        uuid: req.body.uuid
    }, {
        permissions: newPerm
    });

    if(addedPerms.length || removedPerms.length)
        await BlockHistory.create({
            type: BlockHistoryTypes.Grant,
            createdUser: req.user.uuid,
            targetUser: targetUser.uuid,
            targetUsername: targetUser.name,
            content: [
                ...addedPerms.map(a => `+${a}`),
                ...removedPerms.map(r => `-${r}`)
            ].join(' '),
            hideLog: req.body.hidelog === 'Y'
        });

    return res.reload();
});

app.get('/a/:action', middleware.referer('/history/'), middleware.parseDocumentName, async (req, res) => {
    if(!req.query.uuid) return res.status(400).send('missing uuid');

    const history = await History.findOne({
        uuid: req.query.uuid
    });
    if(!history) return res.status(404).send('리비전을 찾을 수 없습니다.');

    const dbDocument = await Document.findOne({
        uuid: history.document
    });

    const document = req.document;
    if(document.namespace !== dbDocument.namespace || document.title !== dbDocument.title) return res.status(400).send('document mismatch');

    const acl = await ACL.get({ document: dbDocument });
    const { result: editable } = await acl.check(ACLTypes.Edit, req.aclData);
    if(!editable) return res.status(403).send('permission_edit');

    const action = req.params.action;
    if(action === 'mark_troll' || action === 'unmark_troll') {
        if(!req.permissions.includes('mark_troll_revision')) return res.status(403).send('missing mark_troll_revision permission');

        await History.updateOne({
            uuid: history.uuid
        }, {
            troll: action === 'mark_troll',
            trollBy: req.user.uuid
        });

        return res.reload();
    }

    else if(action === 'hide_log' || action === 'unhide_log') {
        if(!req.permissions.includes('hide_document_history_log')) return res.status(403).send('missing hide_document_history_log permission');
        if(!history.log) return res.status(400).send('no log');

        await History.updateOne({
            uuid: history.uuid
        }, {
            hideLog: action === 'hide_log',
            hideLogBy: req.user.uuid
        });

        return res.reload();
    }

    else if(action === 'hide' || action === 'unhide') {
        if(!req.permissions.includes('hide_revision')) return res.status(403).send('missing hide_revision permission');

        await History.updateOne({
            uuid: history.uuid
        }, {
            hidden: action === 'hide'
        });

        return res.reload();
    }

    else if(action === 'delete_file') {
        if(!req.permissions.includes('config')) return res.status(403).send('missing config permission');

        try {
            await S3.send(new DeleteObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: history.fileKey
            }));
        } catch(e) {
            console.error(e);
            return res.status(500).send((debug || req.permissions.includes('developer'))
                ? e.toString()
                : '파일 삭제 중 오류가 발생했습니다.');
        }

        await History.updateMany({
            fileKey: history.fileKey
        }, {
            $unset: {
                fileKey: 1
            }
        });

        return res.reload();
    }

    else return res.status(404).send('action not found');
});

app.post('/admin/config/migratecontribution', middleware.permission('config'), async (req, res) => {
    const fromUser = await User.findOne({
        name: req.body.from
    });
    if(!fromUser || !req.body.from) return res.status(404).send('이전 기여자 계정을 찾을 수 없습니다.');
    if(fromUser.type !== UserTypes.Migrated) return res.status(400).send('이전 기여자 계정이 openNAMU 계정이 아닙니다.');

    const toUser = await User.findOne({
        name: req.body.to
    });
    if(!toUser || !req.body.to) return res.status(404).send('대상 계정을 찾을 수 없습니다.');
    if(toUser.type !== UserTypes.Account) return res.status(400).send('대상 계정이 가입된 계정이 아닙니다.');

    await History.updateMany({
        user: fromUser.uuid
    }, {
        user: toUser.uuid,
        migrated: false
    });

    await User.deleteOne({
        uuid: fromUser.uuid
    });

    return res.status(204).end();
});

app.post('/admin/config/disabledfeatures', middleware.permission('config'), async (req, res) => {
    const {
        methodField: method,
        type,
        condition,
        message,
        messageType
    } = req.body;

    if(!method || !type || !condition) return res.status(400).send('method와 type과 condition은 필수입니다.');

    if((!req.permissions.includes('developer') || process.env.DISABLE_EVAL === 'true') && type === 'js') {
        const whitelistedCodes = disabledFeaturesTemplates.filter(a => a.type === 'js').map(a => a.condition);
        if(!whitelistedCodes.includes(condition)) return res.status(400).send('템플릿에 등록된 js 코드만 사용할 수 있습니다.');
    }

    global.disabledFeatures.push({
        method,
        type,
        condition,
        message,
        messageType
    });
    await fs.writeFile('./cache/disabledFeatures.json', JSON.stringify(global.disabledFeatures, null, 2));

    res.reload();
});

app.get('/admin/batch_revert', middleware.permission('batch_revert'), (req, res) => {
    res.renderSkin('일괄 되돌리기', {
        contentName: 'admin/batch_revert',
        serverData: {
            hidelogPerm: req.permissions.includes('batch_revert_hidelog')
        }
    });
});

app.post('/admin/batch_revert',
    middleware.permission('batch_revert'),
    (req, res, next) => {
        req.modifiedBody = {};
        next();
    },
    body('uuid')
        .notEmpty().withMessage('uuid의 값은 필수입니다.')
        .isUUID().withMessage('uuid의 값을 형식에 맞게 입력해주세요.')
        .custom(async (value, { req }) => {
            const user = await User.findOne({
                uuid: value
            });
            if(!user || !value) throw new Error('계정을 찾을 수 없습니다.');

            req.modifiedBody.user = user;
        }),
    body('duration')
        .notEmpty().withMessage('기간은 필수입니다.')
        .isLength({
            max: 100
        })
        .custom(async (value, { req }) => {
            req.modifiedBody.duration = ms(value);
            if(!req.modifiedBody.duration) throw new Error('기간 형식이 잘못되었습니다.');
            if(req.modifiedBody.duration > 1000 * 60 * 60 * 24) throw new Error('최대 기간은 24시간입니다.');
        }),
    body('reason')
        .notEmpty().withMessage('reason의 값은 필수입니다.'),
    body('hidelog')
        .custom((value, { req }) => {
            if(value === 'Y' && !req.permissions.includes('batch_revert_hidelog')) throw new Error('권한이 부족합니다.');
            return true;
        }),
    middleware.fieldErrors,
    async (req, res) => {
    const date = new Date();
    const { user, duration } = req.modifiedBody;
    const reason = req.body.reason;

    const closeEditRequests = req.body.closeEditRequests === 'Y';
    const hideThreadComments = req.body.hideThreadComments === 'Y';
    const revertContributions = req.body.revertContributions === 'Y';
    const revertEditRequests = req.body.revertEditRequests === 'Y';

    if(!closeEditRequests && !hideThreadComments && !revertContributions && !revertEditRequests)
        return res.status(400).send('아무 작업도 선택하지 않았습니다.');

    const resultText = [];
    const failResultText = [];

    if(closeEditRequests) {
        const result = await EditRequest.updateMany({
            createdUser: user.uuid,
            createdAt: {
                $gte: date - duration
            },
            status: {
                $ne: EditRequestStatusTypes.Locked
            }
        }, {
            lastUpdateUser: req.user.uuid,
            status: EditRequestStatusTypes.Locked,
            closedReason: reason,
            lastUpdatedAt: date
        });
        resultText.push(`닫힌 편집 요청 수 : ${result.modifiedCount}`);
    }

    if(hideThreadComments) {
        const result = await ThreadComment.updateMany({
            user: user.uuid,
            createdAt: {
                $gte: date - duration
            },
            hidden: false,
            type: ThreadCommentTypes.Default
        }, {
            hiddenBy: req.user.uuid,
            hidden: true
        });
        resultText.push(`숨긴 토론 댓글 수 : ${result.modifiedCount}`);
    }

    if(revertContributions || revertEditRequests) {
        const orFilters = [];
        if(revertContributions) orFilters.push({
            user: user.uuid
        });
        if(revertEditRequests) orFilters.push({
            editRequestAcceptedBy: user.uuid
        });

        const query = {
            $or: orFilters,
            createdAt: {
                $gte: date - duration
            },
            troll: false
        }
        const revs = await History.find(query).sort({ createdAt: 1 }).lean();
        const trollResult = await History.updateMany(query, {
            troll: true,
            trollBy: req.user.uuid
        });
        resultText.push(`반달로 표시된 리비전 수 : ${trollResult.modifiedCount}`);

        let revertedCount = 0;
        const documents = [...new Set(revs.map(rev => rev.document))];
        await Promise.all(documents.map(docUuid => new Promise(async resolve => {
            const dbDocument = await Document.findOne({
                uuid: docUuid
            });
            const document = utils.dbDocumentToDocument(dbDocument);
            const fullTitle = globalUtils.doc_fulltitle(document);
            const fullTitleLink = `<a href="${globalUtils.doc_action_link(document, 'w')}">${namumarkUtils.escapeHtml(fullTitle)}</a>`;
            const acl = await ACL.get({ document: dbDocument });

            const lastTrollRev = revs.findLast(rev => rev.document === docUuid);
            const firstTrollRev = revs.find(rev => rev.document === docUuid);

            if(!lastTrollRev.latest) {
                failResultText.push(`${fullTitleLink}: 이후 정상 기여 존재`);
                return resolve();
            }

            const lastNormalRev = await History.findOne({
                document: docUuid,
                _id: {
                    $lt: firstTrollRev._id
                },
                troll: false,
                type: {
                    $in: [
                        HistoryTypes.Create,
                        HistoryTypes.Modify,
                        HistoryTypes.Revert
                    ]
                }
            }).sort({ rev: -1 });

            if(lastNormalRev) {
                if(lastTrollRev.type === HistoryTypes.Revert && lastTrollRev.revertRev === lastNormalRev.rev) {
                    failResultText.push(`${fullTitleLink}: 되돌릴 기여 동일`);
                    return resolve();
                }

                const { result, aclMessage } = await acl.check(ACLTypes.Edit, req.aclData);
                if(!result) {
                    failResultText.push(`${fullTitleLink}: ${aclMessage}`);
                    return resolve();
                }

                await History.create({
                    user: req.user.uuid,
                    type: HistoryTypes.Revert,
                    document: docUuid,
                    revertRev: lastNormalRev.rev,
                    revertUuid: lastNormalRev.uuid,
                    content: lastNormalRev.content,
                    fileKey: lastNormalRev.fileKey,
                    fileSize: lastNormalRev.fileSize,
                    fileWidth: lastNormalRev.fileWidth,
                    fileHeight: lastNormalRev.fileHeight,
                    log: reason
                });
            }
            else {
                if(document.namespace === '사용자' && !document.title.includes('/')) {
                    failResultText.push(`${fullTitleLink}: disable_user_document`);
                    return resolve();
                }

                if(lastTrollRev.type === HistoryTypes.Delete) {
                    failResultText.push(`${fullTitleLink}: 되돌릴 기여 없음`);
                    return resolve();
                }

                const { result, aclMessage } = await acl.check(ACLTypes.Delete, req.aclData);
                if(!result) {
                    failResultText.push(`${fullTitleLink}: ${aclMessage}`);
                    return resolve();
                }

                await History.create({
                    user: req.user.uuid,
                    type: HistoryTypes.Delete,
                    document: docUuid,
                    content: null,
                    log: reason
                });
            }

            revertedCount++;
            resolve();
        })));
        resultText.push(`되돌린 문서 수 : ${revertedCount}`);
    }

    if(revertEditRequests) {
        const result = await EditRequest.updateMany({
            lastUpdateUser: user.uuid,
            lastUpdatedAt: {
                $gte: date - duration
            },
            status: EditRequestStatusTypes.Closed
        }, {
            status: EditRequestStatusTypes.Open
        });
        resultText.push(`다시 열린 편집 요청 수 : ${result.modifiedCount}`);
    }

    await BlockHistory.create({
        type: BlockHistoryTypes.BatchRevert,
        createdUser: req.user.uuid,
        targetUser: user.uuid,
        targetUsername: user.name || user.ip,
        content: reason,
        hideLog: req.body.hidelog === 'Y'
    });

    resultText.unshift(`작업 시간 : ${Date.now() - date}ms`);

    const resultData = {
        resultText,
        failResultText
    }
    res.partial({
        result: resultData
    });
});

app.get('/admin/login_history', middleware.permission('login_history'), async (req, res) => {
    res.renderSkin('로그인 내역', {
        contentName: 'admin/login_history',
        serverData: {
            hidelogPerm: req.permissions.includes('login_history_hidelog')
        }
    });
});

app.post('/admin/login_history',
    middleware.permission('login_history'),
    body('hidelog')
        .custom((value, { req }) => {
            if(value === 'Y' && !req.permissions.includes('login_history_hidelog')) throw new Error('권한이 부족합니다.');
            return true;
        }),
    async (req, res) => {
    const targetUser = await User.findOne({
        name: {
            $regex: new RegExp(`^${utils.escapeRegExp(req.body.username)}$`, 'i')
        }
    });
    if(!targetUser) return res.status(404).send('사용자 이름이 올바르지 않습니다.');
    if(!req.permissions.includes('hideip')
        && (targetUser.permissions.includes('developer') || targetUser.permissions.includes('hideip')))
        return res.status(403).send('invalid_permission');

    if(config.testwiki && !req.permissions.includes('config') && targetUser.uuid !== req.user.uuid)
        return res.status(403).send('다른 사용자의 로그인 기록을 조회할 수 없습니다.');

    const sessionId = crypto.randomBytes(32).toString('hex');
    req.session.loginHistorySession ??= {};
    req.session.loginHistorySession[sessionId] = {
        loginHistoryExpiresAt: Date.now() + 1000 * 60 * 10,
        loginHistoryTargetUser: targetUser.uuid
    }

    await BlockHistory.create({
        type: BlockHistoryTypes.LoginHistory,
        createdUser: req.user.uuid,
        targetUser: targetUser.uuid,
        targetUsername: targetUser.name,
        hideLog: req.body.hidelog === 'Y'
    });

    res.redirect('/admin/login_history/' + sessionId);
});

app.get('/admin/login_history/:session', middleware.permission('login_history'), async (req, res) => {
    if(req.session.loginHistorySession) for(let id of Object.keys(req.session.loginHistorySession)) {
        const session = req.session.loginHistorySession[id];
        if(session.loginHistoryExpiresAt < Date.now()) {
            delete req.session.loginHistorySession[id];
        }
    }

    const session = req.session.loginHistorySession?.[req.params.session];

    const uuid = session?.loginHistoryTargetUser;
    if(!uuid) return res.redirect('/admin/login_history');

    const targetUser = await User.findOne({
        uuid
    });
    const latestLog = await LoginHistory.findOne({
        uuid
    }).sort({ _id: -1 });

    const baseQuery = { uuid };
    const query = { ...baseQuery };

    const pageQuery = req.query.until || req.query.from;
    if(pageQuery) {
        const objectId = new mongoose.Types.ObjectId(pageQuery);
        if(req.query.until) query._id = {
            $gte: objectId
        }
        else query._id = {
            $lte: objectId
        }
    }

    const logs = await LoginHistory.find(query)
        .sort({ _id: query._id?.$gte ? 1 : -1 })
        .limit(100)
        .select('type ip device userAgent createdAt _id');

    if(query._id?.$gte) logs.reverse();

    let prevItem;
    let nextItem;
    if(logs?.length) {
        prevItem = await LoginHistory.findOne({
            ...baseQuery,
            _id: { $gt: logs[0]._id }
        })
            .sort({ _id: 1 })
            .select('_id');
        nextItem = await LoginHistory.findOne({
            ...baseQuery,
            _id: { $lt: logs[logs.length - 1]._id }
        }).sort({ _id: -1 })
            .select('_id');
    }

    res.renderSkin(`${targetUser?.name} 로그인 내역`, {
        contentName: 'admin/login_history_result',
        targetUser: {
            ...await utils.getPublicUser(targetUser),
            email: targetUser.email
        },
        userAgent: latestLog?.userAgent,
        logs: utils.withoutKeys(logs, ['_id']),
        prevItem,
        nextItem
    });
});

app.get('/admin/audit_log', middleware.permission('config'), async (req, res) => {
    const typeNum = parseInt(req.query.type);
    const baseQuery = {
        ...(isNaN(typeNum) ? {} : {
            action: typeNum
        }),
        ...(req.permissions.includes('developer') ? {} : {
            devOnly: { $ne: true }
        })
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
                        }
                    ]
                });
                baseQuery.user = checkUser?.uuid;
            }
        }
        else {
            const regex = {
                $regex: new RegExp(utils.escapeRegExp(query), 'i')
            };
            // const exactRegex = {
            //     $regex: new RegExp(`^${utils.escapeRegExp(query)}$`, 'i')
            // }
            baseQuery.$or = [
                { target: regex },
                { content: regex }
            ]
        }
    }

    const data = await utils.pagination(req, AuditLog, baseQuery, '_id', '_id', {
        limit: 100
    });
    for(let item of data.items) {
        item.createdAt = item._id.getTimestamp();

        if(item.action === AuditLogTypes.DeleteThread) {
            item.thread = await Thread.findOne({
                uuid: item.content
            })
                .select('url topic -_id')
                .lean();
            delete item.content;
        }
        else if(item.action === AuditLogTypes.ThreadACL) {
            item.thread = await Thread.findOne({
                uuid: item.target
            })
                .select('url topic -_id')
                .lean();
            delete item.target;
        }
    }
    data.items = await utils.findUsers(req, data.items);
    data.items = await utils.findUsers(req, data.items, 'targetUser');
    data.items = utils.withoutKeys(data.items, ['__v']);

    for(let item of data.items) {
        if(item.diffOld && item.diffNew)
            item.hasDiff = true;
        else
            delete item._id;
        delete item.diffOld;
        delete item.diffNew;
    }

    res.renderSkin('감사 로그', {
        contentName: 'admin/auditLog',
        serverData: data
    });
});

app.get('/admin/audit_log/:id/diff', middleware.permission('config'), async (req, res) => {
    const log = await AuditLog.findOne({
        ...(req.permissions.includes('developer') ? {} : {
            devOnly: { $ne: true }
        }),
        _id: req.params.id
    });
    if(!log) return res.status(404).send('로그를 찾을 수 없습니다.');
    if(!log.diffOld || !log.diffNew) return res.status(400).send('비교할 내용이 없습니다.');

    if(log.devOnly && !req.permissions.includes('developer'))
        return res.status(403).send('invalid_permission');

    return res.json(utils.onlyKeys(await utils.generateDiff(log.diffOld, log.diffNew), ['diffHtml']));
});

app.get('/admin/initial_setup', middleware.permission('developer'), async (req, res) => {
    const docAcl = await ACL.get({ namespace: '문서' });
    const hasAclGroup = await ACLGroup.exists();

    res.renderSkin('초기 설정', {
        contentName: 'admin/initialSetup',
        serverData: {
            namespaces: config.namespaces,
            hasNsacl: !!docAcl.aclTypes[ACLTypes.Read].length,
            hasAclGroup: !!hasAclGroup,
            useEmailVerification: config.use_email_verification,
            useCaptcha: config.captcha.enabled,
            useSearchEngine: !!global.documentIndex,
            useRedis: process.env.USE_REDIS === 'true',
            useS3: !!(process.env.S3_ENDPOINT && process.env.S3_BUCKET_NAME && process.env.S3_PUBLIC_HOST)
        }
    });
});

app.post('/admin/initial_setup/remove_all_nsacl', middleware.permission('developer'), async (req, res) => {
    await ACLModel.deleteMany({
        namespace: {
            $exists: true
        }
    });
    res.reload();
});

app.get('/admin/manage_account', middleware.permission('manage_account'), async (req, res) => {
    let targetUser;

    if(req.query.uuid) {
        targetUser = await User.findOne({
            uuid: req.query.uuid,
            type: UserTypes.Account
        });
    }
    let query = req.query.query?.toString();
    if(query && !query.includes(':')) {
        targetUser = await User.findOne({
            name: {
                $regex: new RegExp(`^${utils.escapeRegExp(query)}$`, 'i')
            }
        });
        if(targetUser) return res.redirect('/admin/manage_account?uuid=' + targetUser.uuid);
    }

    let searchData;
    if(targetUser) {
        if(targetUser.permissions.includes('developer')
            && !req.permissions.includes('developer'))
            return res.status(403).send('invalid_permission');

        const auditLogContent = {
            user: req.user.uuid,
            action: AuditLogTypes.ManageAccount,
            targetUser: targetUser.uuid
        }
        const prevAuditLog = await AuditLog.exists({
            ...auditLogContent,
            _id: { $gt: mongoose.Types.ObjectId.createFromTime(Date.now() / 1000 - 60 * 10) }
        });
        if(!prevAuditLog) await AuditLog.create(auditLogContent);
    }
    else if(query) {
        const queryData = {
            type: UserTypes.Account
        };
        const queryHasColon = query.includes(':');
        const queryType = queryHasColon
            ? query.split(':')[0]
            : 'name';
        if(queryHasColon)
            query = query.slice(queryType.length + 1);

        switch(queryType) {
            case 'name':
                queryData.name = {
                    $regex: new RegExp(utils.escapeRegExp(query), 'i')
                }
                break;
            case 'email':
                queryData.email = query;
                break;
            case 'perm':
                queryData.permissions = query;
                break;
            case 'skin':
                queryData.skin = query;
                break;
        }

        searchData = await utils.pagination(req, User, queryData, 'uuid', 'createdAt', {
            getTotal: true
        });
        searchData.items = utils.onlyKeys(searchData.items, ['uuid', 'name']);
    }

    res.renderSkin('계정 관리', {
        contentName: 'admin/manageAccount',
        serverData: {
            searchData,
            verifyEnabled: config.verify_enabled && global.plugins.mobileVerify.length,
            targetUser: targetUser && {
                ...utils.onlyKeys(targetUser, [
                    'uuid', 'name', 'email', 'usePasswordlessLogin'
                ]),
                mobileVerified: targetUser.permissions.includes('mobile_verified_member'),
                useTotp: !!targetUser.totpToken
            }
        }
    });
});

app.post('/admin/manage_account',
    body('uuid')
        .isUUID()
        .custom(async (value, { req }) => {
            const targetUser = await User.findOne({
                uuid: value,
                type: UserTypes.Account
            });
            if(!targetUser) throw new Error('account_not_found');
            if(targetUser.permissions.includes('developer')
                && !req.permissions.includes('developer'))
                throw new Error('invalid_permission');

            req.body.targetUser = targetUser;
        }),
    body('name')
        .if((value, { req }) => value !== req.body.targetUser.name)
        .custom(async (value) => {
            const existingUser = await User.exists({
                name: {
                    $regex: new RegExp(`^${value}$`, 'i')
                }
            });
            if(existingUser) throw new Error('사용자 이름이 이미 존재합니다.');
        }),
    body('email')
        .if((value, { req }) => value !== req.body.targetUser.email)
        .isEmail()
        .normalizeEmail()
        .custom(async (value) => {
            const existingUser = await User.findOne({
                email: value
            });
            if(existingUser) throw new Error(`이미 ${namumarkUtils.escapeHtml(existingUser.name)} 사용자가 사용중인 이메일입니다.`);
        }),
    middleware.fieldErrors,
    middleware.permission('manage_account'), async (req, res) => {
    const targetUser = req.body.targetUser;

    const editedKeys = [];

    if(req.body.name !== targetUser.name) {
        editedKeys.push('name');
        await changeNameAction(targetUser, req.body.name, req.user);
    }

    const newUser = {};

    if(req.body.email !== targetUser.email)
        newUser.email = req.body.email;
    if((req.body.usePasswordlessLogin === 'Y') !== targetUser.usePasswordlessLogin)
        newUser.usePasswordlessLogin = req.body.usePasswordlessLogin === 'Y';
    if(targetUser.totpToken && req.body.useTotp !== 'Y')
        newUser.totpToken = null;

    await User.updateOne({
        uuid: targetUser.uuid
    }, newUser);

    editedKeys.push(...Object.keys(newUser));

    if(editedKeys.length) await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.ManageAccount,
        targetUser: targetUser.uuid,
        content: `edit:${editedKeys.join(', ')}`
    });

    res.reload();
});

app.post('/admin/manage_account/action',
    body('uuid')
        .isUUID(),
    body('action')
        .isString(),
    middleware.permission('manage_account'), async (req, res) => {
    const targetUser = await User.findOne({
        uuid: req.body.uuid
    });
    if(!targetUser) return res.status(404).send('account_not_found');

    let isInvalid = false;
    try {
        switch(req.body.action) {
            case 'resetLastNameChange': {
                await User.updateOne({
                    uuid: targetUser.uuid
                }, {
                    lastNameChange: 0
                });
                break;
            }
            case 'resetLastActivity': {
                await User.updateOne({
                    uuid: targetUser.uuid
                }, {
                    lastActivity: 0
                });
                break;
            }
            case 'resetPasswordLink': {
                const changePasswordToken = randomstring.generate({
                    charset: 'hex',
                    length: 64
                });
                await User.updateOne({
                    uuid: targetUser.uuid
                }, {
                    changePasswordToken,
                    lastChangePassword: Date.now()
                });
                return res.redirect(`/member/recover_password/auth/${targetUser.name}/${changePasswordToken}`);
            }
            case 'deleteAccount': {
                await withdrawAction(targetUser, req.user);
                return res.reload();
            }
            case 'getPhoneNumber': {
                return res.partial({
                    phoneNumber: targetUser.phoneNumber
                });
            }
            case 'removePhoneNumber': {
                await User.updateOne({
                    uuid: targetUser.uuid
                }, {
                    $unset: {
                        phoneNumber: 1
                    },
                    $pull: {
                        permissions: 'mobile_verified_member'
                    }
                });
                return res.reload();
            }
            default:
                isInvalid = true;
                return res.status(400).send('invalid_action');
        }
    } finally {
        if(!isInvalid) await AuditLog.create({
            user: req.user.uuid,
            action: AuditLogTypes.ManageAccount,
            targetUser: targetUser.uuid,
            content: `action:${req.body.action}`
        });
    }

    res.status(204).end();
});

module.exports = app;