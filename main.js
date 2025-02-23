const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { instrument } = require('@socket.io/admin-ui');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const passport = require('passport');
const session = require('express-session');
const fs = require('fs');
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
const axios = require('axios');
const util = require('util');

global.debug = process.env.NODE_ENV === 'development';

const utils = require('./utils');
const globalUtils = require('./utils/global');
const namumarkUtils = require('./utils/namumark/utils');
const types = require('./utils/types');
const { UserTypes, permissionMenus, AllPermissions, LoginHistoryTypes } = types;
const minifyManager = require('./utils/minifyManager');

const User = require('./schemas/user');
const AutoLoginToken = require('./schemas/autoLoginToken');
const RequestLog = require('./schemas/requestLog');
const LoginHistory = require('./schemas/loginHistory');

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
                publicConfig.site_name,
                '휴지통',
                ...(global.serverConfig.namespaces ?? [])
            ])]
        }
    }
});

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

global.MeiliSearch = new meiliSearch.MeiliSearch({
    host: process.env.MEILISEARCH_HOST,
    apiKey: process.env.MEILISEARCH_KEY
});

global.documentIndex = MeiliSearch.index(process.env.MEILISEARCH_INDEX);

global.resetSearchIndex = async () => {
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
    global.publicConfig = JSON.parse(fs.readFileSync('./publicConfig.json').toString());
    global.serverConfig = JSON.parse(fs.readFileSync('./serverConfig.json').toString());
    global.devConfig = JSON.parse(fs.readFileSync('./devConfig.json').toString());
    global.stringConfig = JSON.parse(fs.readFileSync('./stringConfig.json').toString());

    if(config.use_email_verification) global.mailTransporter = nodemailer.createTransport(config.smtp_settings);

    global.skins = fs.readdirSync('./skins');
}
updateConfig();

try {
    execSync('git --version');
} catch(e) {
    console.error('git not found');
    process.exit(1);
}
global.versionInfo = {
    branch: execSync('git rev-parse --abbrev-ref HEAD').toString().trim(),
    commitId: execSync('git rev-parse HEAD').toString().trim(),
    commitDate: new Date(Number(execSync('git log -1 --format="%at"').toString().trim()) * 1000),
    versionData: JSON.parse(fs.readFileSync('./version.json').toString()),
    updateRequired: false
};
global.newVersionInfo = { ...global.versionInfo };
global.newCommits = [];

global.checkUpdate = async () => {
    const githubAPI = axios.create({
        baseURL: `https://api.github.com/repos/${global.versionInfo.versionData.repo}`,
        headers: {
            ...(config.github_api_token ? {
                Authorization: `token ${config.github_api_token}`
            } : {})
        }
    });

    let newCommits;
    let newVerionData;
    try {
        const { data: newCommitData } = await githubAPI.get(`/compare/${global.versionInfo.commitId}...${global.versionInfo.branch}`);
        newCommits = newCommitData.commits;
        const { data: newVersionFile } = await githubAPI.get('/contents/version.json');
        newVerionData = JSON.parse(Buffer.from(newVersionFile.content, 'base64').toString());
    } catch(e) {
        console.error('failed to fetch latest version info', e);
        return;
    }
    if(!newCommits.length) {
        global.newVersionInfo.lastUpdateCheck = new Date();
        return;
    }

    global.newCommits = newCommits.reverse();
    global.newVersionInfo = {
        ...global.versionInfo,
        commitId: newCommits[newCommits.length - 1].sha,
        commitDate: new Date(newCommits[newCommits.length - 1].commit.committer.date),
        versionData: newVerionData,
        updateRequired: newVerionData.lastForceUpdate > global.versionInfo.versionData.lastForceUpdate,
        lastUpdateCheck: new Date()
    };

    if(global.versionInfo.commitId !== global.newVersionInfo.commitId
        && (global.newVersionInfo.updateRequired || config.auto_update)) {
        console.log('auto updating...');
        global.updateEngine();
    }
}

