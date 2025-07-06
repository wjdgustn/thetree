const express = require('express');
const { body, param, validationResult, oneOf } = require('express-validator');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const passport = require('passport');
const { Address4, Address6 } = require('ip-address');
const randomstring = require('randomstring');
const { TOTP } = require('otpauth');
const QRCode = require('qrcode');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const {
    isoUint8Array,
    isoBase64URL
} = require('@simplewebauthn/server/helpers');
const axios = require('axios');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const middleware = require('../utils/middleware');
const {
    HistoryTypes,
    UserTypes,
    AuditLogTypes
} = require('../utils/types');

const User = require('../schemas/user');
const SignupToken = require('../schemas/signupToken');
const AutoLoginToken = require('../schemas/autoLoginToken');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');
const ThreadComment = require('../schemas/threadComment');
const EditRequest = require('../schemas/editRequest');
const Blacklist = require('../schemas/blacklist');
const Star = require('../schemas/star');
const Passkey = require('../schemas/passkey');
const Notification = require('../schemas/notification');
const AuditLog = require('../schemas/auditLog');

const app = express.Router();

app.get('/member/signup', middleware.isLogout, (req, res) => {
    res.renderSkin('계정 만들기', {
        contentName: 'member/signup',
        serverData: {
            terms: config.terms,
            emailWhitelist: config.email_whitelist
        }
    });
});

