const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');

const User = require('../schemas/user');

module.exports = (passport) => {
    passport.use(new LocalStrategy({
        usernameField: 'email',
        passwordField: 'password'
    }, async (email, password, done) => {
        try {
            const exUser = await User.findOne({ email: email, provider: 'local' });
            if(exUser != null) {
                const result = await bcrypt.compare(password, exUser.password);
                if(result) {
                    done(null, exUser);
                }
                else {
                    done(null, false, { message: '이메일 혹은 패스워드가 틀립니다.' });
                }
            }
            else {
                done(null, false, { message: '이메일 혹은 패스워드가 틀립니다.' });
            }
        } catch(err) {
            console.error(err);
        }
    }));
}