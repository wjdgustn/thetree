const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const passport = require('passport');
const session = require('express-session');
const fs = require('fs-extra');
const path = require('path');
const querystring = require('querystring');
const crypto = require('crypto');
const dayjs = require('dayjs');
const nodemailer = require('nodemailer');
const cheerio = require('cheerio');
const compression = require('compression');
const useragent = require('express-useragent');
const { Address4 } = require('ip-address');
const redis = require('redis');
const RedisStore = require('connect-redis').default;
const { colorFromUuid } = require('uuid-color');
const aws = require('@aws-sdk/client-s3');
const meiliSearch = require('meilisearch');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const axios = require('axios');
const util = require('util');
const msgpack = require('@msgpack/msgpack');

global.debug = process.env.NODE_ENV === 'development';
global.__THETREE__ = {};

const utils = require('./utils');
const globalUtils = require('./utils/global');
const namumarkUtils = require('./utils/newNamumark/utils');
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
const minifyManager = require('./utils/minifyManager');

const User = require('./schemas/user');
const AutoLoginToken = require('./schemas/autoLoginToken');
const RequestLog = require('./schemas/requestLog');
const LoginHistory = require('./schemas/loginHistory');
const Notification = require('./schemas/notification');

const ACL = require('./class/acl');

global.publicConfig = {};
global.serverConfig = {};
global.devConfig = {};
global.stringConfig = {};

Object.defineProperty(global, 'config', {
    get() {
        return {
            ...global.publicConfig,
            ...global.serverConfig,
            ...global.devConfig,
            ...global.stringConfig,
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
            ])]
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

    global.publicConfig = JSON.parse(fs.readFileSync(configPath('publicConfig.json')).toString());
    global.serverConfig = JSON.parse(fs.readFileSync(configPath('serverConfig.json')).toString());
    global.devConfig = JSON.parse(fs.readFileSync(configPath('devConfig.json')).toString());
    global.stringConfig = JSON.parse(fs.readFileSync(configPath('stringConfig.json')).toString());

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

    global.skins = fs.readdirSync('./skins').filter(a => !a.startsWith('.'));
    global.skinInfos = {};
    for(let skin of global.skins) {
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
}, 1000 * 10);

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
            updateRequired: newVersionData.lastForceUpdate > global.versionInfo.versionData.lastForceUpdate,
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

global.updateSkins = async (names = []) => {
    const failed = [];
    await Promise.allSettled(names.map(async name => {
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
        }

        const ssrModules = Object.keys(require.cache).filter(a => a.startsWith(path.resolve(skinPath)));
        for(let module of ssrModules) delete require.cache[module];

        global.updateSkinInfo();
    }));

    return { failed };
}
if(!global.skins.length)
    updateSkins(['plain']).then();

global.updateEngine = (exit = true) => {
    (async () => {
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
                        const installedSkins = await fs.readdir('./frontend/skins').filter(a => a !== 'plain');
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
    })()
}

global.plugins = {
    macro: [],
    skinData: [],
    editor: [],
    page: [],
    preHook: [],
    postHook: [],
    code: []
};
global.pluginPaths = {};
const pluginStaticPaths = [];
global.reloadPlugins = () => {
    for(let key in plugins) plugins[key] = [];
    global.pluginPaths = {};
    pluginStaticPaths.length = 0;

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

const parser = require('./utils/newNamumark/parser');
const toHtml = require('./utils/newNamumark/toHtml');
global.NamumarkParser = {
    parser,
    toHtml
};
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

global.permTokens = Object.fromEntries(AllPermissions.map(a => [a, crypto.randomBytes(16).toString('hex')]));

// app.set('trust proxy', process.env.TRUST_PROXY === 'true');

app.set('views', './views');
app.set('view engine', 'ejs');

passport.serializeUser((user, done) => {
    done(null, user.uuid);
});
passport.deserializeUser(async (uuid, done) => {
    const user = await User.findOne({ uuid }).lean();
    if(!user) return done(null, false);
    done(null, {
        ...user,
        avatar: utils.getGravatar(user.email)
    });
});

app.use(cookieParser());

app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(32).toString('hex');
    next();
});

