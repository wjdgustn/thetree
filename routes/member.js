const express = require('express');
const { body, param, query, validationResult, oneOf } = require('express-validator');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
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
const parsePhoneNumber = require('libphonenumber-js/max');
const webpush = require('web-push');

const utils = require('../utils');
const namumarkUtils = require('../utils/namumark/utils');
const globalUtils = require('../utils/global');
const middleware = require('../utils/middleware');
const {
    HistoryTypes,
    UserTypes,
    AuditLogTypes,
    SignupPolicy
} = require('../utils/types');
const CountryCodes = require('../utils/countryCodes.json');

const User = require('../schemas/user');
const SignupToken = require('../schemas/signupToken');
const AutoLoginToken = require('../schemas/autoLoginToken');
const OAuth2Map = require('../schemas/oauth2Map');
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
const MobileVerifyInfo = require('../schemas/mobileVerifyInfo');
const ServerKeyValue = require('../schemas/serverKeyValue');
const PushSubscription = require('../schemas/pushSubscription');

const app = express.Router();

app.get('/member/signup', middleware.isLogout, middleware.checkCaptcha(true), (req, res) => {
    if(config.disable_signup || config.disable_internal_login) return res.error(req.t('routes.member.errors.signup_disabled'));

    res.renderSkin('signup', {
        contentName: 'member/signup',
        serverData: {
            terms: config.terms,
            agreeText: config.terms_agree_text || req.t('routes.member.signup.default_agree_text'),
            emailWhitelist: config.email_whitelist
        }
    });
});

