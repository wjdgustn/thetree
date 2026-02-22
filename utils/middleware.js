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
        if(!req.permissions.includes(perm)) return res.error(req.t('errors.missing_permission'), 403);
        next();
    },
    referer: pathname => (req, res, next) => {
        const error = () => res.error(req.t('errors.invalid_request'));

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
        const name = req.params.document?.join('/') || req.query.doc;
        if(!name) return res.error(req.t('errors.missing_document_name'), 404);
        if(name.length > 255) return res.error(req.t('errors.invalid_document_name'), 400);
        req.document = utils.parseDocumentName(name);
        next();
    },
    fieldErrors: (req, res, next) => {
        const result = validationResult(req);
        if(!result.isEmpty()) {
            if(req.isAPI) {
                const err = result.array()[0];
                const isDefaultMsg = err.msg === 'Invalid value';
                return res.status(400).send({
                    status: err.msg + (isDefaultMsg ? `: ${err.path}` : '')
                });
            }
            else if(req.isInternal) return res.status(400).send({
                fieldErrors: result.mapped()
            });
            else return res.error(result.array()[0].msg);
        }
        next();
    },
    singleFieldError: (req, res, next) => {
        const result = validationResult(req);
        if(!result.isEmpty()) {
            const msg = result.array()[0].msg;
            if(req.isAPI || !req.isInternal) return res.error(msg);
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