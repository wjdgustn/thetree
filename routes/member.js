const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');

const User = require('../schemas/user');
const SignupToken = require('../schemas/signupToken');

const app = express.Router();

app.get('/member/login', (req, res) => {
    res.renderSkin('로그인', {
        contentName: 'login'
    });
});

const renderSignup = (res, data = {}) => res.renderSkin('계정 만들기', {
    ...data,
    contentName: 'signup'
});

app.get('/member/signup', (req, res) => {
    renderSignup(res);
});

app.post('/member/signup',
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

    const email = req.body.email;

    const existingToken = await SignupToken.findOne({
        email
    });
    if(existingToken && Date.now() - existingToken.createdAt < 1000 * 60 * 10) return renderSignup(res, {
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
<a href="${new URL(`/member/signup/${newToken.token}`, config.base_url)}">[인증]</a>
이 메일은 24시간동안 유효합니다.
요청 아이피 : ${req.ip}
        `.trim().replaceAll('\n', '<br>')
    });
});

const renderFinalSignup = (res, data = {}) => res.renderSkin('계정 만들기', {
    ...data,
    contentName: 'signup_final'
});

app.get('/member/signup/:token', async (req, res) => {
    const token = await SignupToken.findOne({
        token: req.params.token
    });
    if(!token || Date.now() - token.createdAt > 1000 * 60 * 60 * 24) return res.renderSkin('오류', {
        contentHtml: '인증 요청이 만료되었거나 올바르지 않습니다.'
    });

    if(token.ip !== req.ip) return res.renderSkin('오류', {
        contentHtml: '보안 상의 이유로 요청한 아이피 주소와 현재 아이피 주소가 같아야 합니다.'
    });

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
        .withMessage('사용자 이름은 영문으로 시작해야 합니다.'),
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

    req.login(newUser);

    res.renderSkin('계정 만들기', {
        contentHtml: `<p>환영합니다! <b>${req.body.username}</b>님 계정 생성이 완료되었습니다.</p>`
    });
});

module.exports = app;