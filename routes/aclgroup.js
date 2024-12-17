const express = require('express');
const { Address4, Address6 } = require('ip-address');

const middleware = require('../utils/middleware');

const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');

const app = express.Router();

app.get('/aclgroup', async (req, res) => {
    let aclGroupQuery = {};
    if(!req.permissions.includes('admin')) aclGroupQuery.hiddenFromPublic = false;

    const aclGroups = await ACLGroup.find(aclGroupQuery);

    res.renderSkin('ACLGroup', {
        contentName: 'aclgroup',
        serverData: {
            aclGroups
        }
    });
});

module.exports = app;