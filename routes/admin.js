const express = require('express');
const util = require('util');
const fs = require('fs');
const mongoose = require('mongoose');
const { highlight } = require('highlight.js');

const utils = require('../utils');
const { GrantablePermissions, DevPermissions } = require('../utils/types');
const AllPermissions = [...GrantablePermissions, ...DevPermissions];
const middleware = require('../utils/middleware');

const User = require('../schemas/user');

const app = express.Router();

app.get('/admin/config', middleware.permission('developer'), (req, res) => {
    res.renderSkin('개발자 설정', {
        contentName: 'config'
    });
});

app.post('/admin/config/eval', middleware.permission('developer'), async (req, res) => {
    const Models = mongoose.models;

    let result;
    try {
        const evalResult = await eval(req.body.code);
        result = util.inspect(evalResult, { depth: 2, maxArrayLength: 200 });
    } catch(e) {
        res.status(400);
        result = e.stack;
    }

    result = highlight(result, { language: 'javascript' }).value.replaceAll('\n', '<br>');
    res.send(result);
});

app.get('/admin/config/tools/:tool', middleware.permission('developer'), async (req, res) => {
    const tool = req.params.tool;
    if(tool === 'getgrant') {
        await User.updateOne({
            uuid: req.user.uuid
        }, {
            $addToSet: {
                permissions: 'grant'
            }
        });
        return res.status(204).end();
    }
});

app.post('/admin/config/configjson', middleware.permission('developer'), (req, res) => {
    const config = req.body.config;
    if(config.includes('/') || !config.endsWith('.json')) return res.status(400).send('Invalid config file');
    fs.writeFileSync(config, req.body.content);
    updateConfig();
    return res.status(204).end();
});

app.post('/admin/config/stringconfig', middleware.permission('developer'), (req, res) => {
    let newObj = {};
    for(let key of Object.keys(stringConfig)) {
        newObj[key] = req.body[key] || '';
    }
    fs.writeFileSync('./stringConfig.json', JSON.stringify(newObj, null, 2));
    return res.status(204).end();
});

app.get('/admin/grant', middleware.permission('grant'), async (req, res) => {
    let targetUser;

    if(req.query.username) {
        targetUser = await User.findOne({
            name: req.query.username
        });
    }

    res.renderSkin('권한 부여', {
        contentName: 'grant',
        targetUser,
        grantablePermissions: [
            ...GrantablePermissions,
            ...(req.permissions.includes('developer') ? DevPermissions : [])
        ]
    });
});

app.post('/admin/grant', middleware.permission('grant'), async (req, res) => {
    const targetUser = await User.findOne({
        uuid: req.body.uuid
    });
    if(!targetUser) return res.status(404).send('User not found');

    const grantablePermissions = [
        ...GrantablePermissions,
        ...(req.permissions.includes('developer') ? DevPermissions : [])
    ]

    let newPerm = [];
    for(let perm of AllPermissions) {
        if(grantablePermissions.includes(perm)) {
            if(req.body[perm]) {
                newPerm.push(perm);
            }
        }
        else {
            if(targetUser.permissions.includes(perm)) {
                newPerm.push(perm);
            }
        }
    }

    await User.updateOne({
        uuid: req.body.uuid
    }, {
        permissions: newPerm
    });

    return res.redirect(req.get('referer'));
});

module.exports = app;