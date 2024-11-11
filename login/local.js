const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');

const utils = require('../utils');

const User = require('../schemas/user');

module.exports = passport => {
    passport.use(new LocalStrategy({
        usernameField: 'email',
        passwordField: 'password'
    }, async (email, password, done) => {
        try {
            const exUser = await User.findOneAndUpdate({
                $or: [
                    { email },
                    { name: email }
                ]
            }, {
                emailPin: utils.getRandomInt(0, 999999).toString().padStart(6, '0'),
                lastLoginRequest: new Date()
            }, {
                new: true
            });
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