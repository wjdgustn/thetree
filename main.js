const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const session = require('express-session');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const compression = require('compression');
const useragent = require('express-useragent');
const { Address4 } = require('ip-address');
const redis = require('redis');
const RedisStore = require('connect-redis').default;
const aws = require('@aws-sdk/client-s3');
const meiliSearch = require('meilisearch');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const axios = require('axios');
const util = require('util');
const msgpack = require('@msgpack/msgpack');
const JSON5 = require('json5');
const { lookup: ipLookup } = require('ip-location-api');
const mongoose = require('mongoose');
const zlib = require('zlib');
const deflate = promisify(zlib.deflate);
const i18next = require('i18next');
const i18nBackend = require('i18next-fs-backend');
const i18nMiddleware = require('i18next-http-middleware');

global.debug = process.env.NODE_ENV === 'development';
global.__THETREE__ = {};

const utils = require('./utils');
const globalUtils = require('./utils/global');
const namumarkUtils = require('./utils/namumark/utils');
const migrateCodes = require('./utils/migrate');
const types = require('./utils/types');
const {
    UserTypes,
    permissionMenus,
    AllPermissions,
    NoGrantPermissions,
    LoginHistoryTypes,
    NotificationTypes
} = types;

const User = require('./schemas/user');
const AutoLoginToken = require('./schemas/autoLoginToken');
const RequestLog = require('./schemas/requestLog');
const LoginHistory = require('./schemas/loginHistory');
const Notification = require('./schemas/notification');

const ACL = require('./class/acl');

const langDetector = new i18nMiddleware.LanguageDetector();
langDetector.addDetector({
    name: 'configDetector',
    lookup() {
        if(!config.lang) return
        return config.lang
    }
})

i18next
    .use(i18nBackend)
    .use(langDetector)
    .init({
        detection: {
            order: ['cookie', 'configDetector', 'header'],
            lookupCookie: 'thetree.lang',
            cookieExpirationDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365)
        },
        preload: fs.readdirSync('./locale').filter(a => a.endsWith('.json')).map(a => a.replace('.json', '')),
        fallbackLng: 'ko',
        backend: {
            loadPath: './locale/{{lng}}.json'
        },
        initAsync: false,
        showSupportNotice: false
    });
global.i18next = i18next;

global.publicConfig = {};
global.serverConfig = {};
global.devConfig = {};
global.stringConfig = {};

Object.defineProperty(global, 'config', {
    get() {
        const configObject = {
            ...global.publicConfig,
            ...global.serverConfig,
            ...global.devConfig,
            ...global.stringConfig
        }
        if(!configObject.lang) console.trace();
        return {
            ...configObject,
            namespaces: [...new Set([
                '문서',
                '틀',
                '분류',
                '파일',
                '사용자',
                '삭제된사용자',
                // publicConfig.site_name,
                // '휴지통',
                ...(global.serverConfig.namespaces ?? [])
            ])],
            localNamespaces: i18next.getResourceBundle(configObject.lang || i18next.language).namespaces
        }
    }
});

if(!fs.existsSync('./cache')) fs.mkdirSync('./cache');
if(!fs.existsSync('./customStatic')) fs.mkdirSync('./customStatic');

const disabledFeaturesPath = './cache/disabledFeatures.json';
global.disabledFeatures = fs.existsSync(disabledFeaturesPath) ? JSON.parse(fs.readFileSync(disabledFeaturesPath).toString()) : [];

require('dotenv').config();

global.S3 = new aws.S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    }
});

if(process.env.MEILISEARCH_HOST)  {
    global.MeiliSearch = new meiliSearch.MeiliSearch({
        host: process.env.MEILISEARCH_HOST,
        apiKey: process.env.MEILISEARCH_KEY
    });
    global.documentIndex = MeiliSearch.index(process.env.MEILISEARCH_INDEX);
}

global.resetSearchIndex = async () => {
    if(!global.MeiliSearch) return;

    await MeiliSearch.deleteIndex(process.env.MEILISEARCH_INDEX);
    await MeiliSearch.createIndex(process.env.MEILISEARCH_INDEX);
    global.documentIndex = MeiliSearch.index(process.env.MEILISEARCH_INDEX);
    await documentIndex.updateSettings({
        searchableAttributes: [
            'choseong',
            'title',
            'content',
            'raw'
        ],
        filterableAttributes: [
            'namespace',
            'title',
            'anyoneReadable'
        ]
    });
}

global.updateConfig = () => {
    const configPath = str => process.env.IS_DOCKER ? `./config/${str}` : `./${str}`;

    const configs = [
        'publicConfig.json',
        'serverConfig.json',
        'devConfig.json',
        'stringConfig.json'
    ];
    for(let c of configs) {
        if(fs.existsSync(configPath(c))) continue;

        fs.copyFileSync(c.replace('.json', '.example.json'), configPath(c));
    }

    global.publicConfig = JSON5.parse(fs.readFileSync(configPath('publicConfig.json')).toString());
    global.serverConfig = JSON5.parse(fs.readFileSync(configPath('serverConfig.json')).toString());
    global.devConfig = JSON5.parse(fs.readFileSync(configPath('devConfig.json')).toString());
    global.stringConfig = JSON5.parse(fs.readFileSync(configPath('stringConfig.json')).toString());

    if(config.use_email_verification) global.mailTransporter = nodemailer.createTransport(config.smtp_settings);

    updateSkinInfo();
}

