const express = require('express');
const passport = require('passport');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dayjs = require('dayjs');
const nodemailer = require('nodemailer');
const cheerio = require('cheerio');
const compression = require('compression');
const useragent = require('express-useragent');
const { Address4 } = require('ip-address');
const redis = require('redis');
const RedisStore = require('connect-redis').default;

const utils = require('./utils');
const globalUtils = require('./utils/global');
const namumarkUtils = require('./utils/namumark/utils');
const types = require('./utils/types');
const { UserTypes, permissionMenus } = types;
const minifyManager = require('./utils/minifyManager');

const User = require('./schemas/user');
const History = require('./schemas/history');

const ACL = require('./class/acl');

global.publicConfig = {};
global.serverConfig = {};
global.stringConfig = {};

Object.defineProperty(global, 'config', {
    get() {
        return {
            ...global.publicConfig,
            ...global.serverConfig,
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

global.updateConfig = () => {
    global.publicConfig = JSON.parse(fs.readFileSync('./publicConfig.json').toString());
    global.serverConfig = JSON.parse(fs.readFileSync('./serverConfig.json').toString());
    global.stringConfig = JSON.parse(fs.readFileSync('./stringConfig.json').toString());

    if(config.use_email_verification) global.mailTransporter = nodemailer.createTransport(config.smtp_settings);

    global.skins = fs.readdirSync('./skins');
}
updateConfig();

require('dotenv').config();

global.debug = process.env.NODE_ENV === 'development';

require('./schemas')();

if(!fs.existsSync('./cache')) fs.mkdirSync('./cache');
if(!fs.existsSync('./customStatic')) fs.mkdirSync('./customStatic');

const app = express();
global.expressApp = app;

app.set('trust proxy', process.env.TRUST_PROXY === 'true');

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

if(!debug) {
    app.use(compression());
}
app.use(express.static(`./customStatic`));

if(config.minify.js || config.minify.css) {
    minifyManager.check();
}
app.use((req, res, next) => {
    if(config.minify.js && req.url.endsWith('.js')
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

app.use(session({
    name: 'kotori',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store
}));

app.use(passport.initialize());
app.use(passport.session());

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

    res.setHeader('Etag', global.globalUtilsEtag);
    res.end(global.globalUtilsCache);
});

app.use(async (req, res, next) => {
    const slicedIp = req.ip.slice(7);
    if(Address4.isValid(slicedIp)) Object.defineProperty(req, 'ip', {
        get() {
            return slicedIp;
        }
    });

    if(!req.session.ipUser) {
        req.session.ipUser = await User.findOne({
            ip: req.ip
        }).lean();

        if(!req.session.ipUser) {
            const newUser = new User({
                ip: req.ip,
                type: UserTypes.IP
            });
            await newUser.save();
            req.session.ipUser = newUser.toJSON();
        }
    }

    if(!req.user && req.session.ipUser) req.user = req.session.ipUser;

    app.locals.rmWhitespace = true;

    app.locals.fs = fs;
    app.locals.path = path;
    app.locals.dayjs = dayjs;

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

    req.permissions = req.user?.permissions ?? [];

    req.permissions.unshift('any');

    if(req.user?.type === UserTypes.Account) {
        req.permissions.unshift('member');
        if(req.user.createdAt < Date.now() - 1000 * 60 * 60 * 24 * 15)
            req.permissions.push('member_signup_15days_ago');
    }
    else req.permissions.unshift('ip');

    if(req.useragent.isBot) req.permissions.push('bot');

    if(req.session.contributor) req.permissions.push('contributor');
    else {
        const contribution = await History.exists({
            user: req.user.uuid
        });
        if(contribution) {
            req.permissions.push('contributor');
            req.session.contributor = true;
        }
    }

    req.permissions = [...new Set(req.permissions)];
    req.displayPermissions = req.permissions.filter(a => ![
        'any',
        'contributor',
        'member_signup_15days_ago'
    ].includes(a));

    // TODO perms:
    //  document_contributor(at document middleware)
    //  contributor(using revision history)
    //  match_username_and_document_title(at document middleware)

    req.aclData = {
        permissions: req.permissions,
        user: req.user,
        ip: req.ip
    }

    app.locals.isDev = req.permissions .includes('developer');

    let skin = req.user?.skin;
    if(!skin || skin === 'default') skin = config.default_skin;

    res.renderSkin = (title, data = {}) => {
        const viewName = data.viewName || null;
        if (viewName) delete data.viewName;

        let sendOnlyContent = req.get('Sec-Fetch-Dest') === 'empty';
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
            user_document_discuss: null,
            quick_block: false
        }

        const browserGlobalVarScript = `
<script id="initScript">
window.CONFIG = ${JSON.stringify(publicConfig)}
window.page = ${JSON.stringify(page)}
window.session = ${JSON.stringify(session)}

window.defaultConfig = {
    'wiki.theme': 'auto'
}

document.getElementById('initScript')?.remove();
</script>
        `.trim();

        if(data.contentHtml) data.contentText = utils.removeHtmlTags(data.contentHtml);

        if(data.contentHtml && req.query.from && req.path.startsWith('/w/')) {
            data.contentHtml = `
<div class="thetree-alert thetree-alert-primary">
<div class="thetree-alert-content">
<a href="/w/${encodeURIComponent(req.query.from)}?noredirect=1" rel="nofollow" title="${req.query.from}">${namumarkUtils.escapeHtml(req.query.from)}</a>에서 넘어옴
</div>
</div>
        `.replaceAll('\n', '').trim() + data.contentHtml;
        }

        if(data.categoryHtml) {
            data.contentHtml = data.categoryHtml + data.contentHtml;
        }

        app.render('main', {
            ...data,
            ...(data.serverData ?? {}),
            skin,
            page,
            session,
            browserGlobalVarScript
        }, async (err, html) => {
            if(err) {
                console.error(err);
                return res.status(500).send('스킨 렌더 오류');
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

            if(sendOnlyContent) {
                const $ = cheerio.load(html);
                res.send(browserGlobalVarScript + $('#content').html());
            }
            else res.send(html);
        });
    }

    next();
});

for(let f of fs.readdirSync('./routes')) {
    app.use(require(`./routes/${f}`));
}

app.use((req, res, next) => {
    const fromFetch = req.get('Sec-Fetch-Dest') === 'empty';
    if(fromFetch) res.status(404).send(`not found: ${req.method} ${req.path}`);
    else next();
});

app.use((err, req, res, _) => {
    console.error(err);
    if(debug) res.status(500).send(err.toString());
    else res.status(500).send('서버 오류');
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});