app.post('/member/signup',
    middleware.isLogout,
    body('email')
        .notEmpty().withMessage('이메일의 값은 필수입니다.')
        .isEmail().withMessage('이메일의 값을 형식에 맞게 입력해주세요.')
        .normalizeEmail(),
    body('agree').exists().withMessage('동의의 값은 필수입니다.'),
    middleware.fieldErrors,
    middleware.captcha,
    async (req, res) => {
    const emailDomain = req.body.email.split('@').pop();
    if(config.email_whitelist.length && !config.email_whitelist.includes(emailDomain))
        return res.status(400).send('이메일 허용 목록에 있는 이메일이 아닙니다.');

    let ipArr;
    if(Address4.isValid(req.ip)) ipArr = new Address4(req.ip).toArray();
    else ipArr = new Address6(req.ip).toByteArray();

    const aclGroups = await ACLGroup.find({
        noSignup: true
    });
    const aclGroupItem = await ACLGroupItem.findOne({
        aclGroup: {
            $in: aclGroups.map(group => group.uuid)
        },
        $or: [
            {
                expiresAt: {
                    $gte: new Date()
                }
            },
            {
                expiresAt: null
            }
        ],
        ipMin: {
            $lte: ipArr
        },
        ipMax: {
            $gte: ipArr
        }
    }).lean();
    if(aclGroupItem) {
        const aclGroup = aclGroups.find(group => group.uuid === aclGroupItem.aclGroup);
        return res.status(403).send(`${aclGroup.aclMessage
            ? aclGroup.aclMessage + ` (#${aclGroupItem.id})`    
            : `현재 사용중인 아이피가 ACL그룹 ${aclGroup.name} #${aclGroupItem.id}에 있기 때문에 계정 생성 권한이 부족합니다.`
        }<br>만료일 : ${aclGroupItem.expiresAt?.toString() ?? '무기한'}<br>사유 : ${aclGroupItem.note ?? '없음'}`);
    }

    const email = req.body.email;

    const checkBlacklist = await Blacklist.exists({
        email: crypto.createHash('sha256').update(email).digest('hex')
    });
    if(checkBlacklist) return res.status(403).send({
        fieldErrors: {
            email: {
                msg: '재가입 대기 기간 입니다.'
            }
        }
    });

    const checkUserExists = await User.exists({
        email
    });
    if(!!checkUserExists) {
        if(config.use_email_verification) {
            res.renderSkin('계정 만들기', {
                contentName: 'member/signup_email_sent',
                serverData: { email }
           });

            await mailTransporter.sendMail({
                from: config.smtp_sender,
                to: email,
                subject: `[${config.site_name}] 계정 생성 이메일 주소 인증`,
                html: `
안녕하세요. ${config.site_name} 입니다.
${config.site_name} 계정 생성 이메일 인증 메일입니다.
누군가 이 이메일로 계정 생성을 시도했지만 이미 이 이메일로 계정 생성이 되어있어서 더 이상 계정을 생성할 수 없습니다.

요청 아이피 : ${req.ip}
        `.trim().replaceAll('\n', '<br>')
            });
        }
        else res.status(409).send('이미 가입된 이메일입니다.');

        return;
    }

    const existingToken = await SignupToken.findOne({
        email
    });
    if(config.use_email_verification && existingToken && Date.now() - existingToken.createdAt < 1000 * 60 * 10)
        return res.status(409).json({
            fieldErrors: {
                email: {
                    msg: '해당 이메일로 이미 계정 생성 인증 메일을 보냈습니다.'
                }
            }
        });

    const existingIpToken = await SignupToken.findOne({
        ip: req.ip
    });
    if(config.use_email_verification && existingIpToken && Date.now() - existingIpToken.createdAt < 1000 * 60 * 10)
        return res.status(409).json({
            fieldErrors: {
                email: {
                    msg: '해당 아이피에서 이미 계정 생성이 진행 중입니다.'
                }
            }
        });

    await SignupToken.deleteMany({
        email
    });
    await SignupToken.deleteMany({
        ip: req.ip
    });

    const newToken = new SignupToken({
        email,
        ip: req.ip
    });
    await newToken.save();

    const signupUrl = `/member/signup/${newToken.token}`;
    if(config.use_email_verification) {
        res.renderSkin('계정 만들기', {
            contentName: 'member/signup_email_sent',
            serverData: { email }
        });

        await mailTransporter.sendMail({
            from: config.smtp_sender,
            to: email,
            subject: `[${config.site_name}] 계정 생성 이메일 주소 인증`,
            html: `
안녕하세요. ${config.site_name} 입니다.
${config.site_name} 계정 생성 이메일 인증 메일입니다.
직접 계정 생성을 진행하신 것이 맞다면 아래 링크를 클릭해서 계정 생성을 계속 진행해주세요.
<a href="${new URL(signupUrl, config.base_url)}">[인증]</a>
이 메일은 24시간동안 유효합니다.
요청 아이피 : ${req.ip}
        `.trim().replaceAll('\n', '<br>')
        });
    }
    else res.redirect(signupUrl);
});

app.get('/member/signup/:token', async (req, res) => {
    const token = await SignupToken.findOne({
        token: req.params.token
    });
    if(!token || Date.now() - token.createdAt > 1000 * 60 * 60 * 24) return res.error('인증 요청이 만료되었거나 올바르지 않습니다.');

    // if(token.ip && token.ip !== req.ip) return res.error('보안 상의 이유로 요청한 아이피 주소와 현재 아이피 주소가 같아야 합니다.');

    res.renderSkin('계정 만들기', {
        contentName: 'member/signup_final',
        serverData: {
            email: token.email,
            name: token.name
        }
    });
});

const nameChecker = field => body(field)
    .if(body(field).not().equals('special:bypass'))
    .notEmpty()
    .withMessage('사용자 이름의 값은 필수입니다.')
    .isLength({ min: 3, max: 32 })
    .withMessage('사용자 이름의 길이는 3자 이상 32자 이하입니다.')
    .custom(value => /^[a-zA-Z0-9_]+$/.test(value))
    .withMessage('사용자 이름은 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.')
    .custom(value => value[0].match(/[a-zA-Z]/))
    .withMessage('사용자 이름은 영문으로 시작해야 합니다.')
    .custom(async (value, {req}) => {
        const existingUser = await User.exists({
            name: {
                $regex: new RegExp(`^${value}$`, 'i')
            },
            ...(req.user ? {
                uuid: {
                    $ne: req.user.uuid
                }
            } : {})
        });
        if(existingUser) throw new Error('사용자 이름이 이미 존재합니다.');
    });
app.post('/member/signup/:token',
    nameChecker('username'),
    body('password')
        .notEmpty()
        .withMessage('비밀번호의 값은 필수입니다.'),
    body('password_confirm')
        .notEmpty()
        .withMessage('비밀번호 확인의 값은 필수입니다.')
        .custom((value, { req }) => value === req.body.password)
        .withMessage('패스워드 확인이 올바르지 않습니다.'),
    middleware.fieldErrors,
    async (req, res) => {
    const token = await SignupToken.findOne({
        token: req.params.token
    });
    if(!token
        || Date.now() - token.createdAt > 1000 * 60 * 60 * 24
        || (token.ip && token.ip !== req.ip)) return res.status(400).send('유효하지 않은 토큰');

    if(!!token.name !== (req.body.username === 'special:bypass')) return res.status(400).json({
        fieldErrors: {
            username: {
                msg: '사용자 이름이 유효하지 않습니다.'
            }
        }
    });

    const emailDupCheck = await User.exists({
        email: token.email
    });
    if(!!emailDupCheck) return res.status(409).json({
        fieldErrors: {
            email: {
                msg: '이메일이 이미 존재합니다.'
            }
        }
    });

    const name = token.name || req.body.username;
    const hash = await bcrypt.hash(req.body.password, 12);
    const newUserJson = {
        email: token.email,
        password: hash,
        name
    }

    const userExists = await User.exists({ type: UserTypes.Account });
    if(!userExists) {
        newUserJson.permissions = ['developer'];
        await global.resetSearchIndex();
    }

    const newUser = new User(newUserJson);
    await newUser.save();

    await SignupToken.deleteMany({
        email: token.email
    });

    const docJson = {
        namespace: '사용자',
        title: newUser.name
    }
    let dbDocument = await Document.findOne(docJson);
    dbDocument ??= await Document.create(docJson);

    await History.create({
        user: newUser.uuid,
        type: HistoryTypes.Create,
        document: dbDocument.uuid,
        content: ''
    });

    return req.login({
        ...newUser.toJSON(),
        avatar: utils.getGravatar(newUser.email)
    }, { keepSessionInfo: true }, async err => {
        if(err) console.error(err);

        await utils.createLoginHistory(newUser, req);

        if(!res.headersSent) {
            req.session.fullReload = true;
            delete req.session.contributor;
            return res.renderSkin('계정 만들기', {
                contentHtml: `<p>환영합니다! <b>${newUser.name}</b>님 계정 생성이 완료되었습니다.</p>`
            });
        }
    });
});

app.get('/member/login', middleware.isLogout, (req, res) => {
    if(!req.query.redirect && req.referer) {
        const url = new URL(req.url, config.base_url);
        url.searchParams.set('redirect', req.referer.pathname + req.referer.search);
        return res.redirect(url.pathname + url.search);
    }

    res.renderSkin('로그인', {
        contentName: 'member/login'
    });
});

app.post('/member/login',
    middleware.isLogout,
    body('email')
        .notEmpty()
        .withMessage('이메일의 값은 필수입니다.'),
    body('password')
        .notEmpty()
        .withMessage('비밀번호의 값은 필수입니다.'),
    middleware.fieldErrors,
    middleware.captcha,
    (req, res, next) => {
    passport.authenticate('local', async (err, user, info) => {
        if(err) {
            console.error(err);
            return res.status(500).send('서버 오류');
        }
        if(!user) return res.status(400).send(info.message);

        let trusted = req.session.trustedAccounts?.includes(user.uuid);

        if((!user.totpToken && !config.use_email_verification) || user.permissions.includes('disable_two_factor_login')) {
            trusted = true;
        }

        if(trusted) {
            if(req.body.autologin === 'Y') {
                const token = await AutoLoginToken.create({
                    uuid: user.uuid
                });
                res.cookie('honoka', token.token, {
                    httpOnly: true,
                    maxAge: 1000 * 60 * 60 * 24 * 365,
                    sameSite: 'lax'
                });
            }

            await utils.createLoginHistory(user, req)

            return req.login(user, { keepSessionInfo: true }, err => {
                if(err) console.error(err);
                if(!res.headersSent) {
                    req.session.fullReload = true;
                    delete req.session.contributor;
                    return res.redirect(req.body.redirect || '/');
                }
            });
        }

        const passkeys = await Passkey.find({
            user: user.uuid
        });
        const hasPasskey = user.totpToken && passkeys.length;

        let passkeyData = null;
        if(hasPasskey) {
            passkeyData = await generateAuthenticationOptions({
                rpID: new URL(config.base_url).hostname,
                allowCredentials: passkeys.map(a => ({
                    id: a.id,
                    transports: a.transports
                }))
            });
            req.session.passkeyAuthOptions = passkeyData;
        }

        req.session.pinUser = user.uuid;
        req.session.redirect = req.body.redirect;
        res.renderSkin('로그인', {
            contentName: 'member/pin_verification',
            passkeyData,
            serverData: {
                email: user.email,
                useTotp: !!user.totpToken,
                autologin: req.body.autologin,
                hasPasskey
            }
        });

        if(!user.totpToken) await mailTransporter.sendMail({
            from: config.smtp_sender,
            to: user.email,
            subject: `[${config.site_name}] 확인되지 않은 기기에서 로그인`,
            html: `
안녕하세요. ${config.site_name} 입니다.
확인되지 않은 기기에서 로그인을 시도하셨습니다.
본인이 맞다면 아래 PIN 번호를 입력해주세요.
PIN: <b>${user.emailPin}</b>

이 메일은 10분동안 유효합니다.
요청 아이피: ${req.ip}
        `.trim().replaceAll('\n', '<br>')
        });
    })(req, res, next);
});

app.post('/member/login/pin',
    middleware.isLogout,
    oneOf([
        body('pin')
            .notEmpty()
            .isLength(6)
            .withMessage('pin의 값은 6글자여야 합니다.'),
        body('challenge')
            .notEmpty()
    ], {
        message: 'pin의 값은 필수입니다.'
    }),
    middleware.singleFieldError,
    async (req, res) => {
    const user = await User.findOne({
        uuid: req.session.pinUser,
        lastLoginRequest: {
            $gte: new Date(Date.now() - 1000 * 60 * 10)
        }
    });

    if(!user) {
        delete req.session.pinUser;
        return res.redirect('/member/login');
    }

    if(!req.body.challenge && !await utils.middleValidateCaptcha(req, res)) return;

    if(user.totpToken) {
        if(req.body.challenge) {
            const options = req.session.passkeyAuthOptions;
            const response = req.body.challenge;
            const passkey = await Passkey.findOne({
                id: response.id
            });
            if(!passkey) return res.status(400).send('패스키를 찾을 수 없습니다.');

            let verification;
            try {
                verification = await verifyAuthenticationResponse({
                    response,
                    expectedChallenge: options.challenge,
                    expectedOrigin: config.base_url,
                    expectedRPID: options.rpId,
                    credential: {
                        id: passkey.id,
                        publicKey: passkey.publicKey,
                        counter: passkey.counter,
                        transports: passkey.transports
                    }
                });
            } catch(e) {
                if(debug) console.error(e);
                return res.status(400).send('패스키 인증이 실패했습니다.');
            }

            await Passkey.updateOne({
                id: response.id
            }, {
                counter: verification.authenticationInfo.newCounter,
                lastUsedAt: Date.now()
            });
        }
        else {
            const totp = new TOTP({
                secret: user.totpToken
            });
            const delta = totp.validate({ token: req.body.pin });
            if(delta == null) return res.status(400).send('PIN이 올바르지 않습니다.');
        }
    }
    else {
        if(req.body.pin !== user.emailPin) return res.status(400).send('PIN이 올바르지 않습니다.');
    }

    delete req.session.pinUser;
    delete req.session.redirect;

    if(req.body.trust) {
        req.session.trustedAccounts ??= [];
        req.session.trustedAccounts.push(user.uuid);
    }

    if(req.body.autologin === 'Y') {
        const token = await AutoLoginToken.create({
            uuid: user.uuid
        });
        res.cookie('honoka', token.token, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365,
            sameSite: 'lax'
        });
    }

    req.login(user, { keepSessionInfo: true }, err => {
        if(err) console.error(err);
        if(!res.headersSent) {
            req.session.fullReload = true;
            delete req.session.contributor;
            return res.redirect(req.session.redirect || '/');
        }
    });

    await utils.createLoginHistory(user, req);
});

app.get('/member/logout', middleware.isLogin, async (req, res) => {
    await AutoLoginToken.deleteOne({
        uuid: req.user.uuid,
        token: req.cookies.honoka
    });
    req.logout({ keepSessionInfo: true }, err => {
        if(err) console.error(err);
        req.session.fullReload = true;
        delete req.session.contributor;
        res.clearCookie('honoka');
        res.redirect(req.query.redirect || req.get('Referer') || '/');
    });
});

app.get('/member/mypage', middleware.isLogin, async (req, res) => {
    const passkeys = await Passkey.find({
        user: req.user.uuid
    })
        .select('name createdAt lastUsedAt -_id');
    res.renderSkin('내 정보', {
        contentName: 'member/mypage',
        serverData: {
            skins: global.skins,
            passkeys,
            user: utils.onlyKeys(req.user, ['name', 'email', 'skin']),
            permissions: req.displayPermissions,
            hasTotp: !!req.user.totpToken,
            canWithdraw: config.can_withdraw !== false
        }
    });
});

app.post('/member/mypage', middleware.isLogin,
    body('skin')
        .custom(value => ['default', ...global.skins].includes(value))
        .withMessage('invalid_skin'),
    middleware.fieldErrors,
    async (req, res) => {
    await User.updateOne({
        uuid: req.user.uuid
    }, {
        skin: req.body.skin
    });

    if(req.user.skin !== req.body.skin)
        req.session.fullReload = true;

    res.redirect('/member/mypage');
});

app.post('/member/generate_api_token',
    middleware.isLogin,
    body('password')
        .notEmpty().withMessage('비밀번호의 값은 필수입니다.')
        .custom(async (value, {req}) => {
            const result = await bcrypt.compare(value, req.user.password);
            if(!result) throw new Error('패스워드가 올바르지 않습니다.');
            return true;
        }),
    middleware.singleFieldError,
    async (req, res) => {
    const apiToken = crypto.randomBytes(128).toString('base64');
    await User.updateOne({
        uuid: req.user.uuid
    }, {
        apiToken
    });

    if(req.backendMode) res.partial({
        apiToken
    });
    else res.json({
        type: 'js',
        script: `
document.getElementById('token-input').value = '${apiToken}';
document.getElementById('token-page').style.display = '';
        `.trim()
    });
});

app.get('/member/change_password', middleware.isLogin, (req, res) => {
    res.renderSkin('비밀번호 변경', {
        contentName: 'member/change_password'
    });
});

app.post('/member/change_password',
    middleware.isLogin,
    body('old_password')
        .notEmpty().withMessage('old_password의 값은 필수입니다.')
        .custom(async (value, {req}) => {
            const result = await bcrypt.compare(value, req.user.password);
            if(!result) throw new Error('패스워드가 올바르지 않습니다.');
            return true;
        }),
    body('password')
        .notEmpty().withMessage('비밀번호의 값은 필수입니다.'),
    body('password_confirm')
        .notEmpty().withMessage('비밀번호 확인의 값은 필수입니다.')
        .custom((value, { req }) => value === req.body.password)
        .withMessage('패스워드 확인이 올바르지 않습니다.'),
    middleware.fieldErrors,
    async (req, res) => {

    const hash = await bcrypt.hash(req.body.password, 12);
    await User.updateOne({
        uuid: req.user.uuid
    }, {
        password: hash
    });

    return res.redirect('/member/mypage');
});

app.get('/contribution/ip/:ip', async (req, res) => {
    const user = await User.findOne({
        ip: req.params.ip
    });
    if(!user) return res.error('계정을 찾을 수 없습니다.', 404);

    res.redirect(`/contribution/${user.uuid}/document`);
});

app.get('/contribution/:uuid/document',
    param('uuid')
        .isUUID(),
    async (req, res, next) => {
    if(!validationResult(req).isEmpty()) return next();

    const user = await User.findOne({
        uuid: req.params.uuid
    });
    // if(!user) return res.error('계정을 찾을 수 없습니다.', 404);

    const logType = {
        create: HistoryTypes.Create,
        delete: HistoryTypes.Delete,
        move: HistoryTypes.Move,
        revert: HistoryTypes.Revert
    }[req.query.logtype];
    const baseQuery = {
        ...(logType != null ? { type: logType } : {}),
        user: req.params.uuid
    }
    const query = { ...baseQuery };

    const total = await History.countDocuments(query);

    const pageQuery = req.query.until || req.query.from;
    if(pageQuery) {
        const history = await History.findOne({
            uuid: pageQuery
        });
        if(history) {
            if(req.query.until) query._id = { $gte: history._id };
            else query._id = { $lte: history._id };
        }
    }

    let revs = await History.find(query)
        .sort({ _id: query._id?.$gte ? 1 : -1 })
        .limit(100)
        .select('type document rev revertRev uuid user createdAt log moveOldDoc moveNewDoc troll hideLog diffLength api')
        .lean();

    if(query._id?.$gte) revs.reverse();

    let prevItem;
    let nextItem;
    if(revs?.length) {
        prevItem = await History.findOne({
            ...baseQuery,
            _id: { $gt: revs[0]._id }
        })
            .select('uuid -_id')
            .sort({ _id: 1 });
        nextItem = await History.findOne({
            ...baseQuery,
            _id: { $lt: revs[revs.length - 1]._id }
        })
            .select('uuid -_id')
            .sort({ _id: -1 });

        revs = await utils.findDocuments(revs);
        revs = utils.withoutKeys(revs.filter(a => a.document), ['_id']);
    }

    res.renderSkin(`${user ? `"${user.name || user.ip}"` : '<삭제된 사용자>'} 기여 목록`, {
        viewName: 'contribution',
        contentName: 'userContribution/document',
        account: {
            uuid: req.params.uuid,
            name: user?.name,
            type: user?.type ?? UserTypes.Deleted
        },
        serverData: {
            revs: revs.map(a => utils.addHistoryData(req, a, req.permissions.includes('admin'), null, req.backendMode)),
            total,
            prevItem,
            nextItem,
            contributionType: 'document'
        }
    });
});

app.get('/contribution/:uuid/discuss',
    param('uuid')
        .isUUID(),
    async (req, res, next) => {
    if(!validationResult(req).isEmpty()) return next();

    const user = await User.findOne({
        uuid: req.params.uuid
    });
    // if(!user) return res.error('계정을 찾을 수 없습니다.', 404);

    const data = await utils.pagination(req, ThreadComment, {
        user: req.params.uuid
    }, 'uuid', 'createdAt', {
        getTotal: true
    });
    data.items = await utils.findThreads(data.items);
    data.items = utils.onlyKeys(data.items, ['thread', 'id', 'createdAt']);

    res.renderSkin(`${user ? `"${user.name || user.ip}"` : '<삭제된 사용자>'} 기여 목록`, {
        viewName: 'contribution_discuss',
        contentName: 'userContribution/discuss',
        account: {
            uuid: req.params.uuid,
            name: user?.name,
            type: user?.type ?? UserTypes.Deleted
        },
        serverData: {
            ...data,
            contributionType: 'discuss'
        }
    });
});

app.get('/contribution/:uuid/edit_request',
    param('uuid')
        .isUUID(),
    async (req, res, next) => {
    if(!validationResult(req).isEmpty()) return next();

    const user = await User.findOne({
        uuid: req.params.uuid
    });
    // if(!user) return res.error('계정을 찾을 수 없습니다.', 404);

    const baseQuery = {
        createdUser: req.params.uuid
    }
    const query = { ...baseQuery };

    const total = await EditRequest.countDocuments(query);

    const pageQuery = req.query.until || req.query.from;
    if(pageQuery) {
        const history = await EditRequest.findOne({
            uuid: pageQuery
        });
        if(history) {
            if(req.query.until) query._id = { $gte: history._id };
            else query._id = { $lte: history._id };
        }
    }

    let items = await EditRequest.find(query)
        .sort({ _id: query._id?.$gte ? 1 : -1 })
        .limit(100)
        .select('url document status lastUpdatedAt diffLength -_id')
        .lean();

    if(query._id?.$gte) items.reverse();

    let prevItem;
    let nextItem;
    if(items?.length) {
        prevItem = await EditRequest.findOne({
            ...query,
            _id: { $gt: items[0]._id }
        })
            .select('uuid -_id')
            .sort({ _id: 1 });
        nextItem = await EditRequest.findOne({
            ...query,
            _id: { $lt: items[items.length - 1]._id }
        })
            .select('uuid -_id')
            .sort({ _id: -1 });

        items = await utils.findDocuments(items);
    }

    res.renderSkin(`${user ? `"${user.name || user.ip}"` : '<삭제된 사용자>'} 기여 목록`, {
        viewName: 'contribution_edit_request',
        contentName: 'userContribution/editRequest',
        account: {
            uuid: req.params.uuid,
            name: user?.name,
            type: user?.type ?? UserTypes.Deleted
        },
        serverData: {
            items,
            total,
            prevItem,
            nextItem,
            contributionType: 'edit_request'
        }
    });
});
app.get('/contribution/:uuid/accepted_edit_request',
    param('uuid')
        .isUUID(),
    async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return next();

    const user = await User.findOne({
        uuid: req.params.uuid
    });

    const data = await utils.pagination(req, EditRequest, {
        lastUpdateUser: req.params.uuid
    }, 'uuid', '_id', {
        getTotal: true
    });
    data.items = await utils.findDocuments(data.items);
    data.items = utils.onlyKeys(data.items, ['url', 'document', 'status', 'lastUpdatedAt', 'diffLength']);

    res.renderSkin(`${user ? `"${user.name || user.ip}"` : '<삭제된 사용자>'} 기여 목록`, {
        viewName: 'contribution_edit_request',
        contentName: 'userContribution/editRequest',
        account: {
            uuid: req.params.uuid,
            name: user?.name,
            type: user?.type ?? UserTypes.Deleted
        },
        serverData: {
            ...data,
            contributionType: 'accepted_edit_request'
        }
    });
});

const checkDeletable = async user => {
    let noActivityTime = 1000 * 60 * 60 * (config.withdraw_last_activity_hours ?? 24);
    let blacklistDuration = config.withdraw_save_days * 1000 * 60 * 60 * 24;

    const aclGroups = await ACLGroup.find({
        forBlock: true
    });
    const aclGroupItem = await ACLGroupItem.findOne({
        aclGroup: {
            $in: aclGroups.map(group => group.uuid)
        },
        $or: [
            {
                expiresAt: {
                    $gte: new Date()
                }
            },
            {
                expiresAt: null
            }
        ],
        user: user.uuid
    }).lean();
    if(aclGroupItem) {
        noActivityTime *= 90;

        if(aclGroupItem.expiresAt)
            blacklistDuration = Math.max(blacklistDuration, aclGroupItem.expiresAt - Date.now());
        else
            blacklistDuration = null;
    }

    return {
        noActivityTime,
        blacklistDuration,
        deletable: user.lastActivity < Date.now() - noActivityTime
    }
}

app.get('/member/withdraw', middleware.isLogin, async (req, res) => {
    if(config.can_withdraw === false)
        return res.error('계정 삭제가 비활성화돼 있습니다.', 403);

    const { deletable, blacklistDuration, noActivityTime } = await checkDeletable(req.user);

    res.renderSkin('회원 탈퇴', {
        contentName: 'member/withdraw',
        serverData: {
            blacklistDays: blacklistDuration && Math.round(blacklistDuration / 1000 / 60 / 60 / 24),
            alert: deletable ? null : '마지막 활동으로부터 시간이 경과해야 계정 삭제가 가능합니다.',
            noActivityTime,
            pledge: config.withdraw_pledge
        }
    });
});

app.post('/member/withdraw',
    middleware.isLogin,
    body('password')
        .notEmpty().withMessage('비밀번호의 값은 필수입니다.')
        .custom(async (value, {req}) => {
            const result = await bcrypt.compare(value, req.user.password);
            if(!result) throw new Error('패스워드가 올바르지 않습니다.');
            return true;
        }),
    body('pledge')
        .notEmpty().withMessage('pledge의 값은 필수입니다.')
        .equals(config.withdraw_pledge).withMessage('동일하게 입력해주세요.'),
    middleware.fieldErrors,
    async (req, res) => {
    if(config.can_withdraw === false)
        return res.error('계정 삭제가 비활성화돼 있습니다.', 403);

    const { deletable, blacklistDuration } = await checkDeletable(req.user);
    if(!deletable) return res.status(403).send('마지막 활동으로부터 시간이 경과해야 계정 삭제가 가능합니다.');

    if(blacklistDuration == null || blacklistDuration > 0)
        await Blacklist.create({
            email: crypto.createHash('sha256').update(req.user.email).digest('hex'),
            expiresAt: blacklistDuration ? new Date(Date.now() + blacklistDuration) : null
        });

    await User.deleteOne({
        uuid: req.user.uuid
    });
    await AutoLoginToken.deleteMany({
        uuid: req.user.uuid
    });

    const userDocs = await Document.find({
        namespace: '사용자',
        $or: [
            {
                title: req.user.name
            },
            {
                title: {
                    $regex: new RegExp(`^사용자:${utils.escapeRegExp(req.user.name)}/`)
                }
            }
        ]
    });
    for(let dbDocument of userDocs) {
        const newDbDocument = await Document.findOneAndUpdate({
            uuid: dbDocument.uuid
        }, {
            title: dbDocument.title.replace(`${req.user.name}`, `*${req.user.uuid}`)
        }, {
            new: true
        });
        await History.create({
            user: req.user.uuid,
            type: HistoryTypes.Move,
            document: dbDocument.uuid,
            moveOldDoc: `사용자:${dbDocument.title}`,
            moveNewDoc: `사용자:${newDbDocument.title}`
        });
        await History.create({
            user: req.user.uuid,
            type: HistoryTypes.Delete,
            document: dbDocument.uuid,
            content: null
        });
    }

    req.logout({ keepSessionInfo: true }, err => {
        if(err) console.error(err);
        req.session.fullReload = true;
        delete req.session.contributor;
        res.clearCookie('honoka');
        res.redirect('/member/login');
    });
});

app.get('/member/change_name', middleware.isLogin, (req, res) => {
    res.renderSkin('이름 변경', {
        contentName: 'member/change_name',
        serverData: {
            ...(Date.now() - req.user.lastNameChange < 1000 * 60 * 60 * 24 * 30 ? {
                alert: '최근에 계정을 생성했거나 최근에 이름 변경을 이미 했습니다.'
            } : {})
        }
    });
});

app.post('/member/change_name',
    middleware.isLogin,
    body('password')
        .notEmpty().withMessage('비밀번호의 값은 필수입니다.')
        .custom(async (value, {req}) => {
            const result = await bcrypt.compare(value, req.user.password);
            if(!result) throw new Error('패스워드가 올바르지 않습니다.');
            return true;
        }),
    nameChecker('name'),
    middleware.fieldErrors,
    async (req, res) => {
    if(Date.now() - req.user.lastNameChange < 1000 * 60 * 60 * 24 * 30)
        return res.status(403).send('최근에 계정을 생성했거나 최근에 이름 변경을 이미 했습니다.');

    await User.updateOne({
        uuid: req.user.uuid
    }, {
        name: req.body.name,
        lastNameChange: Date.now()
    });

    const userDocs = await Document.find({
        namespace: '사용자',
        $or: [
            {
                title: req.user.name
            },
            {
                title: {
                    $regex: new RegExp(`^사용자:${utils.escapeRegExp(req.user.name)}/`)
                }
            }
        ]
    });
    for(let dbDocument of userDocs) {
        const newDbDocument = await Document.findOneAndUpdate({
            uuid: dbDocument.uuid
        }, {
            title: dbDocument.title.replace(`${req.user.name}`, `${req.body.name}`)
        }, {
            new: true
        });
        await History.create({
            user: req.user.uuid,
            type: HistoryTypes.Move,
            document: dbDocument.uuid,
            moveOldDoc: `사용자:${dbDocument.title}`,
            moveNewDoc: `사용자:${newDbDocument.title}`
        });
    }

    res.redirect('/member/mypage');
});

app.get('/member/change_email', middleware.isLogin, (req, res) => {
    const doingChangeEmail = Date.now() - req.user.lastChangeEmail < 1000 * 60 * 10;
    res.renderSkin('이메일 변경', {
        contentName: 'member/change_email',
        serverData: {
            ...(doingChangeEmail ? {
                alert: '이메일 인증이 이미 진행 중입니다.'
            } : {}),
            doingChangeEmail,
            email: req.user.email
        }
    });
});

app.post('/member/change_email',
    middleware.isLogin,
    body('password')
        .notEmpty().withMessage('비밀번호의 값은 필수입니다.')
        .custom(async (value, {req}) => {
            const result = await bcrypt.compare(value, req.user.password);
            if(!result) throw new Error('패스워드가 올바르지 않습니다.');
            return true;
        }),
    body('email')
        .notEmpty().withMessage('이메일의 값은 필수입니다.')
        .isEmail().withMessage('이메일의 값을 형식에 맞게 입력해주세요.')
        .normalizeEmail()
        .custom((value, {req}) => value !== req.user.email).withMessage('문서 내용이 같습니다.'),
    middleware.fieldErrors,
    async (req, res) => {
    if(Date.now() - req.user.lastChangeEmail < 1000 * 60 * 10)
        return res.status(409).send('이메일 인증이 이미 진행 중입니다.');

    const email = req.body.email;

    const emailDomain = email.split('@').pop();
    if(config.email_whitelist.length && !config.email_whitelist.includes(emailDomain))
        return res.status(400).send('이메일 허용 목록에 있는 이메일이 아닙니다.');

    const checkBlacklist = await Blacklist.exists({
        email: crypto.createHash('sha256').update(email).digest('hex')
    });
    if(checkBlacklist) return res.status(403).send({
        fieldErrors: {
            email: {
                msg: '재가입 대기 기간 입니다.'
            }
        }
    });

    const newUser = await User.findOneAndUpdate({
        uuid: req.user.uuid
    }, {
        changeEmail: req.body.email,
        changeEmailToken: randomstring.generate({
            charset: 'hex',
            length: 64
        }),
        lastChangeEmail: Date.now()
    }, {
        new: true
    });

    const checkUserExists = await User.exists({
        email
    });
    if(!!checkUserExists) {
        if(config.use_email_verification) {
            res.redirect('/member/mypage');

            await mailTransporter.sendMail({
                from: config.smtp_sender,
                to: email,
                subject: `[${config.site_name}] ${req.user.name}님의 이메일 변경 인증 메일 입니다.`,
                html: `
안녕하세요. ${config.site_name} 입니다.

${req.user.name}님의 이메일 변경 인증 메일입니다.
이 이메일로 이메일 변경을 시도했지만 이미 이 이메일로 계정 생성이 되어있어서 더 이상 계정을 생성할 수 없습니다.

요청 아이피 : ${req.ip}
    `.trim().replaceAll('\n', '<br>')
            });
        }
        else res.status(409).send('이미 가입된 이메일입니다.');

        return;
    }

    const authUrl = `/member/auth/${req.user.name}/${newUser.changeEmailToken}`;
    if(config.use_email_verification) {
        res.redirect('/member/mypage');

        await mailTransporter.sendMail({
            from: config.smtp_sender,
            to: email,
            subject: `[${config.site_name}] ${req.user.name}님의 이메일 변경 인증 메일 입니다.`,
            html: `
안녕하세요. ${config.site_name} 입니다.

${req.user.name}님의 이메일 변경 인증 메일입니다.
해당 아이디로 변경한게 맞으시면 아래 링크를 클릭해주세요.
<a href="${new URL(authUrl, config.base_url)}">[인증]</a>

이 메일은 24시간동안 유효합니다.
요청 아이피 : ${req.ip}
        `.trim().replaceAll('\n', '<br>')
        });
    }
    else res.redirect(authUrl);
});

app.get('/member/auth/:name/:token', async (req, res) => {
    const user = await User.findOne({
        name: req.params.name
    });
    if(!user || Date.now() - user.lastChangeEmail > 1000 * 60 * 60 * 24 || user.changeEmailToken !== req.params.token)
        return res.error('인증 요청이 만료되었거나 올바르지 않습니다.');

    const emailDupCheck = await User.exists({
        email: user.changeEmail
    });
    if(!!emailDupCheck) return res.error('이메일이 이미 존재합니다.', 409);

    await User.updateOne({
        uuid: user.uuid
    }, {
        email: user.changeEmail,
        changeEmail: null,
        changeEmailToken: null,
        lastChangeEmail: null
    });

    res.renderSkin('인증 완료', {
        contentHtml: `<strong>${user.name}</strong>님 이메일 인증이 완료되었습니다.<br><a href="/member/login">[로그인]</a> 해주세요.`
    });
});

app.get('/member/activate_otp', middleware.isLogin, async (req, res) => {
    if(req.user.totpToken) return res.error('already_activated_otp');

    const totp = new TOTP({
        issuer: config.site_name,
        label: req.user.name
    });
    req.session.totpToken = totp.secret.base32;

    const qrcode = await QRCode.toDataURL(totp.toString());

    res.renderSkin('OTP 활성화', {
        contentName: 'member/activate_otp',
        serverData: {
            qrcode
        }
    });
});

app.post('/member/activate_otp',
    middleware.isLogin,
    body('pin')
        .notEmpty().withMessage('pin의 값은 필수입니다.')
        .isLength({
            min: 6,
            max: 6
        }).withMessage('pin의 값은 6글자여야 합니다.'),
    middleware.fieldErrors,
    async (req, res) => {
    if(req.user.totpToken) return res.error('already_activated_otp');

    const totp = new TOTP({
        secret: req.session.totpToken
    });
    const delta = totp.validate({ token: req.body.pin });
    if(delta == null) return res.status(400).json({
        fieldErrors: {
            pin: {
                msg: 'PIN이 올바르지 않습니다.'
            }
        }
    });

    await User.updateOne({
        uuid: req.user.uuid
    }, {
        totpToken: req.session.totpToken
    });

    res.redirect('/member/mypage');
});

app.get('/member/deactivate_otp', middleware.isLogin, (req, res) => {
    if(!req.user.totpToken) return res.error('not_activated_otp');

    res.renderSkin('OTP 비활성화', {
        contentName: 'member/deactivate_otp'
    });
});

app.post('/member/deactivate_otp',
    middleware.isLogin,
    body('pin')
        .notEmpty().withMessage('pin의 값은 필수입니다.')
        .isLength({
            min: 6,
            max: 6
        }).withMessage('pin의 값은 6글자여야 합니다.'),
    async (req, res) => {
    if(!req.user.totpToken) return res.error('not_activated_otp');

    const totp = new TOTP({
        secret: req.user.totpToken
    });
    const delta = totp.validate({ token: req.body.pin });
    if(delta == null) return res.status(400).json({
        fieldErrors: {
            pin: {
                msg: 'PIN이 올바르지 않습니다.'
            }
        }
    });

    await User.updateOne({
        uuid: req.user.uuid
    }, {
        totpToken: null
    });

    res.redirect('/member/mypage');
});

app.get('/member/recover_password', middleware.isLogout, (req, res) => {
    if(!config.use_email_verification) return res.error('이메일 인증이 비활성화돼 있습니다.');

    res.renderSkin('계정 찾기', {
        contentName: 'member/recover_password'
    });
});

app.post('/member/recover_password', middleware.isLogout, middleware.captcha, async (req, res) => {
    if(!config.use_email_verification) return res.error('이메일 인증이 비활성화돼 있습니다.');

    const email = req.body.email;
    if(!email) return res.status(400).send('이메일의 값은 필수입니다.');

    res.renderSkin('계정 찾기', {
        contentName: 'member/recover_password_email_sent',
        serverData: { email }
    });

    const newUser = await User.findOneAndUpdate({
        email
    }, {
        changePasswordToken: randomstring.generate({
            charset: 'hex',
            length: 64
        }),
        lastChangePassword: Date.now()
    }, {
        new: true
    });
    if(!newUser) return;

    const authUrl = `/member/recover_password/auth/${newUser.name}/${newUser.changePasswordToken}`;
    await mailTransporter.sendMail({
        from: config.smtp_sender,
        to: email,
        subject: `[${config.site_name}] ${newUser.name}님의 비밀번호 찾기 메일 입니다.`,
        html: `
안녕하세요. ${config.site_name}입니다.

${newUser.name}님의 비밀번호 찾기 메일입니다.
해당 계정의 비밀번호를 찾으시려면 아래 링크를 클릭해주세요.
<a href="${new URL(authUrl, config.base_url)}">[인증]</a>

이 메일은 24시간동안 유효합니다.
요청 아이피 : ${req.ip}
        `.trim().replaceAll('\n', '<br>')
    });
});

app.get('/member/recover_password/auth/:name/:token', (req, res) => {
    res.renderSkin('계정 찾기', {
        contentName: 'member/recover_password_final'
    });
});

app.post('/member/recover_password/auth/:name/:token',
    body('password')
        .notEmpty()
        .withMessage('비밀번호의 값은 필수입니다.'),
    body('password_confirm')
        .notEmpty()
        .withMessage('비밀번호 확인의 값은 필수입니다.')
        .custom((value, { req }) => value === req.body.password)
        .withMessage('패스워드 확인이 올바르지 않습니다.'),
    middleware.fieldErrors,
    async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 12);
    const user = await User.findOneAndUpdate({
        name: req.params.name,
        changePasswordToken: req.params.token,
        lastChangePassword: {
            $gte: Date.now() - 1000 * 60 * 60 * 24
        }
    }, {
        password: hash,
        changePasswordToken: null,
        lastChangePassword: null
    });
    if(!user) return res.status(400).send('인증 요청이 만료되었거나 올바르지 않습니다.');

    res.redirect('/member/login');
});

const starHandler = starred => async (req, res) => {
    const document = req.document;
    const dbDocument = await Document.findOne({
        namespace: document.namespace,
        title: document.title
    });
    if(!dbDocument) return res.error('문서를 찾을 수 없습니다.', 404);

    if(starred) {
        try {
            await Star.create({
                document: dbDocument.uuid,
                user: req.user.uuid
            });
        } catch(e) {
            if(e.code === 11000) return res.error('already_starred_document', 409);
        }
    }
    else {
        const deleted = await Star.findOneAndDelete({
            document: dbDocument.uuid,
            user: req.user.uuid
        });
        if(!deleted) return res.error('already_unstarred_document', 404);
    }

    const referer = new URL(req.get('Referer'));
    if(referer.pathname.startsWith('/member/starred_documents')) res.status(204).end();
    else res.redirect(globalUtils.doc_action_link(document, 'w'));
}

app.get('/member/starred_documents', middleware.isLogin, async (req, res) => {
    let stars = await Star.find({
        user: req.user.uuid
    })
        .select('document -_id')
        .lean();
    stars = await utils.findDocuments(stars, ['updatedAt', 'uuid']);
    stars = stars.sort((a, b) => b.document.updatedAt - a.document.updatedAt);

    for(let star of stars) {
        star.rev = await History.findOne({
            document: star.document.uuid
        })
            .sort({ rev: -1 })
            .select('createdAt -_id')
            .lean();

        star.document = utils.withoutKeys(star.document, ['updatedAt']);
    }

    res.renderSkin('내 문서함', {
        contentName: 'member/starred_documents',
        serverData: {
            stars
        }
    });
});

app.get('/member/star/?*', middleware.isLogin, middleware.parseDocumentName, starHandler(true));
app.get('/member/unstar/?*', middleware.isLogin, middleware.parseDocumentName, starHandler(false));

app.post('/member/register_webauthn',
    middleware.isLogin,
    body('name')
        .notEmpty().withMessage('이름의 값은 필수입니다.')
        .isLength({
            max: 80
        }).withMessage('이름의 값은 80글자 이하여야 합니다.'),
    middleware.singleFieldError,
    async (req, res) => {
    const userPasskeys = await Passkey.find({
        user: req.user.uuid
    });
    if(userPasskeys.some(a => a.name === req.body.name))
        return res.status(409).send('이름이 이미 존재합니다.');

    const options = await generateRegistrationOptions({
        rpName: config.site_name,
        rpID: new URL(config.base_url).hostname,
        userID: isoUint8Array.fromUTF8String(req.user.uuid),
        userName: req.user.name,
        attestationType: 'none',
        excludeCredentials: userPasskeys.map(a => ({
            id: a.id,
            transports: a.transports
        }))
    });
    req.session.passkeyRegisterOptions = {
        name: req.body.name,
        ...options
    };

    res.json(options);
});

app.post('/member/register_webauthn/challenge', async (req, res) => {
    const options = req.session.passkeyRegisterOptions;

    let verification;
    try {
        verification = await verifyRegistrationResponse({
            response: req.body,
            expectedChallenge: options.challenge,
            expectedOrigin: config.base_url,
            expectedRPID: options.rp.id
        });
    } catch(e) {
        console.error(e);
        return res.status(400).send({ error: e.message });
    }

    const {
        credential,
        credentialDeviceType,
        credentialBackedUp
    } = verification.registrationInfo;

    await Passkey.create({
        user: isoBase64URL.toUTF8String(options.user.id),
        name: options.name,
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp
    });

    if(req.backendMode) res.reload();
    else res.status(204).end();
});

app.post('/member/delete_webauthn',
    body('name')
        .notEmpty().withMessage('이름의 값은 필수입니다.'),
    middleware.singleFieldError,
    async (req, res) => {
    await Passkey.deleteOne({
        user: req.user.uuid,
        name: req.body.name
    });
    if(req.backendMode) res.reload();
    else res.status(204).end();
});

app.get('/member/notifications', middleware.isLogin, async (req, res) => {
    const queries = [{
        user: req.user.uuid
    }];
    if(req.permissions.includes('developer')) queries.push({
        user: 'developer'
    });

    let statusStr = req.query.status;
    if(!['read', 'unread', 'all'].includes(statusStr))
        statusStr = null;
    statusStr ??= 'unread';

    const data = await utils.pagination(req, Notification, {
        $or: queries,
        ...(statusStr !== 'all' ? {
            read: statusStr === 'read'
        } : {})
    }, 'uuid', 'createdAt', {
        limit: 10
    });
    data.items = utils.onlyKeys(data.items, ['uuid', 'type', 'read', 'data', 'createdAt']);
    data.items = await utils.notificationMapper(req, data.items);

    res.renderSkin('알림', {
        contentName: 'member/notifications',
        serverData: data
    });
});

app.post('/member/notifications/:uuid/read', middleware.isLogin, async (req, res) => {
    await Notification.updateOne({
        $or: [
            {
                user: req.user.uuid
            },
            ...(req.permissions.includes('developer') ? [{
                user: 'developer'
            }] : [])
        ],
        uuid: req.params.uuid
    }, {
        read: true
    });
    res.reload();
});

app.post('/member/notifications/:uuid/unread', middleware.isLogin, async (req, res) => {
    await Notification.updateOne({
        $or: [
            {
                user: req.user.uuid
            },
            ...(req.permissions.includes('developer') ? [{
                user: 'developer'
            }] : [])
        ],
        uuid: req.params.uuid
    }, {
        read: false
    });
    res.reload();
});

app.post('/member/notifications/read', middleware.isLogin, async (req, res) => {
    await Notification.updateMany({
        $or: [
            {
                user: req.user.uuid
            },
            ...(req.permissions.includes('developer') ? [{
                user: 'developer'
            }] : [])
        ],
        read: false
    }, {
        read: true
    });
    res.reload();
});

app.get('/engine/getperm', middleware.isLogin, async (req, res) => {
    const verifyText = `${crypto.createHash('sha256').update(config.base_url).digest('hex')}:${req.user.uuid}`;

    let result;
    try {
        const { data } = await axios.get('/engine/verify_developer', {
            baseURL: global.versionData.officialWiki,
            params: {
                text: verifyText
            }
        });
        result = data.result;
    } catch(e) {}
    if(result) {
        await User.updateOne({
            uuid: req.user.uuid
        }, {
            $addToSet: {
                permissions: 'engine_developer'
            }
        });
        res.redirect('/member/mypage');
    }
    else res.send(verifyText);
});

app.post('/member/get_developer_perm', middleware.permission('engine_developer'), async (req, res) => {
    if(config.disable_dev_support) return res.error('사이트 소유자가 개발자 지원을 비활성화했습니다.');
    if(req.permissions.includes('developer')) return res.error('이미 권한을 보유하고 있습니다.');

    await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.DevSupport,
        content: req.body.reason
    });
    await User.updateOne({
        uuid: req.user.uuid
    }, {
        $addToSet: {
            permissions: 'developer'
        }
    });
    res.reload();
});

app.post('/member/remove_developer_perm', middleware.permission('engine_developer'), async (req, res) => {
    if(!req.permissions.includes('developer')) return res.error('권한을 보유하고 있지 않습니다.');

    await User.updateOne({
        uuid: req.user.uuid
    }, {
        $pull: {
            permissions: 'developer'
        }
    });
    res.reload();
});

module.exports = app;