const versionData = JSON.parse(fs.readFileSync('./version.json').toString());
global.versionData = versionData;
global.updateSkinInfo = () => {
    if(!fs.existsSync('./frontend/.git')) {
        console.log('Downloading frontend...');
        const result = execSync(`git clone ${new URL(versionData.feRepo, 'https://github.com')} frontend`);
        console.log(result.toString());
        const npmResult = execSync('npm i --production=false', { cwd: './frontend' });
        console.log(npmResult.toString());
    }
    if(!fs.existsSync('./skins')) fs.mkdirSync('./skins');

    const skinDir = fs.readdirSync('./skins').filter(a => !a.startsWith('.'));
    global.skinInfos = {};
    for(let skin of skinDir) {
        const metadataPath = path.join('./skins', skin, 'metadata.json');
        const isSPA = fs.existsSync(metadataPath);
        if(!isSPA) continue;

        const templatePath = path.join('./skins', skin, 'client/index.html');
        global.skinInfos[skin] = {
            ...JSON.parse(fs.readFileSync(metadataPath).toString()),
            template: fs.readFileSync(templatePath).toString()
        }
    }
}
updateConfig();

try {
    execSync('git --version');
} catch(e) {
    console.error('git not found');
    process.exit(1);
}
global.versionInfo = {
    branch: (process.env.GIT_BRANCH ?? execSync('git rev-parse --abbrev-ref HEAD')).toString().trim(),
    commitId: (process.env.GIT_COMMIT_ID ?? execSync('git rev-parse HEAD')).toString().trim(),
    commitDate: new Date(Number((process.env.GIT_COMMIT_DATE ?? execSync('git log -1 --format="%at"').toString()).trim()) * 1000),
    versionData,
    updateRequired: false
};
global.updateFEVersionInfo = () => {
    global.versionInfo = {
        ...global.versionInfo,
        feBranch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: './frontend' }).toString().trim(),
        feCommitId: execSync('git rev-parse HEAD', { cwd: './frontend' }).toString().trim(),
        feCommitDate: new Date(Number(execSync('git log -1 --format="%at"', { cwd: './frontend' }).toString().trim()) * 1000)
    }
}
updateFEVersionInfo();
global.newVersionInfo = { ...global.versionInfo };
global.newCommits = [];
global.newFECommits = [];

if(!fs.existsSync('./cache/lastNotificationCheck.json')) {
    fs.writeFileSync('./cache/lastNotificationCheck.json', JSON.stringify({
        timestamp: fs.existsSync('./cache/minifyCache.json') ? 0 : Date.now()
    }));
}
if(!fs.existsSync('./cache/lastMigrationTime.json')) {
    fs.writeFileSync('./cache/lastMigrationTime.json', JSON.stringify({
        timestamp: fs.existsSync('./cache/minifyCache.json') ? 0 : Date.now()
    }));
}

let didMigrate = false;
global.scheduleMigration = () => {
    if(didMigrate) return;

    setTimeout(() => {
        const lastMigrationTime = JSON.parse(fs.readFileSync('./cache/lastMigrationTime.json').toString()).timestamp;
        for(let code of migrateCodes.filter(a => a.timestamp > lastMigrationTime)) {
            (async () => {
                await code.code();
            })()
        }
        fs.writeFileSync('./cache/lastMigrationTime.json', JSON.stringify({
            timestamp: Date.now()
        }));
    }, 0);
}

global.checkUpdate = async (manually = false) => {
    try {
        const lastNotificationCheck = JSON.parse(fs.readFileSync('./cache/lastNotificationCheck.json').toString());

        const { data } = await axios.get('/engine/notification', {
            baseURL: versionData.officialWiki,
            params: {
                after: lastNotificationCheck.timestamp
            }
        });
        await Promise.all(data.map(a => Notification.create({
            type: NotificationTypes.Owner,
            user: 'developer',
            createdAt: a.createdAt,
            data: a.content
        })));
        fs.writeFileSync('./cache/lastNotificationCheck.json', JSON.stringify({
            timestamp: Date.now()
        }));
    } catch(e) {}

    if(!manually && config.check_update === false) return;

    const githubAPI = axios.create({
        baseURL: `https://api.github.com/repos`,
        headers: {
            ...(config.github_api_token ? {
                Authorization: `token ${config.github_api_token}`
            } : {})
        }
    });

    let newCommits = [];
    let newFECommits = [];
    let newVersionData;
    if(!process.env.IS_DOCKER) try {
        const { data: newCommitData } = await githubAPI.get(`${global.versionInfo.versionData.repo}/compare/${global.versionInfo.commitId}...${global.versionInfo.branch}`);
        newCommits = newCommitData.commits;
        const { data: newVersionFile } = await githubAPI.get(`${global.versionInfo.versionData.repo}/contents/version.json`, {
            params: {
                ref: global.versionInfo.branch
            }
        });
        newVersionData = JSON.parse(Buffer.from(newVersionFile.content, 'base64').toString());
    } catch(e) {
        console.error('failed to fetch latest version info', e);
    }
    try {
        const { data: newFECommitData } = await githubAPI.get(`${global.versionInfo.versionData.feRepo}/compare/${global.versionInfo.feCommitId}...${global.versionInfo.feBranch}`);
        newFECommits = newFECommitData.commits;
    } catch(e) {
        console.error('failed to fetch latest FE commit info', e);
    }
    if(!newCommits.length && !newFECommits.length) {
        global.newVersionInfo.lastUpdateCheck = new Date();
        return;
    }

    const commitMapper = a => ({
        html_url: a.html_url,
        sha: a.sha,
        commit: {
            message: a.commit.message,
            author: {
                name: a.commit.author.name
            }
        },
        author: {
            html_url: a.author.html_url
        }
    });

    global.newCommits = newCommits.map(commitMapper).reverse();
    global.newFECommits = newFECommits.map(commitMapper).reverse();
    global.newVersionInfo = {
        ...global.versionInfo,
        ...(newCommits.length ? {
            commitId: newCommits[newCommits.length - 1].sha,
            commitDate: new Date(newCommits[newCommits.length - 1].commit.committer.date),
            versionData: newVersionData,
            updateRequired: newVersionData?.lastForceUpdate > global.versionInfo.versionData.lastForceUpdate,
        } : {}),
        ...(newFECommits.length ? {
            feCommitId: newFECommits[newFECommits.length - 1].sha,
            feCommitDate: new Date(newFECommits[newFECommits.length - 1].commit.committer.date)
        } : {}),
        lastUpdateCheck: new Date()
    }

    if((global.versionInfo.commitId !== global.newVersionInfo.commitId
            || global.versionInfo.feCommitId !== global.newVersionInfo.feCommitId)
        && (global.newVersionInfo.updateRequired || config.auto_update)) {
        console.log('auto updating...');
        global.updateEngine();
    }
}

