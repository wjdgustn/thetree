const express = require('express');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const passport = require('passport');
const { Address4, Address6 } = require('ip-address');

const utils = require('../utils');
const middleware = require('../utils/middleware');
const {
    HistoryTypes,
    UserTypes
} = require('../utils/types');

const User = require('../schemas/user');
const SignupToken = require('../schemas/signupToken');
const AutoLoginToken = require('../schemas/autoLoginToken');
const LoginHistory = require('../schemas/loginHistory');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');
const ThreadComment = require('../schemas/threadComment');
const EditRequest = require('../schemas/editRequest');
const Blacklist = require('../schemas/blacklist');

const app = express.Router();

app.get('/member/signup', middleware.isLogout, (req, res) => {
    res.renderSkin('계정 만들기', {
        contentName: 'member/signup'
    });
});

app.post('/member/signup',
    middleware.isLogout,
    body('email')
        .notEmpty().withMessage('이메일의 값은 필수입니다.')
        .isEmail().withMessage('이메일의 값을 형식에 맞게 입력해주세요.'),
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

    if(token.ip !== req.ip) return res.error('보안 상의 이유로 요청한 아이피 주소와 현재 아이피 주소가 같아야 합니다.');

    res.renderSkin('계정 만들기', {
        contentName: 'member/signup_final',
        serverData: {
            email: token.email
        }
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
    middleware.fieldErrors,
    middleware.captcha,
    async (req, res) => {
    const token = await SignupToken.findOne({
        token: req.params.token
    });
    if(!token
        || Date.now() - token.createdAt > 1000 * 60 * 60 * 24
        || token.ip !== req.ip) return res.status(400).send('유효하지 않은 토큰');

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

app.get('/member/login', middleware.isLogout, (req, res) => {
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

        let checkTrusted = await LoginHistory.findOne({
            uuid: user.uuid,
            ip: req.ip,
            trusted: true
        });

        const createLoginHistory = async () => await LoginHistory.create({
            uuid: user.uuid,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        if(!user.totpToken && !config.use_email_verification) {
            await createLoginHistory();
            checkTrusted = true;
        }

        if(checkTrusted) {
            if(req.body.autologin === 'Y') {
                const token = await AutoLoginToken.create({
                    uuid: user.uuid
                });
                res.cookie('honoka', token.token, {
                    httpOnly: true,
                    maxAge: 1000 * 60 * 60 * 24 * 365
                });
            }

            await createLoginHistory();

            return req.login(user, err => {
                if(err) console.error(err);
                if(!res.headersSent) {
                    req.session.fullReload = true;
                    return res.redirect(req.body.redirect || '/');
                }
            });
        }

        req.session.pinUser = user.uuid;
        req.session.redirect = req.body.redirect;
        res.renderSkin('로그인', {
            contentName: 'member/pin_verification',
            serverData: {
                user,
                autologin: req.body.autologin
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
    body('pin')
        .notEmpty()
        .withMessage('pin의 값은 필수입니다.')
        .isLength(6)
        .withMessage('pin의 값은 6글자여야 합니다.'),
    middleware.fieldErrors,
    middleware.captcha,
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

    if(user.totpToken) {

    }
    else {
        if(req.body.pin !== user.emailPin) return res.status(400).send('PIN이 올바르지 않습니다.');
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
        userAgent: req.get('User-Agent'),
        trusted: !!req.body.trust
    });
});

app.get('/member/logout', middleware.isLogin, async (req, res) => {
    await AutoLoginToken.deleteOne({
        uuid: req.user.uuid,
        token: req.cookies.honoka
    });
    req.logout(err => {
        if(err) console.error(err);
        req.session.fullReload = true;
        delete req.session.contributor;
        res.clearCookie('honoka');
        res.redirect('/');
    });
});

app.get('/member/mypage', middleware.isLogin, (req, res) => {
    res.renderSkin('내 정보', {
        contentName: 'member/mypage'
    });
});

app.post('/member/mypage', middleware.isLogin,
    body('skin')
        .isIn([
            'default',
            ...global.skins
        ])
        .withMessage('invalid_skin'),
    middleware.fieldErrors,
    async (req, res) => {
    await User.updateOne({
        uuid: req.user.uuid
    }, {
        skin: req.body.skin
    });

    if(req.user.skin !== req.body.skin) req.session.fullReload = true;

    res.redirect('/member/mypage');
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

app.get('/contribution/:uuid/document',
    param('uuid')
        .isUUID(),
    async (req, res, next) => {
    if(!validationResult(req).isEmpty()) return next();

    const user = await User.findOne({
        uuid: req.params.uuid
    });
    // if(!user) return res.error('계정을 찾을 수 없습니다.', 404);

    const baseQuery = {
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

    res.renderSkin(`${user ? `"${user.name || user.ip}"` : '<삭제된 사용자>'} 기여 목록`, {
        viewName: 'contribution',
        contentName: 'userContribution/document',
        account: {
            uuid: req.params.uuid,
            name: user?.name,
            type: user?.type ?? UserTypes.Deleted
        },
        serverData: {
            user,
            revs,
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

    let comments = await ThreadComment.find({
        user: req.params.uuid,
        createdAt: {
            $gte: Date.now() - 1000 * 60 * 60 * 24 * 30
        }
    })
        .sort({
            createdAt: -1
        })
        .lean();

    comments = await utils.findThreads(comments);

    res.renderSkin(`${user ? `"${user.name || user.ip}"` : '<삭제된 사용자>'} 기여 목록`, {
        viewName: 'contribution_discuss',
        contentName: 'userContribution/discuss',
        account: {
            uuid: req.params.uuid,
            name: user?.name,
            type: user?.type ?? UserTypes.Deleted
        },
        serverData: {
            // user,
            comments,
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
        .lean();

    if(query._id?.$gte) items.reverse();

    let prevItem;
    let nextItem;
    if(items?.length) {
        prevItem = await EditRequest.findOne({
            ...query,
            _id: { $gt: items[0]._id }
        }).sort({ _id: 1 });
        nextItem = await EditRequest.findOne({
            ...query,
            _id: { $lt: items[items.length - 1]._id }
        }).sort({ _id: -1 });

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

const checkDeletable = async user => {
    let noActivityTime = 1000 * 60 * 60 * 24;
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
    if(config.withdraw_save_days == null)
        return res.error('계정 삭제가 비활성화돼 있습니다.', 403);

    const { deletable, blacklistDuration } = await checkDeletable(req.user);
    console.log(await checkDeletable(req.user));

    res.renderSkin('회원 탈퇴', {
        contentName: 'member/withdraw',
        serverData: {
            blacklistDays: blacklistDuration && Math.round(blacklistDuration / 1000 / 60 / 60 / 24),
            alert: deletable ? null : '마지막 활동으로 부터 시간이 경과해야 계정 삭제가 가능합니다.'
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
    if(config.withdraw_save_days == null)
        return res.error('계정 삭제가 비활성화돼 있습니다.', 403);

    const { deletable, blacklistDuration } = await checkDeletable(req.user);
    if(!deletable) return res.status(403).send('마지막 활동으로 부터 시간이 경과해야 계정 삭제가 가능합니다.');

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

    const dbDocument = await Document.findOneAndUpdate({
        namespace: '사용자',
        title: req.user.name
    }, {
        title: `*${req.user.uuid}`
    }, {
        new: true
    });
    await History.create({
        user: req.user.uuid,
        type: HistoryTypes.Move,
        document: dbDocument.uuid,
        moveOldDoc: `사용자:${req.user.name}`,
        moveNewDoc: `사용자:*${req.user.uuid}`
    });
    await History.create({
        user: req.user.uuid,
        type: HistoryTypes.Delete,
        document: dbDocument.uuid,
        content: null
    });

    req.logout(err => {
        if(err) console.error(err);
        req.session.fullReload = true;
        delete req.session.contributor;
        res.clearCookie('honoka');
        res.redirect('/member/login');
    });
});

module.exports = app;