const utils = require('./');
const { UserTypes } = require('./types');

module.exports = {
    isLogin(req, res, next) {
        if(!req.isAuthenticated() || req.user.type !== UserTypes.Account)
            return res.redirect(`/member/login?redirect=${encodeURIComponent(req.get('Referrer') || req.originalUrl)}`);
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
            if(referer.pathname !== pathname) return error();
        } catch(e) {
            return error();
        }

        next();
    },
    parseDocumentName: (req, res, next) => {
        const name = req.params[0] || req.query.doc;
        if(!name) return res.error('문서 이름이 없습니다.', 404);
        req.document = utils.parseDocumentName(name);
        next();
    }
}