setInterval(checkUpdate, 1000 * 60 * 60);
if(config.check_update !== false)
    checkUpdate().then();

global.updatingSkins = [];
global.updateSkins = async (names = []) => {
    const failed = [];
    await Promise.allSettled(names.map(async name => {
        if(global.updatingSkins.includes(name)) return;
        global.updatingSkins.push(name);

        const skinPath = path.join('./skins', name);

        try {
            const opts = {
                cwd: './frontend',
                env: {
                    ...process.env,
                    SKIN_NAME: name,
                    METADATA_PATH: path.resolve(skinPath)
                }
            }
            await execPromise(`npx vite build --emptyOutDir --outDir "${path.resolve(skinPath, 'server')}" --ssr src/server.js`, opts);
            await execPromise(`npx vite build --emptyOutDir --outDir "${path.resolve(skinPath, 'client')}" --ssrManifest`, opts);
        } catch(e) {
            console.error(e);
            failed.push(name);
            return;
        } finally {
            global.updatingSkins = global.updatingSkins.filter(a => a !== name);
        }

        const ssrModules = Object.keys(require.cache).filter(a => a.startsWith(path.resolve(skinPath)));
        for(let module of ssrModules) delete require.cache[module];

        global.updateSkinInfo();
    }));

    return { failed };
}
if(!Object.keys(global.skinInfos).length)
    updateSkins(['plain']).then();

global.updatingEngine = false;
global.updateEngine = (exit = true) => {
    (async () => {
        global.updatingEngine = true;
        try {
            const packageHash = () => crypto.createHash('sha256').update(fs.readFileSync('./package.json')).digest('hex');
            const fePackageHash = () => crypto.createHash('sha256').update(fs.readFileSync('./frontend/package.json')).digest('hex');
            const oldPackageHash = packageHash();
            const oldFEPackageHash = fePackageHash();

            const doEngine = global.versionInfo.commitId !== global.newVersionInfo.commitId;
            const doFE = global.versionInfo.feCommitId !== global.newVersionInfo.feCommitId;

            const results = await Promise.all([
                ...(doEngine ? [execPromise('git pull')] : []),
                ...(doFE ? [execPromise('git pull', { cwd: './frontend' })] : [])
            ]);
            for(let result of results) {
                console.log(result.stdout);
                console.error(result.stderr);
            }

            const newPackageHash = packageHash();
            const newFEPackageHash = fePackageHash();
            const packageUpdated = oldPackageHash !== newPackageHash;
            const fePackageUpdated = oldFEPackageHash !== newFEPackageHash;
            if(exit) {
                const onFinish = async () => {
                    if(doFE) {
                        const installedSkins = (await fs.readdir('./frontend/skins')).filter(a => a !== 'plain');
                        if(installedSkins.length)
                            await global.updateSkins(installedSkins);
                    }

                    if(doEngine) process.exit(0);
                    else updateFEVersionInfo();
                }
                if(packageUpdated) {
                    console.log('package.json updated, updating packages...');
                    exec('npm i', onFinish);
                }
                else if(fePackageUpdated) {
                    console.log('Frontend package.json updated, updating packages...');
                    exec('npm i --production=false', { cwd: './frontend' }, onFinish);
                }
                else await onFinish();
            }
            else global.skinCommitId = {};
        } catch(e) {}
        finally {
            global.updatingEngine = false;
        }
    })()
}

