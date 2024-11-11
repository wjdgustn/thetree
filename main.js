const express = require('express');
const passport = require('passport');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const nodemailer = require('nodemailer');
const cheerio = require('cheerio');
const compression = require('compression');
const useragent = require('express-useragent');

const utils = require('./utils');

const globalUtils = require('./utils/global');

global.publicConfig = {};
global.serverConfig = {};

Object.defineProperty(global, 'config', {
    get() {
        return {
            ...global.publicConfig,
            ...global.serverConfig
        }
    }
});

global.updateConfig = () => {
    global.publicConfig = JSON.parse(fs.readFileSync('./publicConfig.json').toString());
    global.serverConfig = JSON.parse(fs.readFileSync('./serverConfig.json').toString());

    global.mailTransporter = nodemailer.createTransport(config.smtp_settings);
}
updateConfig();

const User = require('./schemas/user');

require('dotenv').config();

global.debug = process.env.NODE_ENV === 'development';

require('./schemas')();

const app = express();

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
app.use(express.static(`./public${debug ? '' : './public/dist'}`));

const skinsStatic = express.static('./skins');
app.use('/skins', (req, res, next) => {
    const filename = req.path.split('/').pop();

    const blacklist = ['ejs', 'vue'];
    if(!filename.includes('.') || blacklist.some(a => req.url.endsWith('.' + a))) next();

    skinsStatic(req, res, next);
});

app.use(express.urlencoded({
    extended: true
}));

app.use(session({
    name: 'kotori',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

for(let f of fs.readdirSync('./login')) {
    require(`./login/${f}`)(passport);
}

app.use(useragent.express());

app.get('/js/global.js', (req, res) => {
    res.send(
        'globalUtils = {\n'
        + Object.keys(globalUtils)
            .map(k => `${globalUtils[k].toString()}`)
            .join(',\n')
            .split('\n')
            .map(a => a.trim())
            .join('\n')
        + '\n}'
    );
});

app.use((req, res, next) => {
    app.locals.rmWhitespace = true;

    app.locals.fs = fs;
    app.locals.path = path;
    app.locals.dayjs = dayjs;

    app.locals.__dirname = __dirname;

    app.locals.req = req;
    app.locals.user = req.user;
    app.locals.env = process.env;
    app.locals.config = config;

    app.locals = {
        ...app.locals,
        ...globalUtils
    }

    req.permissions = req.user?.permissions ?? [];

    req.permissions.push('any');

    if(req.isAuthenticated()) {
        req.permissions.push('member');
        if(req.user.createdAt < Date.now() - 1000 * 60 * 60 * 24 * 15)
            req.permissions.push('member_signup_15days_ago');
    }
    else req.permissions.push('ip');

    if(req.useragent.isBot) req.permissions.push('bot');

    // TODO perms:
    //  document_contributor(at document middleware)
    //  contributor(using revision history)
    //  match_username_and_document_title(at document middleware)

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

        app.render('main', {
            ...data,
            skin,
            page: {
                title,
                viewName: viewName ?? '',
                menus: [],
                data: utils.withoutKeys(data, [
                    'contentName',
                    'contentHtml'
                ])
            },
            session: {
                menus: [],
                account: {
                    name: req.user?.name ?? req.ip,
                    uuid: req.user?.uuid,
                    type: Number(req.isAuthenticated())
                },
                gravatar_url: req.user?.avatar,
                user_document_discuss: null,
                quick_block: false
            }
        }, (err, html) => {
            if(err) {
                console.error(err);
                return res.status(500).send('Skin render error');
            }

            if(sendOnlyContent) {
                const $ = cheerio.load(html);
                res.send($('#content').html());
            }
            else res.send(html);
        });
    }

    next();
});

for(let f of fs.readdirSync('./routes')) {
    app.use(require(`./routes/${f}`));
}

const port = process.env.port ?? 3000;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});