const signupAction = async (email, req, res, phoneNumber) => {
    const checkBlacklist = await Blacklist.exists({
        email: crypto.createHash('sha256').update(email).digest('hex')
    });
    if(checkBlacklist) return res.status(403).send({
        fieldErrors: {
            email: {
                msg: req.t('routes.member.errors.signup_blacklist')
            }
        }
    });

    const checkUserExists = await User.exists({
        email
    });
    if(!!checkUserExists) {
        if(config.use_email_verification) {
            res.renderSkin('signup', {
                contentName: 'member/signup_email_sent',
                serverData: { email }
            });

            await mailTransporter.sendMail({
                from: config.smtp_sender,
                to: email,
                subject: `[${config.site_name}] ${req.t('routes.member.email.titles.signup')}`,
                html: `
${req.t('routes.member.email.contents.hello', { siteName: config.site_name })}
${req.t('routes.member.email.contents.signup_content', { siteName: config.site_name })}
${req.t('routes.member.email.contents.signup_email_dup')}

${req.t('routes.member.email.contents.request_ip')} : ${req.ip}
        `.trim().replaceAll('\n', '<br>')
            });
        }
        else res.status(409).send(req.t('routes.member.errors.already_registered_email'));

        return;
    }

    const existingToken = await SignupToken.findOne({
        email
    });
    if(config.use_email_verification && existingToken && Date.now() - existingToken.createdAt < 1000 * 60 * 10)
        return res.status(409).json({
            fieldErrors: {
                email: {
                    msg: req.t('routes.member.errors.email_signup_already_sent')
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
                    msg: req.t('routes.member.errors.ip_signup_already_in_progress')
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
        ip: req.ip,
        phoneNumber
    });
    await newToken.save();

    const signupUrl = `/member/signup/${newToken.token}`;
    if(config.use_email_verification) {
        res.renderSkin('signup', {
            contentName: 'member/signup_email_sent',
            serverData: { email }
        });

        await mailTransporter.sendMail({
            from: config.smtp_sender,
            to: email,
            subject: `[${config.site_name}] ${req.t('routes.member.email.titles.signup')}`,
            html: `
${req.t('routes.member.email.contents.hello', { siteName: config.site_name })}
${req.t('routes.member.email.contents.signup_content', { siteName: config.site_name })}
${req.t('routes.member.email.contents.signup_email_link', {
    linkOpen: `<a href="${new URL(signupUrl, config.base_url)}">`,
    linkClose: '</a>'
})}
${req.t('routes.member.email.contents.request_ip')} : ${req.ip}
        `.trim().replaceAll('\n', '<br>')
        });
    }
    else res.redirect(signupUrl);
}

app.post('/member/signup',
    middleware.isLogout,
    body('email')
        .notEmpty().withMessage('routes.member.errors.email_required')
        .isEmail().withMessage('routes.member.errors.invalid_email')
        .normalizeEmail(),
    body('agree').exists().withMessage('routes.member.errors.agree_required'),
    middleware.fieldErrors,
    middleware.captcha(true),
    async (req, res) => {
    if(config.disable_signup || config.disable_internal_login) return res.status(400).send(req.t('routes.member.errors.signup_disabled'));

    const emailDomain = req.body.email.split('@').pop();
    if(config.email_whitelist.length && !config.email_whitelist.includes(emailDomain))
        return res.status(400).send(req.t('routes.member.errors.email_not_whitelisted'));

    let ipArr;
    if(Address4.isValid(req.ip)) ipArr = new Address4(req.ip).toArray();
    else ipArr = new Address6(req.ip).toByteArray();

    const email = req.body.email;

    const aclGroups = await ACLGroup.find({
        signupPolicy: {
            $gt: SignupPolicy.None
        }
    });
    const aclGroupItems = await ACLGroupItem.find({
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

    const verifyEnabled = config.verify_enabled && global.plugins.mobileVerify.length;

    let blockItem = aclGroupItems.find(item => aclGroups.find(group => group.uuid === item.aclGroup)?.signupPolicy === SignupPolicy.Block);
    const verifyItem = verifyEnabled && aclGroupItems.find(item => aclGroups.find(group => group.uuid === item.aclGroup)?.signupPolicy === SignupPolicy.RequireVerification);

    // if(!blockItem && verifyItem && !verifyEnabled)
    //     blockItem = verifyItem;

    if(blockItem) {
        const aclGroup = aclGroups.find(group => group.uuid === blockItem.aclGroup);
        let aclMessage = req.t('acl.deny_string.message', {
            rule: req.t('acl.deny_string.in_group', {
                usingIpStr: req.t('acl.deny_string.using_ip'),
                group: aclGroup.name,
                groupId: blockItem.id
            }),
            type: req.t('acl.types.create_account')
        });
        aclMessage += `<br>${req.t('acl.deny_string.expiry')} : ${blockItem.expiresAt?.toString() ?? req.t('acl.deny_string.forever')}`;
        aclMessage += `<br>req.t('acl.deny_string.reason') : ${namumarkUtils.escapeHtml(blockItem.note ?? 'null')}`;
        if(aclGroup.aclMessage) {
            aclMessage = aclGroup.aclMessage;
            for(let [key, value] of Object.entries({
                name: aclGroup.name,
                id: blockItem.id,
                note: blockItem.note,
                expired: blockItem.expiresAt?.toString() ?? req.t('acl.deny_string.forever')
            })) {
                aclMessage = aclMessage.replaceAll(`{${key}}`, namumarkUtils.escapeHtml(value));
            }
        }
        return res.status(403).send(aclMessage);
    }
    else if(verifyItem) {
        req.session.signupVerifyInfo = {
            email,
            note: verifyItem.note
        }
        return res.redirect('/member/signup_verify');
    }

    await signupAction(email, req, res);
});

app.get('/member/signup/:token', async (req, res) => {
    const token = await SignupToken.findOne({
        token: req.params.token
    });
    if(!token || Date.now() - token.createdAt > 1000 * 60 * 60 * 24) return res.error(req.t('routes.member.errors.invalid_email_token'));

    // if(token.ip && token.ip !== req.ip) return res.error('보안 상의 이유로 요청한 아이피 주소와 현재 아이피 주소가 같아야 합니다.');

    res.renderSkin('signup', {
        contentName: 'member/signup_final',
        serverData: {
            email: token.email,
            name: token.name,
            fromOAuth2: !!token.oauth2Map
        }
    });
});

const nameChecker = field => body(field)
    .if(body(field).not().equals('special:bypass'))
    .notEmpty()
    .withMessage('routes.member.errors.username_required')
    .custom((value, { req }) => !req.user?.name || req.user.name !== value)
    .withMessage('errors.same_document_content')
    .isLength({ min: 3, max: 32 })
    .withMessage('routes.member.errors.username_length_range')
    .custom(value => /^[a-zA-Z0-9_]+$/.test(value))
    .withMessage('routes.member.errors.username_valid_chars')
    .custom(value => value[0].match(/[a-zA-Z]/))
    .withMessage('routes.member.errors.username_startswith_en')
    .custom(value => !(config.name_blacklist ?? []).some(a => value.toLowerCase().includes(a.toLowerCase())))
    .withMessage('routes.member.errors.username_invalid_keyword')
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
        if(existingUser) throw new Error(req.t('routes.member.errors.dup_username'));
    });
const passwordChecker = field => body(field)
    .if((value, { req }) => !!req.user.password)
    .notEmpty().withMessage(field === 'password' ? 'routes.member.errors.password_required' : 'errors.required_field')
    .custom(async (value, { req }) => {
        const result = await bcrypt.compare(value, req.user.password);
        if(!result) throw new Error(req.t('routes.member.errors.invalid_password'));
        return true;
    });
app.post('/member/signup/:token',
    nameChecker('username'),
    body('password')
        .if(body('from_oauth2').not().equals('Y'))
        .notEmpty()
        .withMessage('routes.member.errors.password_required'),
    body('password_confirm')
        .if(body('from_oauth2').not().equals('Y'))
        .notEmpty()
        .withMessage('routes.member.errors.password_confirm_required')
        .custom((value, { req }) => value === req.body.password)
        .withMessage('routes.member.errors.invalid_password_confirm'),
    middleware.fieldErrors,
    async (req, res) => {
    const token = await SignupToken.findOne({
        token: req.params.token
    });
    if(!token
        || Date.now() - token.createdAt > 1000 * 60 * 60 * 24
        || (token.ip && token.ip !== req.ip)) return res.status(400).send('invalid_email_token');

    if(!!token.name !== (req.body.username === 'special:bypass')) return res.status(400).json({
        fieldErrors: {
            username: {
                msg: 'invalid_username'
            }
        }
    });

    const emailDupCheck = await User.exists({
        email: token.email
    });
    if(!!emailDupCheck) return res.status(409).json({
        fieldErrors: {
            email: {
                msg: req.t('routes.member.errors.email_already_exists')
            }
        }
    });

    const name = token.name || req.body.username;
    const newUserJson = {
        email: token.email,
        password: req.body.password ? (await bcrypt.hash(req.body.password, 12)) : undefined,
        name,
        permissions: ['member', ...(token.phoneNumber ? ['mobile_verified_member'] : [])],
        phoneNumber: token.phoneNumber,
        phoneVerifiedAt: token.phoneNumber && Date.now()
    }

    const userExists = await User.exists({ type: UserTypes.Account });
    if(!userExists) {
        newUserJson.permissions.push('developer');
        await global.resetSearchIndex();
    }

    const newUser = new User(newUserJson);
    await newUser.save();

    if(token.oauth2Map) await OAuth2Map.create({
        user: newUser.uuid,
        ...token.oauth2Map
    });

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

    req.user = {
        ...newUser.toJSON(),
        avatar: utils.getGravatar(newUser.email)
    }
    req.session.loginUser = req.user.uuid;

    await utils.createLoginHistory(newUser, req);

    if(!res.headersSent) {
        req.session.fullReload = true;
        delete req.session.contributor;

        if(!userExists) return res.redirect('/admin/initial_setup');

        return res.renderSkin('signup', {
            contentHtml: `<p>${req.t('routes.member.signup_welcome', { value: `<b>${namumarkUtils.escapeHtml(newUser.name)}</b>` })}</p>`
        });
    }
});

app.get('/member/login', middleware.isLogout, middleware.checkCaptcha(true), async (req, res) => {
    if(!req.query.redirect && req.referer) {
        const url = new URL(req.url, config.base_url);
        url.searchParams.set('redirect', req.referer.pathname + req.referer.search);
        return res.redirect(url.pathname + url.search);
    }

    const disableInternal = !req.query.internal && (config.disable_internal_login || false);
    const externalProviders = Object.entries(config.oauth2_providers || {}).filter(([_, value]) => value.button).map(([name, value]) => ({
        name,
        ...value.button
    }));
    if(disableInternal && externalProviders.length === 1 && !req.query.internal)
        return res.redirect(`/member/login/oauth2/${externalProviders[0].name}?redirect=${encodeURIComponent(req.query.redirect || '/')}`);

    const passkeyData = await generateAuthenticationOptions({
        rpID: new URL(config.base_url).hostname
    });
    req.session.passkeyAuthOptions = passkeyData;

    res.renderSkin('login', {
        contentName: 'member/login',
        serverData: {
            disableSignup: !!config.disable_signup,
            disableInternal,
            externalProviders,
            passkeyData
        }
    });
});

app.post('/member/login',
    middleware.isLogout,
    body('email')
        .if(body('challenge').isEmpty())
        .notEmpty()
        .withMessage('routes.member.errors.email_required'),
    body('password')
        .if(body('challenge').isEmpty())
        .notEmpty()
        .withMessage('routes.member.errors.password_required'),
    body('challenge')
        .if(body('email').isEmpty())
        .notEmpty(),
    middleware.fieldErrors,
    async (req, res) => {
    const email = req.body.email;
    const password = req.body.password;

    if(!req.body.challenge && !await utils.middleValidateCaptcha(req, res, true)) return;

    const wrongCredentials = () => res.status(400).send(req.t('routes.member.errors.wrong_credentials'));

    let user;
    let keepOldEmailPin = false;
    if(email) try {
        const exUser = await User.findOne({
            $or: [
                { email },
                { name: email }
            ]
        });
        if(exUser != null) {
            const result = await bcrypt.compare(password, exUser.password);
            if(result) {
                if(config.disable_internal_login && !exUser.permissions.includes('developer'))
                    return res.status(400).send('internal_login_disabled');

                if(exUser.lastLoginRequest > Date.now() - 1000 * 60 * 10) {
                    user = exUser;
                    keepOldEmailPin = true;
                }
                else
                    user = await User.findOneAndUpdate({
                        uuid: exUser.uuid
                    }, {
                        emailPin: utils.getRandomInt(0, 999999).toString().padStart(6, '0'),
                        lastLoginRequest: new Date()
                    }, {
                        new: true
                    });
            }
            else {
                return wrongCredentials();
            }
        }
        else {
            return wrongCredentials();
        }
    } catch(err) {
        console.error(err);
        return res.status(500).send(req.t('errors.server_error'));
    }
    else {
        const options = req.session.passkeyAuthOptions;
        const response = req.body.challenge;
        const passkey = await Passkey.findOne({
            id: response.id
        });
        if(!passkey) return res.status(400).send(req.t('routes.member.errors.passkey_not_found'));

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
            return res.status(400).send(req.t('routes.member.errors.passkey_auth_failed'));
        }

        await Passkey.updateOne({
            id: response.id
        }, {
            counter: verification.authenticationInfo.newCounter,
            lastUsedAt: Date.now()
        });
        user = await User.findOne({
            uuid: passkey.user
        });

        if(!user.usePasswordlessLogin)
            return res.status(400).send(req.t('routes.member.errors.passwordless_login_disabled'));
    }

    let trusted = req.session.trustedAccounts?.includes(user.uuid);

    if((!user.totpToken && !config.use_email_verification) || user.permissions.includes('disable_two_factor_login')) {
        trusted = true;
    }

    if(!email) trusted = true;

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

        await utils.createLoginHistory(user, req);

        req.session.loginUser = user.uuid;
        delete req.session.oauth2Provider;
        if(!res.headersSent) {
            req.session.fullReload = true;
            delete req.session.contributor;
            res.redirect(req.body.redirect || '/');
            delete req.body.redirect;
            return;
        }
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
    res.renderSkin('login', {
        contentName: 'member/pin_verification',
        passkeyData,
        serverData: {
            email: user.email,
            useTotp: !!user.totpToken,
            autologin: req.body.autologin,
            hasPasskey,
            captchaData: {
                use: await utils.checkCaptchaRequired(req, true),
                force: true
            }
        }
    });

    if(!user.totpToken && !keepOldEmailPin) await mailTransporter.sendMail({
        from: config.smtp_sender,
        to: user.email,
        subject: `[${config.site_name}] ${req.t('routes.member.email.titles.pin')}`,
        html: `
${req.t('routes.member.email.contents.hello', { siteName: config.site_name })}
${req.t('routes.member.email.contents.pin_content', { pin: `<b>${user.emailPin}</b>` })}
${req.t('routes.member.email.contents.request_ip')}: ${req.ip}
    `.trim().replaceAll('\n', '<br>')
    });
});

app.post('/member/login/pin',
    middleware.isLogout,
    oneOf([
        body('pin')
            .notEmpty()
            .isLength(6)
            .withMessage('routes.member.errors.pin_length'),
        body('challenge')
            .notEmpty()
    ], {
        message: 'errors.required_field'
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

    if(!req.body.challenge && !await utils.middleValidateCaptcha(req, res, true)) return;

    if(user.totpToken) {
        if(req.body.challenge) {
            const options = req.session.passkeyAuthOptions;
            const response = req.body.challenge;
            const passkey = await Passkey.findOne({
                id: response.id
            });
            if(!passkey) return res.status(400).send(req.t('routes.member.errors.passkey_not_found'));

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
                return res.status(400).send(req.t('routes.member.errors.passkey_auth_failed'));
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
            if(delta == null) return res.status(400).send(req.t('routes.member.errors.invalid_pin'));
        }
    }
    else {
        if(req.body.pin !== user.emailPin) return res.status(400).send(req.t('routes.member.errors.invalid_pin'));
    }

    delete req.session.pinUser;

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

    req.session.loginUser = user.uuid;
    delete req.session.oauth2Provider;
    if(!res.headersSent) {
        req.session.fullReload = true;
        delete req.session.contributor;
        res.redirect(req.session.redirect || '/');
        delete req.session.redirect;
    }

    await utils.createLoginHistory(user, req);
});

app.get('/member/login/oauth2/:provider', async (req, res) => {
    const provider = config.oauth2_providers?.[req.params.provider];
    if(!provider) return res.error('provider_config_not_found', 404);

    if(req.user?.type === UserTypes.Account) {
        const map = await OAuth2Map.exists({
            provider: req.params.provider,
            user: req.user.uuid
        });
        if(map) return res.error(req.t('routes.member.errors.dup_oauth2_map'), 409);
    }

    const redirect = req.query.redirect;
    if(redirect) req.session.redirect = redirect;
    req.session.autologin = req.query.autologin === 'Y';

    req.session.oauth2State = crypto.randomUUID();

    const url = new URL(provider.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', provider.client_id);
    url.searchParams.set('redirect_uri', new URL(`/member/login/oauth2/${req.params.provider}/callback`, config.base_url).toString());
    url.searchParams.set('scope', typeof provider.scopes === 'string' ? provider.scopes : provider.scopes.join(' '));
    url.searchParams.set('state', req.session.oauth2State);

    if(provider.code_challenge_method === 'S256') {
        req.session.oauth2CodeChallenge = crypto.randomBytes(64).toString('base64url');
        url.searchParams.set('code_challenge', crypto.createHash('sha256').update(req.session.oauth2CodeChallenge).digest('base64url'));
        url.searchParams.set('code_challenge_method', 'S256');
    }

    for(const [key, value] of Object.entries(provider.authorization_query || {})) {
        url.searchParams.set(key, value);
    }

    res.redirect(url.toString());
});

app.get('/member/login/oauth2/:provider/callback',
    query('code')
        .notEmpty(),
    query('state')
        .isUUID(),
    middleware.singleFieldError,
    async (req, res) => {
    const provider = config.oauth2_providers?.[req.params.provider];
    if(!provider) return res.error('provider_config_not_found', 404);

    if(req.session.oauth2State !== req.query.state)
        return res.error('invalid_state');

    let tokenData;
    try {
        const { data } = await axios.post(provider.token_endpoint, new URLSearchParams({
            // client_id: provider.client_id,
            // client_secret: provider.client_secret,
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: `${new URL(req.path, config.base_url).toString()}`,
            ...(provider.code_challenge_method === 'S256' ? {
                code_verifier: req.session.oauth2CodeChallenge
            } : {})
        }), {
            auth: {
                username: provider.client_id,
                password: provider.client_secret
            },
            headers: {
                Accept: 'application/json'
            }
        });
        tokenData = data;
    } catch(e) {
        if(debug) console.error(e);
        return res.error('invalid_code');
    }

    if(!tokenData.scope || !tokenData.access_token)
        return res.error(req.t('routes.member.errors.invalid_oauth2_token_data'));

    const scopes = tokenData.scope.split(' ');
    const missingScope = provider.scopes.find(a => !scopes.includes(a));
    if(missingScope)
        return res.error(req.t('routes.member.errors.missing_oauth2_scope', { value: missingScope }));

    let userData;
    try {
        const { data } = await axios.get(provider.userinfo_endpoint, {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`
            }
        });
        userData = data;
    } catch(e) {
        if(debug) console.error(e);
        return res.error(req.t('routes.member.errors.oauth2_userinfo_failed'));
    }

    let map = await OAuth2Map.findOne({
        provider: req.params.provider,
        sub: utils.getObjectValueFallback(userData, [...[provider.sub_key].flat(), 'sub'])
    });

    if(req.user?.type === UserTypes.Account) {
        if(map) return res.error(req.t('routes.member.errors.oauth2_connected_to_other_internal_account'), 409);
        const providerCheck = await OAuth2Map.exists({
            provider: req.params.provider,
            user: req.user.uuid
        });
        if(providerCheck) return res.error(req.t('routes.member.errors.oauth2_dup_provider'), 409);

        await OAuth2Map.create({
            provider: req.params.provider,
            sub: utils.getObjectValueFallback(userData, [...[provider.sub_key].flat(), 'sub']),
            user: req.user.uuid,
            name: utils.getObjectValueFallback(userData, [...[provider.name_key].flat(), 'name']),
            email: utils.getObjectValueFallback(userData, [...[provider.email_key].flat(), 'email'])
        });
        return res.redirect('/member/mypage');
    }

    if(!map) {
        const email = utils.getObjectValueFallback(userData, [...[provider.email_key].flat(), 'email']);
        if(email && utils.getObjectValueFallback(userData, [...[provider.email_verified_key].flat(), 'email_verified']) !== false) {
            const checkUser = await User.findOne({ email });
            if(checkUser) {
                if(provider.disable_auto_register)
                    return res.error(req.t('routes.member.errors.oauth2_not_connected_and_email_dup'));
                map = await OAuth2Map.create({
                    provider: req.params.provider,
                    sub: utils.getObjectValueFallback(userData, [...[provider.sub_key].flat(), 'sub']),
                    user: checkUser.uuid,
                    name: utils.getObjectValueFallback(userData, [...[provider.name_key].flat(), 'name']),
                    email: utils.getObjectValueFallback(userData, [...[provider.email_key].flat(), 'email'])
                });
            }
            else {
                if(provider.disable_auto_register)
                    return res.error(req.t('routes.member.errors.oauth2_internal_account_not_found'));

                if(!provider.disable_email_whitelist) {
                    const emailDomain = email.split('@').pop();
                    if(config.email_whitelist.length && !config.email_whitelist.includes(emailDomain))
                        return res.error(req.t('routes.member.errors.email_not_whitelisted'));
                }

                const checkBlacklist = await Blacklist.exists({
                    email: crypto.createHash('sha256').update(email).digest('hex')
                });
                if(checkBlacklist) return res.error(req.t('routes.member.errors.signup_blacklist'), 403);

                await SignupToken.deleteMany({
                    email
                });
                await SignupToken.deleteMany({
                    ip: req.ip
                });

                const newToken = await SignupToken.create({
                    email,
                    ip: req.ip,
                    oauth2Map: {
                        provider: req.params.provider,
                        sub: utils.getObjectValueFallback(userData, [...[provider.sub_key].flat(), 'sub']),
                        name: utils.getObjectValueFallback(userData, [...[provider.name_key].flat(), 'name']),
                        email: utils.getObjectValueFallback(userData, [...[provider.email_key].flat(), 'email'])
                    }
                });
                return res.redirect(`/member/signup/${newToken.token}`);
            }
        }
        else return res.error(req.t('routes.member.errors.oauth2_not_connected_account'));
    }

    req.session.loginUser = map.user;
    req.session.oauth2Provider = req.params.provider;

    if(req.session.autologin) {
        const token = await AutoLoginToken.create({
            uuid: map.user
        });
        res.cookie('honoka', token.token, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365,
            sameSite: 'lax'
        });
    }

    res.redirect(req.session.redirect || '/');
    delete req.session.redirect;
    delete req.session.autologin;
});

app.delete('/member/login/oauth2/:provider', middleware.isLogin, async (req, res) => {
    const provider = config.oauth2_providers?.[req.params.provider];
    if(!provider) return res.status(404).send('provider_config_not_found');

    const mapCount = await OAuth2Map.countDocuments({
        user: req.user.uuid
    });
    if(mapCount <= 1 && !req.user.password)
        return res.status(400).send(req.t('routes.member.errors.set_password_for_clear_oauth2'));

    const deleted = await OAuth2Map.findOneAndDelete({
        user: req.user.uuid,
        provider: req.params.provider
    });
    if(!deleted) return res.status(404).send(req.t('routes.member.errors.oauth2_map_not_found'));

    res.reload();
});

app.get('/member/logout', middleware.isLogin, async (req, res) => {
    await AutoLoginToken.deleteOne({
        uuid: req.user.uuid,
        token: req.cookies.honoka
    });
    delete req.session.loginUser;
    req.session.fullReload = true;
    delete req.session.contributor;
    res.clearCookie('honoka');

    if(req.session.oauth2Provider) {
        const provider = config.oauth2_providers?.[req.session.oauth2Provider];
        if(provider?.end_session_endpoint)
            return res.redirect(provider.end_session_endpoint);
    }

    res.redirect(req.query.redirect || req.get('Referer') || '/');
});

app.get('/member/mypage', middleware.isLogin, async (req, res) => {
    const passkeys = await Passkey.find({
        user: req.user.uuid
    }).select('name createdAt lastUsedAt -_id');
    const oauth2Maps = await OAuth2Map.find({
        user: req.user.uuid
    }).select('provider name email -_id');

    res.renderSkin('mypage', {
        contentName: 'member/mypage',
        serverData: {
            skins: Object.keys(global.skinInfos).filter(a => a !== 'plain'),
            passkeys,
            user: utils.onlyKeys(req.user, ['name', 'email', 'skin', 'usePasswordlessLogin']),
            permissions: req.displayPermissions,
            hasTotp: !!req.user.totpToken,
            canWithdraw: config.can_withdraw !== false,
            externalProviders: Object.entries(config.oauth2_providers || {}).filter(([name, value]) => !value.hidden).map(([name, value]) => ({
                name,
                displayName: value.display_name
            })),
            oauth2Maps: Object.fromEntries(oauth2Maps.map(a => [a.provider, a])),
            verifyEnabled: config.verify_enabled && global.plugins.mobileVerify.length
        }
    });
});

app.post('/member/mypage', middleware.isLogin,
    body('skin')
        .custom(value => ['default', ...Object.keys(global.skinInfos).filter(a => a !== 'plain')].includes(value))
        .withMessage('invalid_skin'),
    middleware.fieldErrors,
    async (req, res) => {
    await User.updateOne({
        uuid: req.user.uuid
    }, {
        skin: req.body.skin,
        usePasswordlessLogin: req.body.usePasswordlessLogin === 'Y'
    });

    if(req.user.skin !== req.body.skin)
        req.session.fullReload = true;

    res.redirect('/member/mypage');
});

app.post('/member/generate_api_token',
    middleware.isLogin,
    passwordChecker('password'),
    middleware.singleFieldError,
    async (req, res) => {
    const apiToken = crypto.randomBytes(128).toString('base64');
    await User.updateOne({
        uuid: req.user.uuid
    }, {
        apiToken
    });

    res.partial({
        apiToken
    });
});

app.get('/member/change_password', middleware.isLogin, (req, res) => {
    res.renderSkin('change_password', {
        contentName: 'member/change_password'
    });
});

app.post('/member/change_password',
    middleware.isLogin,
    passwordChecker('old_password'),
    body('password')
        .notEmpty().withMessage('routes.member.errors.password_required'),
    body('password_confirm')
        .notEmpty().withMessage('routes.member.errors.password_confirm_required')
        .custom((value, { req }) => value === req.body.password)
        .withMessage('routes.member.errors.invalid_password_confirm'),
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
    if(!user) return res.error(req.t('errors.account_not_found'), 404);

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

    const blacklistedNamespaces = [];
    if(!req.permissions.includes('config'))
        blacklistedNamespaces.push(...(config.hidden_namespaces ?? []));

    const countQuery = {
        ...(logType != null ? { type: logType } : {}),
        user: req.params.uuid
    }
    const baseQuery = {
        ...countQuery,
        ...(blacklistedNamespaces.length ? {
            namespace: {
                $nin: blacklistedNamespaces
            }
        } : {})
    }
    const query = { ...baseQuery };

    const total = await History.countDocuments(countQuery);
    // if(!total) return res.error('계정을 찾을 수 없습니다.', 404);

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

    for(let rev of revs) {
        if(rev.troll || (rev.hideLog && !req.permissions.includes('hide_document_history_log')))
            delete rev.log;
    }

    res.renderSkin(req.t('titles.user_contribution', { value: user ? `"${namumarkUtils.escapeHtml(user.name || user.ip)}"` : `<${req.t('routes.member.deleted_user')}>` }), {
        viewName: 'contribution',
        contentName: 'userContribution/document',
        account: {
            uuid: req.params.uuid,
            name: user?.name ?? user?.ip,
            type: user?.type ?? UserTypes.Deleted,
            aclGroupStyle: (await utils.getUserCSS(user)) || null
        },
        serverData: {
            revs: revs.map(a => utils.addHistoryData(req, a, req.permissions.includes('admin'), null)),
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
    const hasContribution = await History.exists({
        user: req.params.uuid
    });
    // if(!hasContribution) return res.error('계정을 찾을 수 없습니다.', 404);

    const data = await utils.pagination(req, ThreadComment, {
        user: req.params.uuid
    }, 'uuid', 'createdAt', {
        getTotal: true
    });
    data.items = await utils.findThreads(data.items);
    data.items = utils.onlyKeys(data.items, ['thread', 'id', 'createdAt']);

    res.renderSkin(req.t('titles.user_contribution', { value: user ? `"${namumarkUtils.escapeHtml(user.name || user.ip)}"` : `<${req.t('routes.member.deleted_user')}>` }), {
        viewName: 'contribution_discuss',
        contentName: 'userContribution/discuss',
        account: {
            uuid: req.params.uuid,
            name: user?.name ?? user?.ip,
            type: user?.type ?? UserTypes.Deleted,
            aclGroupStyle: (await utils.getUserCSS(user)) || null
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
    const hasContribution = await History.exists({
        user: req.params.uuid
    });
    // if(!hasContribution) return res.error('계정을 찾을 수 없습니다.', 404);

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

    res.renderSkin(req.t('titles.user_contribution', { value: user ? `"${namumarkUtils.escapeHtml(user.name || user.ip)}"` : `<${req.t('routes.member.deleted_user')}>` }), {
        viewName: 'contribution_edit_request',
        contentName: 'userContribution/editRequest',
        account: {
            uuid: req.params.uuid,
            name: user?.name ?? user?.ip,
            type: user?.type ?? UserTypes.Deleted,
            aclGroupStyle: (await utils.getUserCSS(user)) || null
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
    const hasContribution = await History.exists({
        user: req.params.uuid
    });
    // if(!hasContribution) return res.error('계정을 찾을 수 없습니다.', 404);

    const data = await utils.pagination(req, EditRequest, {
        lastUpdateUser: req.params.uuid
    }, 'uuid', '_id', {
        getTotal: true
    });
    data.items = await utils.findUsers(req, data.items, 'createdUser');
    data.items = await utils.findDocuments(data.items);
    data.items = utils.onlyKeys(data.items, ['url', 'document', 'status', 'lastUpdatedAt', 'diffLength', 'createdUser']);

    res.renderSkin(req.t('titles.user_contribution', { value: user ? `"${namumarkUtils.escapeHtml(user.name || user.ip)}"` : `<${req.t('routes.member.deleted_user')}>` }), {
        viewName: 'contribution_edit_request',
        contentName: 'userContribution/editRequest',
        account: {
            uuid: req.params.uuid,
            name: user?.name ?? user?.ip,
            type: user?.type ?? UserTypes.Deleted,
            aclGroupStyle: (await utils.getUserCSS(user)) || null
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
        withdrawPeriodHours: {
            $gt: 0
        }
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
        noActivityTime = 1000 * 60 * 60 * (aclGroups.find(a => a.uuid === aclGroupItem.aclGroup)?.withdrawPeriodHours ?? 24);

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
        return res.error(req.t('routes.member.errors.withdraw_disabled'), 403);

    const { deletable, blacklistDuration, noActivityTime } = await checkDeletable(req.user);

    res.renderSkin('withdraw', {
        contentName: 'member/withdraw',
        serverData: {
            blacklistDays: blacklistDuration && Math.round(blacklistDuration / 1000 / 60 / 60 / 24),
            alert: deletable ? null : req.t('routes.member.errors.withdraw_last_activity'),
            noActivityTime,
            pledge: config.withdraw_pledge
        }
    });
});

const withdrawAction = async (user, actUser) => {
    actUser ??= user;

    await User.deleteOne({
        uuid: user.uuid
    });
    await AutoLoginToken.deleteMany({
        uuid: user.uuid
    });

    const userDocs = await Document.find({
        namespace: '사용자',
        $or: [
            {
                title: user.name
            },
            {
                title: {
                    $regex: new RegExp(`^${utils.escapeRegExp(user.name)}/`)
                }
            }
        ]
    });
    for(let dbDocument of userDocs) {
        let newDbDocument;
        try {
            newDbDocument = await Document.findOneAndUpdate({
                uuid: dbDocument.uuid
            }, {
                namespace: '삭제된사용자',
                title: dbDocument.title.replace(user.name, user.uuid)
            }, {
                new: true
            });
        } catch(e) {
            continue;
        }
        await History.create({
            user: actUser.uuid,
            type: HistoryTypes.Move,
            document: dbDocument.uuid,
            moveOldDoc: `사용자:${dbDocument.title}`,
            moveNewDoc: `삭제된사용자:${newDbDocument.title}`
        });
        await History.create({
            user: actUser.uuid,
            type: HistoryTypes.Delete,
            document: dbDocument.uuid,
            content: null
        });
    }
}
module.exports.withdrawAction = withdrawAction;

app.post('/member/withdraw',
    middleware.isLogin,
    passwordChecker('password'),
    body('pledge')
        .notEmpty().withMessage('errors.required_field')
        .equals(config.withdraw_pledge).withMessage('routes.member.errors.pledge_different'),
    middleware.fieldErrors,
    async (req, res) => {
    if(config.can_withdraw === false)
        return res.error(req.t('routes.member.errors.withdraw_disabled'), 403);

    const { deletable, blacklistDuration } = await checkDeletable(req.user);
    if(!deletable) return res.status(403).send(req.t('routes.member.errors.withdraw_last_activity'));

    if(blacklistDuration == null || blacklistDuration > 0)
        await Blacklist.create({
            email: crypto.createHash('sha256').update(req.user.email).digest('hex'),
            phone: req.user.phone ? crypto.createHash('sha256').update(req.user.phone).digest('hex') : null,
            expiresAt: blacklistDuration ? new Date(Date.now() + blacklistDuration) : null
        });

    await withdrawAction(req.user);

    delete req.session.loginUser;
    req.session.fullReload = true;
    delete req.session.contributor;
    res.clearCookie('honoka');
    res.redirect('/member/login');
});

app.get('/member/change_name', middleware.isLogin, (req, res) => {
    res.renderSkin('change_name', {
        contentName: 'member/change_name',
        serverData: {
            ...(Date.now() - req.user.lastNameChange < 1000 * 60 * 60 * 24 * 30 ? {
                alert: req.t('routes.member.errors.recent_change_name')
            } : {})
        }
    });
});

const changeNameAction = async (user, name, actUser) => {
    actUser ??= user;

    await User.updateOne({
        uuid: user.uuid
    }, {
        name,
        lastNameChange: Date.now()
    });

    const userDocs = await Document.find({
        namespace: '사용자',
        $or: [
            {
                title: user.name
            },
            {
                title: {
                    $regex: new RegExp(`^${utils.escapeRegExp(user.name)}/`)
                }
            }
        ]
    });
    for(let dbDocument of userDocs) {
        const newDbDocument = await Document.findOneAndUpdate({
            uuid: dbDocument.uuid
        }, {
            title: dbDocument.title.replace(`${user.name}`, `${name}`)
        }, {
            new: true
        });
        await History.create({
            user: actUser.uuid,
            type: HistoryTypes.Move,
            document: dbDocument.uuid,
            moveOldDoc: `사용자:${dbDocument.title}`,
            moveNewDoc: `사용자:${newDbDocument.title}`
        });
    }
}
module.exports.changeNameAction = changeNameAction;

app.post('/member/change_name',
    middleware.isLogin,
    passwordChecker('password'),
    nameChecker('name'),
    middleware.fieldErrors,
    async (req, res) => {
    if(Date.now() - req.user.lastNameChange < 1000 * 60 * 60 * 24 * 30)
        return res.status(403).send(req.t('routes.member.errors.recent_change_name'));

    await changeNameAction(req.user, req.body.name);

    res.redirect('/member/mypage');
});

app.get('/member/change_email', middleware.isLogin, (req, res) => {
    const doingChangeEmail = Date.now() - req.user.lastChangeEmail < 1000 * 60 * 10;
    res.renderSkin('change_email', {
        contentName: 'member/change_email',
        serverData: {
            ...(doingChangeEmail ? {
                alert: req.t('routes.member.errors.doing_change_email')
            } : {}),
            doingChangeEmail,
            email: req.user.email,
            emailWhitelist: config.email_whitelist
        }
    });
});

app.post('/member/change_email',
    middleware.isLogin,
    passwordChecker('password'),
    body('email')
        .notEmpty().withMessage('routes.member.errors.email_required')
        .isEmail().withMessage('routes.member.errors.invalid_email')
        .normalizeEmail()
        .custom((value, {req}) => value !== req.user.email).withMessage('errors.same_document_content'),
    middleware.fieldErrors,
    async (req, res) => {
    if(Date.now() - req.user.lastChangeEmail < 1000 * 60 * 10)
        return res.status(409).send(req.t('routes.member.errors.doing_change_email'));

    const email = req.body.email;

    const emailDomain = email.split('@').pop();
    if(config.email_whitelist.length && !config.email_whitelist.includes(emailDomain))
        return res.status(400).send(req.t('routes.member.errors.email_not_whitelisted'));

    const checkBlacklist = await Blacklist.exists({
        email: crypto.createHash('sha256').update(email).digest('hex')
    });
    if(checkBlacklist) return res.status(403).send({
        fieldErrors: {
            email: {
                msg: req.t('routes.member.errors.signup_blacklist')
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
                subject: `[${config.site_name}] ${req.t('routes.member.email.titles.change_email', { value: req.user.name })}`,
                html: `
${req.t('routes.member.email.contents.hello', { value: config.site_name })}

${req.t('routes.member.email.contents.change_email_content', { value: req.user.name })}
${req.t('routes.member.email.contents.change_email_dup')}

${req.t('routes.member.email.contents.request_ip')} : ${req.ip}
    `.trim().replaceAll('\n', '<br>')
            });
        }
        else res.status(409).send(req.t('routes.member.errors.already_registered_email'));

        return;
    }

    const authUrl = `/member/auth/${req.user.name}/${newUser.changeEmailToken}`;
    if(config.use_email_verification) {
        res.redirect('/member/mypage');

        await mailTransporter.sendMail({
            from: config.smtp_sender,
            to: email,
            subject: `[${config.site_name}] ${req.t('routes.member.email.titles.change_email', { value: req.user.name })}`,
            html: `
${req.t('routes.member.email.contents.hello', { value: config.site_name })}

${req.t('routes.member.email.contents.change_email_content', { value: req.user.name })}
${req.t('routes.member.email.contents.change_email_link', {
    linkOpen: `<a href="${new URL(authUrl, config.base_url)}">`,
    linkClose: '</a>'
})}
${req.t('routes.member.email.contents.request_ip')} : ${req.ip}
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
        return res.error(req.t('routes.member.errors.invalid_email_token'));

    const emailDupCheck = await User.exists({
        email: user.changeEmail
    });
    if(!!emailDupCheck) return res.error(req.t('routes.member.errors.email_already_exists'), 409);

    await User.updateOne({
        uuid: user.uuid
    }, {
        email: user.changeEmail,
        changeEmail: null,
        changeEmailToken: null,
        lastChangeEmail: null
    });

    res.renderSkin('email_verified', {
        contentHtml: req.t('routes.member.email_verified', {
            name: `<strong>${namumarkUtils.escapeHtml(user.name)}</strong>`,
            linkOpen: `<a href="/member/login">`,
            linkClose: '</a>'
        }).replaceAll('\n', '<br>')
    });
});

app.get('/member/activate_otp', middleware.isLogin, async (req, res) => {
    if(req.user.totpToken) return res.error('already_activated_otp');

    const totp = new TOTP({
        issuer: config.site_name,
        label: req.user.name
    });
    const secret = totp.secret.base32;
    req.session.totpToken = secret;

    const qrUrl = totp.toString();
    const qrcode = await QRCode.toDataURL(qrUrl);

    res.renderSkin('activate_otp', {
        contentName: 'member/activate_otp',
        serverData: {
            secret,
            qrUrl,
            qrcode
        }
    });
});

app.post('/member/activate_otp',
    middleware.isLogin,
    body('pin')
        .notEmpty().withMessage('errors.required_field')
        .isLength({
            min: 6,
            max: 6
        }).withMessage('routes.member.errors.pin_length'),
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
                msg: req.t('routes.member.errors.invalid_pin')
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

    res.renderSkin('deactivate_otp', {
        contentName: 'member/deactivate_otp'
    });
});

app.post('/member/deactivate_otp',
    middleware.isLogin,
    body('pin')
        .notEmpty().withMessage('errors.required_field')
        .isLength({
            min: 6,
            max: 6
        }).withMessage('routes.member.errors.pin_length'),
    middleware.fieldErrors,
    async (req, res) => {
    if(!req.user.totpToken) return res.error('not_activated_otp');

    const totp = new TOTP({
        secret: req.user.totpToken
    });
    const delta = totp.validate({ token: req.body.pin });
    if(delta == null) return res.status(400).json({
        fieldErrors: {
            pin: {
                msg: req.t('routes.member.errors.invalid_pin')
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

app.get('/member/recover_password', middleware.isLogout, middleware.checkCaptcha(true), (req, res) => {
    if(!config.use_email_verification) return res.error(req.t('routes.member.errors.email_verification_disabled'));

    res.renderSkin('recover_password', {
        contentName: 'member/recover_password'
    });
});

app.post('/member/recover_password', middleware.isLogout, middleware.captcha(true), async (req, res) => {
    if(!config.use_email_verification) return res.error(req.t('routes.member.errors.email_verification_disabled'));

    const email = req.body.email;
    if(!email) return res.status(400).send(req.t('routes.member.errors.email_required'));

    res.renderSkin('recover_password', {
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
        subject: `[${config.site_name}] ${req.t('routes.member.email.titles.recover_password', { value: newUser.name })}`,
        html: `
${req.t('routes.member.email.contents.hello', { value: config.site_name })}

${newUser.name}님의 비밀번호 찾기 메일입니다.
해당 계정의 비밀번호를 찾으시려면 아래 링크를 클릭해주세요.
<a href="${new URL(authUrl, config.base_url)}">[인증]</a>

이 메일은 24시간동안 유효합니다.
${req.t('routes.member.email.contents.recover_password_content', {
    user: namumarkUtils.escapeHtml(newUser.name), 
    linkOpen: `<a href="${new URL(authUrl, config.base_url)}">`,
    linkClose: '</a>'
})}
${req.t('routes.member.email.contents.request_ip')} : ${req.ip}
        `.trim().replaceAll('\n', '<br>')
    });
});

app.get('/member/recover_password/auth/:name/:token', (req, res) => {
    res.renderSkin('recover_password', {
        contentName: 'member/recover_password_final'
    });
});

app.post('/member/recover_password/auth/:name/:token',
    body('password')
        .notEmpty()
        .withMessage('routes.member.errors.password_required'),
    body('password_confirm')
        .notEmpty()
        .withMessage('routes.member.errors.password_confirm_required')
        .custom((value, { req }) => value === req.body.password)
        .withMessage('routes.member.errors.invalid_password_confirm'),
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
    if(!user) return res.status(400).send(req.t('routes.member.errors.invalid_email_token'));

    res.redirect('/member/login');
});

const starHandler = starred => async (req, res) => {
    const document = req.document;
    const dbDocument = await Document.findOne({
        namespace: document.namespace,
        title: document.title
    });
    if(!dbDocument) return res.error(req.t('errors.document_not_found'), 404);

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

    if(req.referer?.pathname.startsWith('/member/starred_documents')) res.status(204).end();
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

    res.renderSkin('starred_documents', {
        contentName: 'member/starred_documents',
        serverData: {
            stars
        }
    });
});

app.get('/member/star{/*document}', middleware.isLogin, middleware.parseDocumentName, starHandler(true));
app.get('/member/unstar{/*document}', middleware.isLogin, middleware.parseDocumentName, starHandler(false));

app.post('/member/register_webauthn',
    middleware.isLogin,
    body('name')
        .notEmpty().withMessage('routes.member.errors.passkey_name_required')
        .isLength({
            max: 80
        }).withMessage('routes.member.errors.passkey_name_max_length'),
    middleware.singleFieldError,
    async (req, res) => {
    const userPasskeys = await Passkey.find({
        user: req.user.uuid
    });
    if(userPasskeys.some(a => a.name === req.body.name))
        return res.status(409).send('routes.member.errors.passkey_name_dup');

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

    res.reload();
});

app.post('/member/delete_webauthn',
    body('name')
        .notEmpty().withMessage('routes.member.errors.passkey_name_required'),
    middleware.singleFieldError,
    async (req, res) => {
    await Passkey.deleteOne({
        user: req.user.uuid,
        name: req.body.name
    });
    res.reload();
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

    res.renderSkin('notifications', {
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

let vapidKeys;
app.get('/member/notifications/subscribe', middleware.isLogin, async (req, res) => {
    vapidKeys ??= await ServerKeyValue.findOne({
        key: 'vapidKeys'
    });
    vapidKeys ??= await ServerKeyValue.create({
        key: 'vapidKeys',
        value: webpush.generateVAPIDKeys()
    });

    return res.json({ applicationServerKey: vapidKeys.value.publicKey });
});

app.post('/member/notifications/subscribe', middleware.isLogin, async (req, res) => {
    await PushSubscription.create({
        user: req.user.uuid,
        expiresAt: isNaN(req.body.expirationTime) ? new Date(req.body.expirationTime) : undefined,
        endpoint: req.body.endpoint,
        p256dh: req.body.keys.p256dh,
        auth: req.body.keys.auth
    });
    res.status(201).end();
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

app.get('/member/signup_verify', async (req, res) => {
    if(!config.verify_enabled || !global.plugins.mobileVerify.length) return res.error(req.t('routes.member.errors.mobile_verify_disabled'));

    if(req.user?.type !== UserTypes.Account && !req.session.signupVerifyInfo)
        return res.redirect('/member/signup');
    if(req.user?.permissions.includes('mobile_verified_member')) return res.error('already_mobile_verified');

    const mobileVerifyInfo = await MobileVerifyInfo.findOne({
        sessionId: req.session.sessionId
    });
    if(mobileVerifyInfo)
        return res.redirect('/member/signup_verify_code');

    const countryCodes = CountryCodes.filter(a => !config.verify_countries?.length
        || (config.verify_countries?.includes(a.code) === (config.verify_countries_whitelist ?? true)));
    res.renderSkin('signup_verify', {
        contentName: 'member/signup_verify',
        serverData: {
            countryCodes,
            verifyText: config.verify_text,
            countryCode: (req.countryCode ?? '').toLowerCase(),
            note: req.session.signupVerifyInfo?.note
        }
    });
});

app.post('/member/signup_verify',
    body('countryCode')
        .custom(value => CountryCodes.some(a => a.code === value) && (!config.verify_countries?.length || (config.verify_countries?.includes(value) === (config.verify_countries_whitelist ?? true))))
        .withMessage('errors.invalid_field')
        .custom((value, { req }) => config.verify_countries_ip_match === false || req.countryCode.toLowerCase() === value)
        .withMessage('routes.member.errors.phone_number_and_ip_country_mismatch'),
    body('phoneNumber')
        .notEmpty().withMessage('errors.required_field')
        .customSanitizer((value, { req }) => parsePhoneNumber(value, req.body.countryCode.toUpperCase()))
        .custom(async value => {
            const isValid = value?.isValid();
            if(!isValid) throw new Error(req.t('routes.member.errors.invalid_phone_number'));

            const plugin = global.plugins.mobileVerify[0];
            if(plugin.validate) {
                const pluginValid = await plugin.validate(value);
                if(!pluginValid) throw new Error(req.t('routes.member.errors.invalid_phone_number'));
            }
        }),
    middleware.fieldErrors,
    async (req, res) => {
    if(!config.verify_enabled || !global.plugins.mobileVerify.length) return res.error(req.t('routes.member.errors.mobile_verify_disabled'));

    if(req.user?.type !== UserTypes.Account && !req.session.signupVerifyInfo)
        return res.redirect('/member/signup');
    if(req.user?.permissions.includes('mobile_verified_member')) return res.error('already_mobile_verified');

    const existingVerify = await MobileVerifyInfo.exists({
        phoneNumber: req.body.phoneNumber.number
    });
    if(existingVerify) return res.status(409).send(req.t('routes.member.errors.phone_number_verify_in_progress'));

    const pin = utils.getRandomInt(0, 999999).toString().padStart(6, '0');
    const plugin = global.plugins.mobileVerify[0];

    try {
        await plugin.verify(req.body.phoneNumber, pin);
    } catch (e) {
        console.error(e);
        return res.status(500).send(req.t('routes.member.errors.mobile_verify_internal_error'));
    }

    await MobileVerifyInfo.create({
        sessionId: req.session.sessionId,
        user: req.user.uuid,
        email: req.session.signupVerifyInfo?.email,
        phoneNumber: req.body.phoneNumber.number,
        pin
    });
        delete req.session.signupVerifyInfo;

    res.redirect('/member/signup_verify_code');
});

app.get('/member/signup_verify_code', async (req, res) => {
    const mobileVerifyInfo = await MobileVerifyInfo.findOne({
        sessionId: req.session.sessionId
    });
    if(!mobileVerifyInfo) return res.redirect('/');

    res.renderSkin('signup_verify', {
        contentName: 'member/signup_verify_code'
    });
});

app.post('/member/signup_verify_code',
    body('pin')
        .if(body('cancel').not().equals('true'))
        .notEmpty().withMessage('errors.required_field'),
    middleware.fieldErrors,
    async (req, res) => {
    if(req.body.cancel === 'true') {
        await MobileVerifyInfo.deleteOne({
            sessionId: req.session.sessionId
        });
        return res.redirect('/');
    }

    const mobileVerifyInfo = await MobileVerifyInfo.findOne({
        sessionId: req.session.sessionId
    });
    if(!mobileVerifyInfo) return res.redirect('/');

    if(req.body.pin !== mobileVerifyInfo.pin) {
        if(mobileVerifyInfo.tries >= 5) await MobileVerifyInfo.deleteOne({
            sessionId: req.session.sessionId
        });
        else await MobileVerifyInfo.updateOne({
            sessionId: req.session.sessionId
        }, {
            $inc: {
                tries: 1
            }
        });
        return res.status(400).json({
            fieldErrors: {
                pin: {
                    msg: req.t('routes.member.errors.invalid_pin')
                }
            }
        });
    }

    const checkBlacklist = await Blacklist.exists({
        phone: crypto.createHash('sha256').update(mobileVerifyInfo.phoneNumber).digest('hex')
    });
    if(checkBlacklist) return res.status(403).send(req.t('routes.member.errors.signup_blacklist'));

    const checkNumberExists = await User.exists({
        phoneNumber: mobileVerifyInfo.phoneNumber,
        permissions: 'mobile_verified_member',
        phoneVerifiedAt: {
            $gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * (config.verify_change_cooldown_days ?? 0))
        }
    });
    if(checkNumberExists) return res.status(409).send(req.t('routes.member.errors.phone_number_already_used'));

    await MobileVerifyInfo.deleteOne({
        sessionId: req.session.sessionId
    });

    await User.updateOne({
        phoneNumber: mobileVerifyInfo.phoneNumber
    }, {
        $pull: {
            permissions: 'mobile_verified_member'
        },
        $unset: {
            phoneNumber: 1,
            phoneVerifiedAt: 1
        }
    });

    if(req.user?.type === UserTypes.Account) await User.updateOne({
        uuid: req.user.uuid
    }, {
        phoneNumber: mobileVerifyInfo.phoneNumber,
        phoneVerifiedAt: Date.now(),
        $addToSet: {
            permissions: 'mobile_verified_member'
        }
    });
    else if(mobileVerifyInfo.email) return signupAction(mobileVerifyInfo.email, req, res, mobileVerifyInfo.phoneNumber);

    res.redirect('/member/mypage');
});

app.post('/member/ipskin', middleware.isLogout, (req, res) => {
    const allSkins = Object.keys(global.skinInfos).filter(a => a !== 'plain');
    const skin = req.body.skin;
    if(allSkins.includes(skin))
        req.session.skin = skin;
    else
        delete req.session.skin;

    res.reload();
});

module.exports.router = app;