global.plugins = {
    macro: [],
    skinData: [],
    editor: [],
    page: [],
    preHook: [],
    postHook: [],
    code: [],
    mobileVerify: []
};
global.pluginPaths = {};
const pluginStaticPaths = [];
global.reloadPlugins = () => {
    for(let key in plugins) plugins[key] = [];
    global.pluginPaths = {};
    pluginStaticPaths.length = 0;
    global.__THETREE__.macros = [];

    const loadPlugins = dir => {
        if(!fs.existsSync(dir)) return;

        const files = fs.readdirSync(dir);
        for(let f of files) {
            if(f.endsWith('.js')) {
                const pluginPath = require.resolve(path.resolve(dir, f));
                delete require.cache[pluginPath];
                const plugin = require(pluginPath);

                if(!plugin.name) {
                    const pluginName = dir.split(path.sep).pop();
                    plugin.name = pluginName;
                }

                if(plugin.type === 'macro') {
                    plugin.path = pluginPath;
                    // plugins.macro.push(pluginPath);
                    global.__THETREE__.macros.push(plugin.name);
                }
                plugins[plugin.type].push(plugin);

                if(plugin.name) pluginPaths[plugin.name] = path.resolve(dir);

                if(plugin.type === 'code') setTimeout(async () => {
                    await plugin.code();
                }, 0);
            }
            else if(f === 'public') {
                if(dir.split(path.sep).length !== 2) continue;

                const folder = path.join(dir, f);
                const pluginName = dir.split(path.sep).pop();
                pluginStaticPaths.push({
                    pluginName,
                    middleware: express.static(folder)
                });
            }
            else if(!f.includes('.') && f !== 'node_modules' && f !== 'lib') {
                const nextPath = path.join(dir, f);
                const isDir = fs.lstatSync(nextPath).isDirectory();
                if(isDir) loadPlugins(nextPath);
            }
        }
    }
    loadPlugins('plugins');
}
reloadPlugins();

const parser = require('./utils/namumark/parser');
const toHtml = require('./utils/namumark/toHtml');
global.NamumarkParser = {
    parser,
    toHtml
};
namumarkUtils.loadMacros();
global.ACLClass = ACL;

require('./schemas')();

const app = express();
global.expressApp = app;

const server = http.createServer(app);

const onlyForHandshake = middleware => (req, res, next) => {
    const isHandshake = req._query.sid === undefined;
    if (isHandshake) {
        middleware(req, res, next);
    } else {
        next();
    }
}

global.SocketIO = new Server(server, {
    ...(debug ? {
        cors: {
            origin: 'https://admin.socket.io',
            credentials: true
        }
    } : {})
});
if(debug) {
    const { instrument } = require('@socket.io/admin-ui');
    instrument(SocketIO, {
        auth: false,
        mode: 'development'
    });
}

SocketIO.on('new_namespace', namespace => {
    namespace.use(async (socket, next) => {
        socket.request.ip = (process.env.IP_HEADER && socket.handshake.headers[process.env.IP_HEADER])
            ? socket.handshake.headers[process.env.IP_HEADER].split(',')[0]
            : socket.handshake.address;

        await utils.makeACLData(socket.request);

        next();
    });
});

// app.set('trust proxy', process.env.TRUST_PROXY === 'true');

app.use(cookieParser());

app.use(i18nMiddleware.handle(i18next));

app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(32).toString('hex');
    next();
});

app.use((req, res, next) => {
    const cdnUrl = '*.' + new URL(config.base_url).hostname.split('.').slice(-2).join('.');
    const directives = {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, "'unsafe-eval'", 'www.google.com', 'challenges.cloudflare.com', '*.googletagmanager.com', 'hcaptcha.com', '*.hcaptcha.com'],
        imgSrc: ["'self'", 'data:', 'secure.gravatar.com', '*.googletagmanager.com', '*.google-analytics.com', 'i.ytimg.com', cdnUrl, ...(debug ? ['*'] : [])],
        mediaSrc: ["'self'", cdnUrl, ...(debug ? ['*'] : [])],
        styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'hcaptcha.com', '*.hcaptcha.com'],
        fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'],
        frameSrc: ["'self'", 'www.youtube.com', 'www.google.com', 'challenges.cloudflare.com', 'embed.nicovideo.jp', 'hcaptcha.com', '*.hcaptcha.com', 'tv.naver.com'],
        connectSrc: ["'self'", '*.googletagmanager.com', '*.google-analytics.com', '*.analytics.google.com', 'hcaptcha.com', '*.hcaptcha.com'],
        ...(debug ? {
            upgradeInsecureRequests: null
        } : {})
    };

    if(config.content_security_policy) for(let key of Object.keys(config.content_security_policy)) {
        let arr = config.content_security_policy[key];
        if(!Array.isArray(arr)) arr = [arr];
        directives[key].push(...arr);
        directives[key] = [...new Set(directives[key])];
    }

    for(let plugin of Object.values(plugins).flat()) {
        if(!plugin.csp) continue;
        for(let key of Object.keys(plugin.csp)) {
            let arr = plugin.csp[key];
            if(!Array.isArray(arr)) arr = [arr];
            directives[key].push(...arr);
            directives[key] = [...new Set(directives[key])];
        }
    }

    helmet({
        contentSecurityPolicy: {
            directives
        },
        referrerPolicy: false,
        strictTransportSecurity: !debug
    })(req, res, next);
});

if(!debug) {
    app.use(compression());
}

