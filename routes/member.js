const express = require('express');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const passport = require('passport');
const { Address4, Address6 } = require('ip-address');

const utils = require('../utils');
const middleware = require('../utils/middleware');
const {
    HistoryTypes
} = require('../utils/types');

const User = require('../schemas/user');
const SignupToken = require('../schemas/signupToken');
const LoginHistory = require('../schemas/loginHistory');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');

const app = express.Router();

const renderSignup = (res, data = {}) => res.renderSkin('계정 만들기', {
    ...data,
    contentName: 'signup'
});

app.get('/member/signup', middleware.isLogout, (req, res) => {
    renderSignup(res);
});

app.post('/member/signup',
    middleware.isLogout,
    body('email')
        .notEmpty().withMessage('이메일의 값은 필수입니다.')
        .isEmail().withMessage('이메일의 값을 형식에 맞게 입력해주세요.'),
    body('agree').exists().withMessage('동의의 값은 필수입니다.'),
    async (req, res) => {
    const result = validationResult(req);
    if(!result.isEmpty()) return renderSignup(res, {
        fieldErrors: result.array()
    });

    const emailDomain = req.body.email.split('@').pop();
    if(config.email_whitelist.length && !config.email_whitelist.includes(emailDomain))
        return renderSignup(res, {
            alert: '이메일 허용 목록에 있는 이메일이 아닙니다.'
        });

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
        return renderSignup(res, {
            alert: `현재 사용중인 아이피가 ACL그룹 ${aclGroup.name} #${aclGroupItem.id}에 있기 때문에 계정 생성 권한이 부족합니다.<br>만료일 : ${aclGroupItem.expiresAt?.toString() ?? '무기한'}<br>사유 : ${aclGroupItem.note ?? '없음'}`
        });
    }

    const email = req.body.email;

    const checkUserExists = await User.exists({
        email
    });
    if(!!checkUserExists) {
        if(config.use_email_verification) {
            res.renderSkin('계정 만들기', {
                contentName: 'signup_email_sent',
                email
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
        else renderSignup(res, {
            alert: '이미 가입된 이메일입니다.'
        });

        return;
    }

    const existingToken = await SignupToken.findOne({
        email
    });
    if(config.use_email_verification && existingToken && Date.now() - existingToken.createdAt < 1000 * 60 * 10) return renderSignup(res, {
        fieldErrors: [{
            path: 'email',
            msg: '해당 이메일로 이미 계정 생성 인증 메일을 보냈습니다.'
        }]
    });

    await SignupToken.deleteMany({
        email
    });

    const newToken = new SignupToken({
        email,
        ip: req.ip
    });
    await newToken.save();

    const signupUrl = `/member/signup/${newToken.token}`;
    if(config.use_email_verification) {
        res.renderSkin('계정 만들기', {
            contentName: 'signup_email_sent',
            email
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

const renderFinalSignup = (res, data = {}) => res.renderSkin('계정 만들기', {
    ...data,
    contentName: 'signup_final'
});

app.get('/member/signup/:token', async (req, res) => {
    const token = await SignupToken.findOne({
        token: req.params.token
    });
    if(!token || Date.now() - token.createdAt > 1000 * 60 * 60 * 24) return res.error('인증 요청이 만료되었거나 올바르지 않습니다.');

    if(token.ip !== req.ip) return res.error('보안 상의 이유로 요청한 아이피 주소와 현재 아이피 주소가 같아야 합니다.');

    renderFinalSignup(res, {
        email: token.email
    });
});

app.post('/member/signup/:token',
    body('username')
        .notEmpty()
        .withMessage('사용자 이름의 값은 필수입니다.')
        .isLength({ min: 3, max: 32 })
        .withMessage('사용자 이름의 길이는 3자 이상 32자 이하입니다.')
        .custom(value => /^[a-zA-Z0-9_]+$/.test(value))
        .withMessage('사용자 이름은 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.')
        .custom(value => value[0].match(/[a-zA-Z]/))
        .withMessage('사용자 이름은 영문으로 시작해야 합니다.')
        .custom(async value => {
            const existingUser = await User.exists({
                name: {
                    $regex: new RegExp(`^${value}$`, 'i')
                }
            });
            if(existingUser) throw new Error('사용자 이름이 이미 존재합니다.');
        }),
    body('password')
        .notEmpty()
        .withMessage('비밀번호의 값은 필수입니다.'),
    body('password_confirm')
        .notEmpty()
        .withMessage('비밀번호 확인의 값은 필수입니다.')
        .custom((value, { req }) => value === req.body.password)
        .withMessage('패스워드 확인이 올바르지 않습니다.'),
    async (req, res) => {
    const token = await SignupToken.findOne({
        token: req.params.token
    });
    if(!token
        || Date.now() - token.createdAt > 1000 * 60 * 60 * 24
        || token.ip !== req.ip) return res.status(400).send('유효하지 않은 토큰');

    const result = validationResult(req);
    if(!result.isEmpty()) return renderFinalSignup(res, {
        email: token.email,
        fieldErrors: result.array()
    });

    const hash = await bcrypt.hash(req.body.password, 12);
    const newUser = new User({
        email: token.email,
        password: hash,
        name: req.body.username
    });
    await newUser.save();

    await SignupToken.deleteMany({
        email: token.email
    });

    const dbDocument = new Document({
        namespace: '사용자',
        title: newUser.name
    });
    await dbDocument.save();

    await History.create({
        user: newUser.uuid,
        type: HistoryTypes.Create,
        document: dbDocument.uuid,
        content: ''
    });

    return req.login({
        ...newUser.toJSON(),
        avatar: utils.getGravatar(newUser.email)
    }, err => {
        if(err) console.error(err);
        if(!res.headersSent) {
            req.session.fullReload = true;
            return res.renderSkin('계정 만들기', {
                contentHtml: `<p>환영합니다! <b>${req.body.username}</b>님 계정 생성이 완료되었습니다.</p>`
            });
        }
    });
});

const renderLogin = (res, data = {}) => res.renderSkin('로그인', {
    ...data,
    contentName: 'login'
});

const renderPinVerification = (res, data = {}) => res.renderSkin('로그인', {
    ...data,
    contentName: 'pin_verification'
});

app.get('/member/login', middleware.isLogout, (req, res) => {
    renderLogin(res);
});

app.post('/member/login',
    middleware.isLogout,
    body('email')
        .notEmpty()
        .withMessage('이메일의 값은 필수입니다.'),
    body('password')
        .notEmpty()
        .withMessage('비밀번호의 값은 필수입니다.'),
    (req, res, next) => {
    const result = validationResult(req);
    if(!result.isEmpty()) return renderLogin(res, {
        fieldErrors: result.array()
    });

    passport.authenticate('local', async (err, user, info) => {
        if(err) {
            console.error(err);
            return res.status(500).send('서버 오류');
        }
        if(!user) return renderLogin(res, {
            alert: info.message
        });

        let checkTrusted = await LoginHistory.findOne({
            uuid: user.uuid,
            ip: req.ip,
            trusted: true
        });

        if(!user.totpToken && !config.use_email_verification) checkTrusted = true;

        if(checkTrusted) return req.login(user, err => {
            if(err) console.error(err);
            if(!res.headersSent) {
                req.session.fullReload = true;
                return res.redirect(req.body.redirect || '/');
            }
        });

        req.session.pinUser = user.uuid;
        req.session.redirect = req.body.redirect;
        renderPinVerification(res, {
            user
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
    body('pin')
        .notEmpty()
        .withMessage('pin의 값은 필수입니다.')
        .isLength(6)
        .withMessage('pin의 값은 6글자여야 합니다.'),
    async (req, res) => {
    const user = await User.findOne({
        uuid: req.session.pinUser,
        lastLoginRequest: {
            $gte: new Date(Date.now() - 1000 * 60 * 10)
        }
    });

    if(!user) {
        delete req.session.pinUser;
        return renderLogin(res);
    }

    const result = validationResult(req);
    if(!result.isEmpty()) return renderPinVerification(res, {
        user,
        alert: result.array()[0].msg
    });

    if(user.totpToken) {

    }
    else {
        if(req.body.pin !== user.emailPin) return renderPinVerification(res, {
            user,
            alert: 'PIN이 올바르지 않습니다.'
        });
    }

    req.login(user, err => {
        if(err) console.error(err);
        if(!res.headersSent) {
            req.session.fullReload = true;
            return res.redirect(req.session.redirect || '/');
        }
    });

    delete req.session.pinUser;
    delete req.session.redirect;

    await LoginHistory.create({
        uuid: user.uuid,
        ip: req.ip,
        trusted: !!req.body.trust
    });
});

app.get('/member/logout', middleware.isLogin, (req, res) => {
    req.logout(err => {
        if(err) console.error(err);
        req.session.fullReload = true;
        res.redirect('/');
    });
});

app.get('/member/mypage', middleware.isLogin, (req, res) => {
    res.renderSkin('내 정보', {
        contentName: 'mypage'
    });
});

app.post('/member/mypage', middleware.isLogin,
    body('skin')
        .isIn([
            'default',
            ...global.skins
        ])
        .withMessage('invalid_skin'),
    async (req, res) => {
    const result = validationResult(req);
    if(!result.isEmpty()) return res.status(400).send({
        fieldErrors: result.mapped()
    });

    await User.updateOne({
        uuid: req.user.uuid
    }, {
        skin: req.body.skin
    });

    if(req.user.skin !== req.body.skin) req.session.fullReload = true;

    res.redirect('/member/mypage');
});

const renderChangePassword = (res, data = {}) => res.renderSkin('비밀번호 변경', {
    ...data,
    contentName: 'change_password'
});

app.get('/member/change_password', middleware.isLogin, (req, res) => {
    renderChangePassword(res);
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
    async (req, res) => {
    const result = validationResult(req);
    if(!result.isEmpty()) return renderChangePassword(res, {
        fieldErrors: result.array()
    });

    const hash = await bcrypt.hash(req.body.password, 12);
    await User.updateOne({
        uuid: req.user.uuid
    }, {
        password: hash
    });

    return res.redirect('/member/mypage');
});

app.get('/contribution/:uuid/document',
    param('uuid')
        .isUUID(),
    async (req, res, next) => {
    if(!validationResult(req).isEmpty()) return next();

    const user = await User.findOne({
        uuid: req.params.uuid
    });
    if(!user) return res.error('계정을 찾을 수 없습니다.', 404);

    const baseQuery = {
        user: req.params.uuid
    }
    const query = { ...baseQuery };

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
        .lean();

    if(query._id?.$gte) revs.reverse();

    let prevItem;
    let nextItem;
    if(revs?.length) {
        prevItem = await History.findOne({
            ...query,
            _id: { $gt: revs[0]._id }
        }).sort({ _id: 1 });
        nextItem = await History.findOne({
            ...query,
            _id: { $lt: revs[revs.length - 1]._id }
        }).sort({ _id: -1 });

        revs = await utils.findDocuments(revs);
    }

    res.renderSkin(`"${user.name || user.ip}" 기여 목록`, {
        viewName: 'contribution',
        contentName: 'documentContribution',
        account: {
            uuid: user.uuid,
            name: user.name,
            type: user.type
        },
        serverData: {
            user,
            revs,
            prevItem,
            nextItem
        }
    });
});

module.exports = app;