app.use((req, res, next) => {
    const directives = {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, "'unsafe-eval'", 'www.google.com', 'challenges.cloudflare.com', '*.googletagmanager.com'],
        imgSrc: ["'self'", 'data:', 'secure.gravatar.com', '*.googletagmanager.com', '*.google-analytics.com', 'i.ytimg.com', '*.' + new URL(config.base_url).hostname.split('.').slice(-2).join('.'), ...(debug ? ['*'] : [])],
        styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'],
        frameSrc: ["'self'", 'www.youtube.com', 'www.google.com', 'challenges.cloudflare.com', 'embed.nicovideo.jp'],
        connectSrc: ["'self'", '*.googletagmanager.com', '*.google-analytics.com', '*.analytics.google.com'],
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
app.use(express.static(`./customStatic`));

if(config.minify.js || config.minify.css) {
    minifyManager.check();
}
app.use((req, res, next) => {
    if(req.url.startsWith('/js/perm') || req.url.startsWith('/css/perm')) {
        const perm = req.url.split('/')[3];
        if(global.permTokens[perm] !== req.query.token) return res.status(403).end();
        next();
    }
    else if(config.minify.js && req.url.endsWith('.js')
        || config.minify.css && req.url.endsWith('.css'))
        express.static(`./publicMin`)(req, res, next);
    else next();
});
app.use(express.static(`./public`));

const skinsStatic = express.static('./skins');
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
    else {
        const blacklist = ['ejs', 'vue'];
        if(!filename.includes('.') || blacklist.some(a => req.url.endsWith('.' + a))) return next();

        if(config.minify.js && filename.endsWith('.js')) return minifyManager.handleSkinJS(filename, req, res, next);
        if(config.minify.css && filename.endsWith('.css')) return minifyManager.handleSkinCSS(filename, req, res, next);

        skinsStatic(req, res, next);
    }
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
        if(!req.session?.passport) {
            const token = await AutoLoginToken.findOne({
                token: req.cookies.honoka
            });
            if(token) req.session.passport = {
                user: token.uuid
            }
        }

        res.cookie('honoka', req.cookies.honoka, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365,
            sameSite: 'lax'
        });
    }

    next();
});

app.use(passport.initialize());
app.use(passport.session());
SocketIO.engine.use(onlyForHandshake(passport.session()));

for(let f of fs.readdirSync('./login')) {
    require(`./login/${f}`)(passport);
}

app.use(useragent.express());

app.get('/js/global.js', (req, res) => {
    if(!global.globalUtilsCache) {
        global.globalUtilsCache = 'globalUtils = {\n'
            + Object.keys(globalUtils)
                .map(k => `${globalUtils[k].toString()}`)
                .join(',\n')
                .split('\n')
                .map(a => a.trim())
                .join('\n')
            + '\n}';
        global.globalUtilsEtag = crypto.createHash('sha256').update(global.globalUtilsCache).digest('hex');
    }

    res.setHeader('Content-Type', 'text/javascript');
    res.setHeader('Etag', global.globalUtilsEtag);
    res.end(global.globalUtilsCache);
});

const skinFiles = {};