app.use('/locale', express.static('./locale'));
app.use(express.static(`./customStatic`));
app.use(express.static(`./public`));

app.use('/skins', (req, res, next) => {
    const splittedPath = req.path.split('/');
    const skinName = splittedPath[1];
    const filename = splittedPath.pop();

    const skinInfo = global.skinInfos[skinName];
    if(skinInfo) {
        if(filename.endsWith('.html')) return next();

        req.url = req.url.slice(skinName.length + 2);
        express.static(`./skins/${skinName}/client`)(req, res, next);
    }
    else next();
});

app.use('/plugins/:pluginName', (req, res, next) => {
    const plugin = pluginStaticPaths.find(a => a.pluginName === req.params.pluginName);
    if(!plugin) return next();

    plugin.middleware(req, res, next);
});

app.use(express.urlencoded({
    extended: true,
    limit: '10mb'
}));
app.use(express.json({
    limit: '10mb'
}));

let store;
if(process.env.USE_REDIS === 'true') {
    const client = redis.createClient({
        socket: {
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT
        },
        password: process.env.REDIS_PASSWORD
    });
    client.connect().catch(console.error);

    store = new RedisStore({ client });
}

const sessionMiddleware = session({
    name: 'kotori',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store,
    rolling: true,
    cookie: {
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30
    }
});
app.use(sessionMiddleware);
SocketIO.engine.use(onlyForHandshake(sessionMiddleware));

app.use(async (req, res, next) => {
    if(req.cookies?.honoka) {
        if(!req.session?.loginUser) {
            const token = await AutoLoginToken.findOne({
                token: req.cookies.honoka
            });
            if(token) req.session.loginUser = token.uuid;
            else res.clearCookie('honoka');
        }

        res.cookie('honoka', req.cookies.honoka, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365,
            sameSite: 'lax'
        });
    }

    next();
});

const getUserMiddleware = async (req, res, next) => {
    if(req.session?.loginUser) {
        const user = await User.findOne({ uuid: req.session.loginUser }).lean();
        if(user) req.user = {
            ...user,
            avatar: utils.getGravatar(user.email)
        }
        else {
            delete req.session.contributor;
        }
    }
    next();
}
app.use(getUserMiddleware);
SocketIO.engine.use(onlyForHandshake(getUserMiddleware));

app.use(useragent.express());

