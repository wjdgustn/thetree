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
        if(!req.permissions.includes(perm)) return res.error('권한이 부족합니다.');
        next();
    }
}