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
    }
}