if(config.check_update !== false) {
    setInterval(checkUpdate, 1000 * 60 * 60);
    checkUpdate().then();
}

global.updateEngine = (exit = true) => {
    try {
        exec('git pull --recurse-submodules', (err, stdout, stderr) => {
            if(err) console.error(err);
            if(stdout) console.log(stdout);
            if(stderr) console.error(stderr);
            if(exit) process.exit(0);
            else global.skinCommitId = {};
        });
    } catch(e) {}
}

global.plugins = {
    macro: [],
    skinData: []
};
global.reloadPlugins = () => {
    for(let key in plugins) plugins[key] = [];

    const loadPlugins = dir => {
        if(!fs.existsSync(dir)) return;

        const files = fs.readdirSync(dir);
        for(let f of files) {
            if(f.endsWith('.js')) {
                const pluginPath = require.resolve(path.resolve(dir, f));
                delete require.cache[pluginPath];
                const plugin = require(pluginPath);
                plugins[plugin.type].push(plugin);
            }
            else loadPlugins(path.join(dir, f));
        }
    }
    loadPlugins('./plugins');
}
reloadPlugins();

const NamumarkParser = require('./utils/namumark');
global.NamumarkParser = NamumarkParser;

require('./schemas')();

if(!fs.existsSync('./cache')) fs.mkdirSync('./cache');
if(!fs.existsSync('./customStatic')) fs.mkdirSync('./customStatic');

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
if(debug) instrument(SocketIO, {
    auth: false,
    mode: 'development'
});

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
        imgSrc: ["'self'", 'data:', 'secure.gravatar.com', '*.googletagmanager.com', '*.google-analytics.com', '*.' + new URL(config.base_url).hostname.split('.').slice(-2).join('.'), ...(debug ? ['*'] : [])],
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
    const filename = req.path.split('/').pop();

    const blacklist = ['ejs', 'vue'];
    if(!filename.includes('.') || blacklist.some(a => req.url.endsWith('.' + a))) next();

    if(config.minify.js && filename.endsWith('.js')) return minifyManager.handleSkinJS(filename, req, res, next);
    if(config.minify.css && filename.endsWith('.css')) return minifyManager.handleSkinCSS(filename, req, res, next);

    skinsStatic(req, res, next);
});

app.use(express.urlencoded({
    extended: true,
    limit: '10mb'
}));