app.use(async (req, res, next) => {
    let requestLogData;
    try {
        if(process.env.IP_HEADER && req.headers[process.env.IP_HEADER]) Object.defineProperty(req, 'ip', {
            get() {
                return req.headers[process.env.IP_HEADER].split(',')[0];
            }
        });

        if(!req.ip) return res.status(500).send('ip error');
        const slicedIp = req.ip.slice(7);
        if(Address4.isValid(slicedIp)) Object.defineProperty(req, 'ip', {
            get() {
                return slicedIp;
            }
        });
        req.countryCode = ipLookup(req.ip)?.country;
        if(!req.countryCode && debug)
            req.countryCode = 'KR';

        const referer = req.get('Referer');
        req.referer = null;
        if(referer) {
            try {
                req.referer = new URL(referer);
            } catch(e) {}
        }
        req.fromFetch = req.get('Sec-Fetch-Dest') === 'empty';

        const mobileHeader = req.get('Sec-CH-UA-Mobile');
        req.isMobile = mobileHeader ? mobileHeader === '?1' : req.useragent.isMobile;

        req.additionalServerData = {};

        req.session.sessionId ??= crypto.randomUUID();

        if(req.session.ipUser?.ip !== req.ip) {
            req.session.ipUser = null;
            delete req.session.contributor;
        }
        if(!req.session.ipUser && req.user?.type !== UserTypes.Account) {
            req.session.ipUser = await User.findOne({
                ip: req.ip
            }).lean();

            if(!req.session.ipUser
                && req.method === 'POST'
                && !['/member/', '/preview/'].some(a => req.url.startsWith(a))) {
                const newUser = new User({
                    ip: req.ip,
                    type: UserTypes.IP
                });
                await newUser.save();
                req.session.ipUser = newUser.toJSON();
            }
        }

        if(!req.user && req.session.ipUser) req.user = req.session.ipUser;

        requestLogData = new RequestLog({
            ip: req.ip,
            user: req.user?.uuid,
            method: req.method,
            url: req.originalUrl,
            body: Object.fromEntries(Object.entries(req.body ?? {}).filter(([key]) => !key.includes('password'))),
            userAgent: req.get('User-Agent')
        });
        req.requestId = requestLogData._id.toString();

        await utils.makeACLData(req);

        const isDev = req.permissions.includes('developer');

        if(isDev) for(let perm of AllPermissions) {
            if(!req.permissions.includes(perm) && !NoGrantPermissions.includes(perm))
                req.permissions.push(perm);
        }

        if(req.user?.type === UserTypes.Account) {
            if(!req.permissions.includes('hideip') && req.session.lastIp !== req.ip) {
                req.session.lastIp = req.ip;
                setTimeout(async () => {
                    const oldHistory = await LoginHistory.findOne({
                        uuid: req.user.uuid,
                        ip: req.ip,
                        createdAt: {
                            $gt: Date.now() - 1000 * 60 * 60
                        }
                    });
                    if(!oldHistory) await utils.createLoginHistory(req.user, req, {
                        type: LoginHistoryTypes.IPChange
                    });
                }, 0);
            }
        }

        let skin = req.user?.type === UserTypes.Account
            ? req.user?.skin
            : req.session.skin;
        if(!skin || skin === 'default') skin = config.default_skin;
        if(!global.skinInfos[skin]) skin = Object.keys(global.skinInfos)[0];
        const skinInfo = global.skinInfos[skin];

        if(!skinInfo) return res.status(500).send('skin not installed');

        req.skin = skin;

        const versionHeader = req.get('X-Chika');

        const firstPath = req.path.split('/')[1];
        const isPlainInternal = firstPath === 'internal';
        const isEncryptedInternal = firstPath === 'i';
        if(isEncryptedInternal && skinInfo.urlKey) {
            const urlKey = versionHeader === skinInfo.versionHeader
                ? skinInfo.urlKey
                : [...crypto.createHash('sha256').update(versionHeader ?? skinInfo.versionHeader).digest()];

            const urlChars = [
                ...[
                    ...[...Array(26)].map((a, i) => i + 97),
                    ...[...Array(26)].map((a, i) => i + 65),
                    ...[...Array(10)].map((a, i) => i + 48)
                ]
                    .map(a => String.fromCharCode(a)),
                '-',
                '_'
            ];
            utils.shuffleArray(urlChars, urlKey);

            const encryptedPath = req.path.slice('/i/'.length);

            let binary = '';
            for(let char of encryptedPath) {
                const index = urlChars.indexOf(char);
                binary += index.toString(2).padStart(6, '0');
            }

            const encryptedBytes = [];
            for(let i = 0; i < binary.length; i += 8) {
                const byte = binary.slice(i, i + 8);
                if(byte.length === 8) encryptedBytes.push(parseInt(byte, 2));
            }
            utils.deshuffleArray(encryptedBytes, urlKey);

            const decryptedStr = encryptedBytes.map((a, i) => String.fromCharCode(a ^ urlKey[i % urlKey.length])).join('');

            if(decryptedStr.startsWith(versionHeader) || decryptedStr.startsWith(skinInfo.versionHeader)) {
                const finalPath = decryptedStr.slice(versionHeader?.length ?? skinInfo.versionHeader.length);
                req.isInternal = true;
                req.url = req.url.replace(req.path, finalPath) || '/';
                req.path = finalPath || '/';

                requestLogData.decryptedUrl = req.url;
            }
        }
        else if(isPlainInternal && (debug || !skinInfo.urlKey || (versionHeader === 'bypass' && config.testwiki))) {
            req.isInternal = true;
            req.url = req.url.slice('/internal'.length) || '/';
            req.path = req.path.slice('/internal'.length) || '/';
        }

        res.setHeader('Accept-CH', 'Sec-CH-UA-Platform-Version, Sec-CH-UA-Model');

        let session;
        let configJSON;
        let configJSONstr;
        let sessionJSONstr;

        let notifications = [];

        if(req.user?.type === UserTypes.Account) {
            const queries = [{
                user: req.user.uuid
            }];
            if(req.permissions.includes('developer')) queries.push({
                user: 'developer'
            });
            notifications = await Notification.find({
                $or: queries,
                read: false
            })
                .select('uuid type read data createdAt -_id')
                .sort({ createdAt: -1 })
                .limit(5)
                .lean();
            notifications = await utils.notificationMapper(req, notifications, true);
        }

        const makeConfigAndSession = () => {
            const sessionMenus = [];
            for(let permMenus of [...plugins.page.map(a => a.menus).filter(a => a), permissionMenus])
                for(let [key, value] of Object.entries(permMenus)) {
                    if(req.permissions.includes(key)) {
                        sessionMenus.push(...value);
                    }
                }

            session = {
                menus: sessionMenus,
                account: {
                    name: req.user?.name ?? req.ip,
                    uuid: req.user?.uuid,
                    type: req.user?.type ?? UserTypes.IP
                },
                gravatar_url: req.user?.avatar,
                user_document_discuss: req.user?.lastUserDocumentDiscuss?.getTime() ?? null,
                quick_block: req.permissions.includes('admin'),
                notifications
            }

            configJSON = {
                ...Object.fromEntries([
                    ...Object.entries(publicConfig).filter(([k]) => debug || !k.startsWith('skin.')),
                    ...Object.entries(config).filter(([k]) => k.startsWith(`skin.${skin}.`) || k.startsWith('wiki.'))
                ]),
                ...(config.captcha.enabled ? {
                    captcha: {
                        type: config.captcha.type,
                        site_key: config.captcha.site_key
                    }
                } : {}),
                skins: Object.keys(global.skinInfos).filter(a => a !== 'plain')
            }

            const configMapper = {
                site_name: 'wiki.site_name',
                logo_url: 'wiki.logo_url',
                front_page: 'wiki.front_page',
                editagree_text: 'wiki.editagree_text',
                copyright_text: 'wiki.copyright_text',
                base_url: 'wiki.canonical_url',
                sitenotice: 'wiki.sitenotice'
            }
            for(let [key, value] of Object.entries(configMapper)) {
                const configVal = configJSON[key] ?? config[key];
                delete configJSON[key];
                if(!configVal) continue;
                configJSON[value] = configVal;
            }

            configJSONstr = JSON.stringify(configJSON);
            sessionJSONstr = JSON.stringify(session);
        }

        const getFEBasicData = () => {
            makeConfigAndSession();

            const userConfigHash = req.get('X-You');
            const configHash = crypto.createHash('md5').update(configJSONstr).digest('hex');

            const userSessionHash = req.get('X-Riko');
            const sessionHash = crypto.createHash('md5').update(sessionJSONstr).digest('hex');

            return {
                ...(userConfigHash !== configHash ? {
                    configHash,
                    config: Object.fromEntries(Object.entries(configJSON).map(([k, v]) => [k, typeof v === 'string' ? v.replaceAll('{cspNonce}', res.locals.cspNonce) : v]))
                } : {}),
                ...(userSessionHash !== sessionHash ? {
                    sessionHash,
                    session
                } : {})
            }
        }

        res.renderSkin = (...args) => renderSkin(...args).then();

        const renderSkin = async (title, data = {}) => {
            makeConfigAndSession();

            const status = data.status || 200;
            delete data.status;

            const viewName = data.viewName || null;
            if (viewName) delete data.viewName;

            if(viewName === 'wiki') {
                data.copyright_text = config.copyright_text;
                if(data.document) {
                    const nsKey = `namespace.${data.document.namespace}.copyright_text`;
                    if(config[nsKey]) data.copyright_text = config[nsKey];
                }
            }

            const page = {
                title: data.document ? globalUtils.doc_fulltitle(data.document) : title,
                viewName: viewName ?? '',
                menus: [],
                data: utils.withoutKeys(data, [
                    'contentName',
                    'contentHtml',
                    'serverData'
                ])
            }

            const pluginData = {};
            for(let plugin of plugins.skinData) {
                const output = await plugin.format({
                    data,
                    page,
                    session,
                    req
                });
                if(typeof output === 'object') Object.assign(pluginData, output);
            }

            const basicData = getFEBasicData();
            if(!basicData) return;

            const resData = {
                page: {
                    contentName: data.contentName || null,
                    contentHtml: data.contentHtml || null,
                    ...utils.onlyKeys(page, [
                        'title',
                        'viewName',
                        'menus'
                    ])
                },
                data: {
                    publicData: page.data,
                    ...(data.serverData ?? {}),
                    ...pluginData,
                    ...req.additionalServerData
                },
                ...basicData
            }

            if(req.isInternal) res.json(resData);
            else {
                const render = require(`./skins/${skin}/server/server.cjs`).render;
                const rendered = await render(req.originalUrl, resData, require(`./skins/${skin}/client/.vite/ssr-manifest.json`), req.i18n);
                let body = rendered.html;
                if(rendered.state) {
                    const deflated = await deflate(Buffer.from(msgpack.encode(JSON.parse(JSON.stringify(rendered.state)))));
                    body += `<script nonce="${res.locals.cspNonce}">window.INITIAL_STATE='${deflated.toString('base64')}'</script>`;
                }
                const html = skinInfo.template
                    .replaceAll('{cspNonce}', res.locals.cspNonce)
                    .replace('<html>', `<html${rendered.head.htmlAttrs}>`)
                    .replace('<!--app-head-->', rendered.head.headTags + '\n' + (config.head_html?.replaceAll('{cspNonce}', res.locals.cspNonce) || '') + rendered.links)
                    .replace('<!--app-body-->', body);

                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.status(status).send(html);
            }
        }

        res.error = (contentHtml, status = 400) => res.renderSkin(req.t('titles.error'), {
            contentHtml,
            status,
            serverData: {
                document: req.document ?? undefined
            }
        });

        res.reload = (anchor, usingUrl = false) => {
            if(!usingUrl) {
                res.json({
                    action: 'reloadView'
                });
            }
            else {
                const url = new URL(req.get('Referrer') || config.base_url);
                if(anchor) url.searchParams.set('anchor', anchor);
                res.redirect(url.pathname + url.search);
            }
        }

        res.originalRedirect = res.redirect;
        res.redirect = (...args) => {
            const target = args.pop();

            let finalUrl;
            if(target.startsWith('/')) {
                const url = new URL(target, 'http://' + req.hostname);
                if(req.query.f) url.searchParams.set('f', req.query.f);

                finalUrl = url.pathname + url.search + url.hash;
            }
            else {
                finalUrl = target;
            }
            if(req.isInternal) res.json({
                code: 302,
                url: finalUrl
            });
            else res.originalRedirect(...args, finalUrl);
        }

        let url = req.url;
        if(req.isInternal) {
            res.originalStatus = res.status;
            res.status = code => ({
                end: data => res.json({
                    code,
                    data
                }),
                send: data => res.json({
                    code,
                    data
                }),
                json: data => res.json({
                    code,
                    data
                })
            })

            res.originalSend = res.send;
            res.json = data => {
                res.jsonProcessing = true;

                (async () => {
                    const basicData = getFEBasicData();
                    if(!basicData) return;

                    const responseData = JSON.parse(JSON.stringify(data));
                    res.originalSend(await deflate(Buffer.from(msgpack.encode({
                        ...basicData,
                        ...responseData
                    }))));

                    for(let item of global.plugins.postHook) {
                        if(!item.includeError && (data.code && !['2', '3'].includes(data.code.toString()[0]))) continue;

                        if(item.method && item.method !== req.method) continue;
                        if(item.url) {
                            if(!url.startsWith(item.url)) continue;
                        }
                        else if(item.condition) {
                            try {
                                if(!item.condition(req)) continue;
                            } catch(e) {
                                console.error('error from postHook plugin condition:', e);
                                continue;
                            }
                        }
                        else {
                            console.warn('invalid postHook plugin detected:', item);
                            continue;
                        }
                        try {
                            await item.handler(req, responseData);
                        } catch (e) {
                            console.error('error from postHook plugin action:', e);
                        }
                    }
                })()
            }
            res.send = data => res.json({ data });

            res.partial = data => {
                let publicData;
                if(data.publicData) {
                    publicData = data.publicData;
                    delete data.publicData;
                }

                res.json({
                    partialData: {
                        publicData,
                        viewData: data
                    }
                });
            }

            if(req.method === 'GET'
                && (!versionHeader || req.url !== '/sidebar')
                && versionHeader !== skinInfo.versionHeader
                && ((!debug && !config.testwiki) || versionHeader !== 'bypass')) {
                res.originalStatus(400).end();
                return;
            }
        }

        if(!['/admin/config', '/admin/developer'].some(a => url.startsWith(a))) {
            if((config.read_only || (global.updatingEngine && !global.updatingSkins.length)) &&
                ([
                    '/edit/', '/move/', '/delete/', '/revert/',
                    '/member/login', '/member/logout', '/member/star/', '/member/unstar/'
                ].some(a => url.startsWith(a)) || req.method !== 'GET')) {
                if(req.method === 'GET') return res.error(req.t('errors.read_only'));
                else return res.status(403).send(req.t('errors.read_only'));
            }

            for(let item of global.disabledFeatures) {
                if(item.method !== 'ALL' && item.method !== req.method) continue;

                if(item.type === 'string'
                    && !url.toLowerCase().startsWith(item.condition.toLowerCase())) continue;
                if(item.type === 'js' && !eval(item.condition)) continue;

                const msg = (item.message || req.t('errors.disabled_feature'))
                    .replaceAll('{cspNonce}', res.locals.cspNonce);

                let messageType = item.messageType;
                if(messageType === 'flexible') {
                    if(req.method === 'GET') messageType = 'res.error';
                    else messageType = 'plaintext';
                }
                if(messageType === 'res.error') return res.error(msg, 403);
                if(messageType === 'plaintext') return res.status(403).send(msg);
            }

            for(let item of global.plugins.preHook) {
                if(item.method && item.method !== req.method) continue;
                if(item.url) {
                    if(!url.startsWith(item.url)) continue;
                }
                else if(item.condition) {
                    try {
                        if(!item.condition(req)) continue;
                    } catch(e) {
                        console.error('error from preHook plugin condition:', e);
                        continue;
                    }
                }
                else {
                    console.warn('invalid preHook plugin detected:', item);
                    continue;
                }
                try {
                    await item.handler(req, res);
                } catch (e) {
                    console.error('error from preHook plugin action:', e);
                }
                if(res.headersSent || res.jsonProcessing) return;
            }
        }

        req.flash = Object.keys(req.session.flash ?? {}).length ? req.session.flash : {};
        req.session.flash = {};

        if(req.method === 'GET') {
            let urlPath = req.path;
            if(urlPath.endsWith('/')) urlPath = urlPath.slice(0, -1);
            const pagePlugin = plugins.page.find(a => typeof a.url === 'string' ? a.url === urlPath : a.url(urlPath));
            if(pagePlugin) return pagePlugin.handler(req, res);
        }

        next();

        if(req.method === 'POST' && !req.url.startsWith('/member') && req.user?.type === UserTypes.Account)
            User.updateOne({
                uuid: req.user.uuid
            }, {
                lastActivity: new Date()
            }).then();
    } finally {
        requestLogData.save().then();
    }
});