app.use(async (req, res, next) => {
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

    req.session.sessionId ??= crypto.randomUUID();

    if(req.session.ipUser?.ip !== req.ip)
        req.session.ipUser = null;
    if(!req.session.ipUser) {
        req.session.ipUser = await User.findOne({
            ip: req.ip
        }).lean();

        if(!req.session.ipUser
            && req.method === 'POST'
            && !['/member/', '/preview/'].some(a => req.url.startsWith(a) || req.url.startsWith('/internal' + a))) {
            const newUser = new User({
                ip: req.ip,
                type: UserTypes.IP
            });
            await newUser.save();
            req.session.ipUser = newUser.toJSON();
            req.session.fullReload = true;
        }
    }

    if(!req.user && req.session.ipUser) req.user = req.session.ipUser;

    const log = new RequestLog({
        ip: req.ip,
        user: req.user?.uuid,
        method: req.method,
        url: req.originalUrl,
        body: Object.fromEntries(Object.entries(req.body).filter(([key]) => !key.includes('password')))
    });
    req.requestId = log._id.toString();
    log.save().then();

    app.locals.rmWhitespace = true;

    // app.locals.fs = fs;
    app.locals.path = path;
    app.locals.dayjs = dayjs;
    app.locals.colorFromUuid = colorFromUuid;
    app.locals.querystring = querystring;

    app.locals.getSkinFile = filename => {
        const files = skinFiles[skin] ??= {};
        files[filename] ??= fs.readFileSync(`./skins/${skin}/${filename.replaceAll('..', '')}`);
        return files[filename];
    }

    for(let t in types) {
        app.locals[t] = types[t];
    }

    app.locals.ACL = ACL;

    app.locals.__dirname = __dirname;

    app.locals.req = req;
    app.locals.user = req.user;
    app.locals.env = process.env;
    app.locals.config = config;

    app.locals.utils = utils;
    app.locals.namumarkUtils = namumarkUtils;

    for(let util in globalUtils) {
        app.locals[util] = globalUtils[util];
    }

    await utils.makeACLData(req);

    const isDev = req.permissions.includes('developer');
    app.locals.isDev = isDev;

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

    let skin = req.user?.skin;
    if(!skin || skin === 'default') skin = config.default_skin;
    if(!global.skins.includes(skin)) skin = global.skins[0];
    const skinInfo = global.skinInfos[skin];

    req.isInternal = req.url.split('/')[1] === 'internal';
    req.backendMode = skinInfo || req.isInternal;

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
            ...(req.permissions.includes('skip_captcha') ? {
                disable_captcha: true
            } : {}),
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
            } : {})
        }

        if(skinInfo || req.backendMode) {
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
        }

        configJSONstr = JSON.stringify(configJSON);
        sessionJSONstr = JSON.stringify(session);
    }

    const isBackendMode = req.isInternal || (debug && req.query.be);
    const getFEBasicData = () => {
        makeConfigAndSession();

        const userClientVersion = req.get('X-Chika');
        const clientVersion = skinInfo?.versionHeader;

        if(req.url !== '/sidebar' && isBackendMode && userClientVersion !== clientVersion && ((!debug && !config.testwiki) || userClientVersion !== 'bypass')) {
            res.originalStatus(400).end();
            return;
        }

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

        let sendOnlyContent = req.fromFetch;
        if(data.fullReload || req.session.fullReload) {
            sendOnlyContent = false;

            delete data.fullReload;
            delete req.session.fullReload;
        }

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
                'categoryHtml',
                'serverData'
            ])
        }

        const browserGlobalVarScript = `
<script id="initScript" nonce="${res.locals.cspNonce}">
window.CONFIG = ${configJSONstr}
window.page = ${JSON.stringify(page)}
window.session = ${sessionJSONstr}

document.getElementById('initScript')?.remove();
        `.trim().replaceAll('/', '\\/') + '\n</script>';

        if(data.contentHtml) data.contentText = globalUtils.removeHtmlTags(data.contentHtml);

        if(data.categoryHtml) {
            data.contentHtml = data.categoryHtml + data.contentHtml;
        }

        if(data.contentHtml && req.query.from && req.path.startsWith('/w/')) {
            data.contentHtml = `
<div class="thetree-alert thetree-alert-primary">
<div class="thetree-alert-content">
<a href="/w/${encodeURIComponent(req.query.from)}?noredirect=1" rel="nofollow" title="${req.query.from}">${namumarkUtils.escapeHtml(req.query.from)}</a>에서 넘어옴
</div>
</div>
        `.replaceAll('\n', '').trim() + data.contentHtml;
        }

        if(data.contentHtml && data.rev) {
            data.contentHtml = `
<div class="thetree-alert thetree-alert-danger">
<div class="thetree-alert-content">
<b>[주의!]</b> 문서의 이전 버전(${globalUtils.getFullDateTag(data.date)}에 수정)을 보고 있습니다. <a href="${globalUtils.doc_action_link(data.document, 'w')}">최신 버전으로 이동</a>
</div>
</div>
        `.replaceAll('\n', '').trim() + data.contentHtml;
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

        const isAdmin = req.permissions.includes('admin');
        if(isBackendMode || skinInfo) {
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
                    ...pluginData
                },
                ...basicData
            }

            if(isBackendMode) res.json(resData);
            else {
                const render = require(`./skins/${skin}/server/server.cjs`).render;
                const rendered = await render(req.originalUrl, resData, require(`./skins/${skin}/client/.vite/ssr-manifest.json`));
                let body = rendered.html;
                if(rendered.state) {
                    body += `<script nonce="${res.locals.cspNonce}">window.INITIAL_STATE='${Buffer.from(msgpack.encode(JSON.parse(JSON.stringify(rendered.state)))).toString('base64')}'</script>`;
                }
                const html = skinInfo.template
                    .replace('<html>', `<html${rendered.head.htmlAttrs}>`)
                    .replace('<!--app-head-->', rendered.head.headTags + '\n' + (config.head_html?.replaceAll('{cspNonce}', res.locals.cspNonce) || '') + rendered.links)
                    .replace('<!--app-body-->', body);

                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.status(status).send(html);
            }
        }
        else app.render('main', {
            ...data,
            ...(data.serverData ?? {}),
            ...pluginData,
            skin,
            page,
            session,
            browserGlobalVarScript,
            cspNonce: res.locals.cspNonce,
            userHtml: (user, data) => utils.userHtml(user, {
                ...data,
                isAdmin
            }),
            addHistoryData: (rev, document) => utils.addHistoryData(req, rev, isAdmin, document, req.backendMode)
        }, async (err, html) => {
            if(err) {
                console.error(err);
                RequestLog.updateOne({
                    _id: req.requestId
                }, {
                    error: util.inspect(err, { depth: 2, maxArrayLength: 200 })
                }).then();
                return res.status(500).send('스킨 렌더 오류<br>요청 ID: ' + req.requestId);
            }

            // if(config.minify.html) {
            //     if(debug) console.time('minifyHtml');
            //     try {
            //         html = await minifyHtml(html, {
            //             collapseWhitespace: true
            //         });
            //     } catch (e) {}
            //     if(debug) console.timeEnd('minifyHtml');
            // }

            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

            if(sendOnlyContent) {
                const $ = cheerio.load(html);
                res.status(status).send(browserGlobalVarScript + $('#content').html());
            }
            else res.status(status).send(html);
        });
    }

    res.error = (contentHtml, status = 400) => res.renderSkin('오류', {
        contentHtml,
        status,
        serverData: {
            document: req.document ?? undefined
        }
    });

    res.reload = (anchor, usingUrl = false) => {
        if(req.backendMode && !usingUrl) {
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
        const url = new URL(target, 'http://' + req.hostname);
        if(req.query.f) url.searchParams.set('f', req.query.f);

        const finalUrl = url.pathname + url.search + url.hash;
        if(req.isInternal) res.json({
            code: 302,
            url: finalUrl
        });
        else res.originalRedirect(...args, finalUrl);
    }

    let url = req.url;
    if(url.startsWith('/internal/')) url = url.replace('/internal', '');
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
            const basicData = getFEBasicData();
            if(!basicData) return;

            const responseData = JSON.parse(JSON.stringify(data));
            res.originalSend(Buffer.from(msgpack.encode({
                ...basicData,
                ...responseData
            })));

            (async () => {
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
    }

    if(!['/admin/config', '/admin/developer'].some(a => url.startsWith(a))) {
        for(let item of global.disabledFeatures) {
            if(item.method !== 'ALL' && item.method !== req.method) continue;

            if(item.type === 'string' && !url.startsWith(item.condition)) continue;
            if(item.type === 'js' && !eval(item.condition)) continue;

            const msg = (item.message || '비활성화된 기능입니다.')
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
            if(res.headersSent) return;
        }
    }

    req.flash = Object.keys(req.session.flash ?? {}).length ? req.session.flash : {};
    req.session.flash = {};

    if(req.method === 'GET') {
        let urlPath = req.path;
        if(urlPath.endsWith('/')) urlPath = urlPath.slice(0, -1);
        if(urlPath.startsWith('/internal/')) urlPath = urlPath.slice('/internal'.length);
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
});

for(let f of fs.readdirSync('./routes')) {
    const route = require(`./routes/${f}`);
    app.use(route.router ?? route);
    app.use('/internal', route.router ?? route);
}

app.use((req, res, next) => {
    const fromFetch = req.get('Sec-Fetch-Dest') === 'empty';
    if(fromFetch) res.status(404).send(`not found: ${req.method} ${req.path}`);
    else if(config.not_found_html) res.send(config.not_found_html);
    else next();
});

app.use((err, req, res, _) => {
    console.error(`Server error from: ${req.method} ${req.originalUrl}`, err);
    if(debug || req.permissions?.includes('developer')) res.status(500).send(err.toString());
    else res.status(500).send('서버 오류<br>요청 ID: ' + req.requestId);

    RequestLog.updateOne({
        _id: req.requestId
    }, {
        error: util.inspect(err, { depth: 2, maxArrayLength: 200 })
    }).then();
});

const port = process.env.PORT ?? 3000;
server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});