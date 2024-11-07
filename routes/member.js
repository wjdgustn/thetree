const express = require('express');

const app = express.Router();

app.get('/member/login', (req, res) => {
    res.renderSkin('로그인', {
        contentName: 'login'
    });
});

app.get('/member/signup', (req, res) => {
    res.renderSkin('계정 만들기', {
        contentName: 'signup'
    });
});

module.exports = app;