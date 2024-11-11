module.exports = {
    isLogin(req, res, next) {
        if(!req.isAuthenticated())
            return res.redirect(`/member/login?redirect=${encodeURIComponent(req.get('Referrer') || req.originalUrl)}`);
        next();
    },
    isLogout(req, res, next) {
        if(req.isAuthenticated())
            return res.redirect('/');
        next();
    }
}