for(let f of fs.readdirSync('./routes')) {
    const route = require(`./routes/${f}`);
    app.use(route.router ?? route);
    // app.use('/internal', route.router ?? route);
}

app.use((req, res, next) => {
    const fromFetch = req.get('Sec-Fetch-Dest') === 'empty';
    if(fromFetch) res.status(404).send(`not found: ${req.method} ${req.path}`);
    else if(config.not_found_html) res.send(config.not_found_html);
    else next();
});

app.use((err, req, res, _) => {
    console.error(`Server error from: ${req.method} ${req.originalUrl}(${req.url})`, err);
    const inspectedError = util.inspect(err, { depth: 2, maxArrayLength: 200 });
    if(debug || req.permissions?.includes('developer')) res.status(500).send(inspectedError);
    else res.status(500).send(req.t('errors.server_error') + ' ' + req.requestId);

    RequestLog.updateOne({
        _id: req.requestId
    }, {
        error: inspectedError
    }).then();
});

const port = process.env.PORT ?? 3000;
server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

global.exiting = false;
const exitHandler = async () => {
    if(global.exiting) return;
    global.exiting = true;
    console.log('exiting...');
    await new Promise(resolve => {
        server.close(() => {
            resolve();
        });
    });
    await mongoose.disconnect();
    process.exit(0);
}
process.on('SIGINT', exitHandler);
process.on('SIGTERM', exitHandler);