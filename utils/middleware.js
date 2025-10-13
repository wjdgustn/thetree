const utils = require('./');
const { UserTypes } = require('./types');
const { validationResult } = require('express-validator');

module.exports = {
    isLogin(req, res, next) {
        if(req.user?.type !== UserTypes.Account)
            return res.redirect(`/member/login?redirect=${encodeURIComponent(req.url)}`);
        next();
    },
    isLogout(req, res, next) {
        if(req.user?.type === UserTypes.Account)
            return res.redirect('/');
        next();
    },
    permission: perm => (req, res, next) => {
        if(!req.permissions.includes(perm)) return res.error('권한이 부족합니다.', 403);
        next();
    },
    referer: pathname => (req, res, next) => {
        const error = () => res.error('잘못된 요청입니다.');

        try {
            const referer = new URL(req.get('Referer'));
            if(!referer.pathname.startsWith(pathname)) return error();
        } catch(e) {
            return error();
        }

        next();
    },
    internal: (req, res, next) => {
        if(!req.isInternal) return res.status(400).end();
        next();
    },
    parseDocumentName: (req, res, next) => {
        const routeUrl = req.route.path.split('/').slice(0, 2).join('/') + '/';
        if(!req.url.startsWith(routeUrl)) return next('route');

        const name = req.params.document[0] || req.query.doc;
        if(!name) return res.error('문서 이름이 없습니다.', 404);
        if(name.length > 255) return res.error('문서 이름이 올바르지 않습니다.', 400);
        req.document = utils.parseDocumentName(name);
        next();
    },
    fieldErrors: (req, res, next) => {
        const result = validationResult(req);
        if(!result.isEmpty()) return res.status(400).send({
            fieldErrors: result.mapped()
        });
        next();
    },
    singleFieldError: (req, res, next) => {
        const result = validationResult(req);
        if(!result.isEmpty()) {
            const msg = result.array()[0].msg;
            if(req.isAPI) return res.error(msg);
            else return res.status(400).send(msg);
        }
        next();
    },
    captcha: (force = false, ipForce = false) => async (req, res, next) => {
        if(!await utils.middleValidateCaptcha(req, res, force, ipForce)) return;
        next();
    },
    checkCaptcha: (force = false, ipForce = false) => async (req, res, next) => {
        req.additionalServerData.captchaData = {
            use: await utils.checkCaptchaRequired(req, force, ipForce),
            force: force || (req.user?.type !== UserTypes.Account && ipForce)
        }
        next();
    }
}