let store;
if(process.env.USE_REDIS === 'true') {
    const client = redis.createClient({
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
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

    if(req.session.ipUser?.ip !== req.ip)
        req.session.ipUser = null;
    if(!req.session.ipUser) {
        req.session.ipUser = await User.findOne({
            ip: req.ip
        }).lean();

        if(!req.session.ipUser && req.method === 'POST' && !req.url.startsWith('/member')) {
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

    if(req.user) {
        if(req.session.lastIp !== req.ip) {
            req.session.lastIp = req.ip;
            setTimeout(async () => {
                const oldHistory = await LoginHistory.findOne({
                    uuid: req.user.uuid,
                    ip: req.ip,
                    createdAt: {
                        $gt: Date.now() - 1000 * 60 * 60
                    }
                });
                if(!oldHistory) await LoginHistory.create({
                    uuid: req.user.uuid,
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    type: LoginHistoryTypes.IPChange
                });
            }, 0);
        }
    }

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

    for(let util in globalUtils) {
        app.locals[util] = globalUtils[util];
    }

    await utils.makeACLData(req);

    const isDev = req.permissions.includes('developer');
    app.locals.isDev = isDev;

    if(isDev) for(let perm of AllPermissions) {
        if(!req.permissions.includes(perm)) req.permissions.push(perm);
    }

    let skin = req.user?.skin;
    if(!skin || skin === 'default') skin = config.default_skin;
    if(!global.skins.includes(skin)) skin = global.skins[0];

    res.renderSkin = (...args) => renderSkin(...args).then();

    const renderSkin = async (title, data = {}) => {
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

        const page = {
            title,
            viewName: viewName ?? '',
            menus: [],
            data: utils.withoutKeys(data, [
                'contentName',
                'contentHtml',
                'categoryHtml',
                'serverData'
            ])
        }

        if(viewName === 'wiki') {
            data.copyright_text = config.copyright_text;
            if(data.document) {
                const nsKey = `namespace.${data.document.namespace}.copyright_text`;
                if(config[nsKey]) data.serverData.copyright_text = config[nsKey];
            }
        }

        const sessionMenus = [];
        for(let [key, value] of Object.entries(permissionMenus)) {
            if(req.permissions.includes(key)) {
                sessionMenus.push(...value);
            }
        }

        const session = {
            menus: sessionMenus,
            account: {
                name: req.user?.name ?? req.ip,
                uuid: req.user?.uuid,
                type: req.user?.type ?? UserTypes.IP
            },
            gravatar_url: req.user?.avatar,
            user_document_discuss: req.user?.lastUserDocumentDiscuss?.getTime() ?? null,
            quick_block: req.permissions.includes('admin'),
            ...(req.permissions.includes('no_force_captcha') ? {
                disable_captcha: true
            } : {})
        }

        const browserGlobalVarScript = `
<script id="initScript" nonce="${res.locals.cspNonce}">
window.CONFIG = ${JSON.stringify({
            ...Object.fromEntries(Object.entries(publicConfig).filter(([k]) => !k.startsWith('skin.') || k.startsWith(`skin.${skin}.`))),
            ...(config.captcha.enabled ? {
                captcha: {
                    type: config.captcha.type,
                    site_key: config.captcha.site_key
                }
            } : {})
        })}
window.page = ${JSON.stringify(page)}
window.session = ${JSON.stringify(session)}

document.getElementById('initScript')?.remove();
        `.trim().replaceAll('/', '\\/') + '\n</script>';

        if(data.contentHtml) data.contentText = utils.removeHtmlTags(data.contentHtml);

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
<b>[주의!]</b> 문서의 이전 버전(${globalUtils.getFullDateTag(data.serverData.rev.createdAt)}에 수정)을 보고 있습니다. <a href="${globalUtils.doc_action_link(data.document, 'w')}">최신 버전으로 이동</a>
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
        app.render('main', {
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
            addHistoryData: (rev, document) => utils.addHistoryData(rev, isAdmin, document)
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
        status
    });

    res.reload = anchor => {
        const url = new URL(req.get('Referrer') || config.base_url);
        if(anchor) url.searchParams.set('anchor', anchor);
        res.redirect(url.pathname + url.search);
    }

    res.originalRedirect = res.redirect;
    res.redirect = (...args) => {
        const target = args.pop();
        const url = new URL(target, 'http://' + req.hostname);
        if(req.query.f) url.searchParams.set('f', req.query.f);
        res.originalRedirect(...args, url.pathname + url.search);
    }

    const url = req.url;
    if(!['/admin/config', '/admin/developer'].some(a => url.startsWith(a))) for(let item of global.disabledFeatures) {
        if(item.method !== 'ALL' && item.method !== req.method) continue;

        if(item.type === 'string' && !req.url.startsWith(item.condition)) continue;
        if(item.type === 'js' && !eval(item.condition)) continue;

        const msg = item.message || '비활성화된 기능입니다.';

        let messageType = item.messageType;
        if(messageType === 'flexible') {
            if(req.method === 'GET') messageType = 'res.error';
            else messageType = 'plaintext';
        }
        if(messageType === 'res.error') return res.error(msg, 403);
        if(messageType === 'plaintext') return res.status(403).send(msg);
    }

    req.flash = Object.keys(req.session.flash ?? {}).length ? req.session.flash : {};
    req.session.flash = {};

    next();

    if(req.method !== 'GET' && !req.url.startsWith('/member') && req.user?.type === UserTypes.Account)
        User.updateOne({
            uuid: req.user.uuid
        }, {
            lastActivity: new Date()
        }).then();
});

for(let f of fs.readdirSync('./routes')) {
    app.use(require(`./routes/${f}`));
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