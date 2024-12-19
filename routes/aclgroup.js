const express = require('express');
const { body, validationResult } = require('express-validator');
const { Address4, Address6 } = require('ip-address');

const utils = require('../utils');
const middleware = require('../utils/middleware');

const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');
const User = require("../schemas/user");

const app = express.Router();

app.get('/aclgroup', async (req, res) => {
    let aclGroupQuery = {};
    if(!req.permissions.includes('admin')) aclGroupQuery.hiddenFromPublic = false;

    const aclGroups = await ACLGroup.find(aclGroupQuery);
    const selectedGroup = req.query.group ? aclGroups.find(a => a.name === req.query.group) : aclGroups[0];

    const itemFilter = {
        aclGroup: selectedGroup.uuid
    };
    let groupItems = await ACLGroupItem.find(itemFilter)
        .sort({ id: -1 })
        .limit(50)
        .lean();

    let prevItem;
    let nextItem;
    if(groupItems.length) {
        prevItem = await ACLGroupItem.findOne({
            ...itemFilter,
            id: {$gt: groupItems[0].id}
        }).sort({ id: -1 });
        nextItem = await ACLGroupItem.findOne({
            ...itemFilter,
            id: { $lt: groupItems[groupItems.length - 1].id }
        }).sort({ id: -1 });

        groupItems = await utils.findUsers(groupItems);
    }

    res.renderSkin('ACLGroup', {
        contentName: 'aclgroup',
        serverData: {
            aclGroups,
            selectedGroup,
            groupItems,
            prevItem,
            nextItem
        }
    });
});

app.post('/aclgroup/group_add', middleware.permission('aclgroup'), async (req, res) => {
    const name = req.body.name;

    const checkExists = await ACLGroup.exists({ name });
    if(checkExists) return res.status(409).send('이미 존재하는 그룹 이름입니다.');

    await ACLGroup.create({
        name
    });

    res.redirect(`/aclgroup?group=${encodeURIComponent(name)}`);
});

app.post('/aclgroup/group_remove', middleware.permission('aclgroup'), async (req, res) => {
    const uuid = req.body.uuid;
    const deleted = await ACLGroup.findOneAndDelete({ uuid });
    if(!deleted) return res.status(404).send('존재하지 않는 그룹입니다.');

    res.redirect('/aclgroup');
});

app.post('/aclgroup',
    middleware.permission('admin'),
    body('group')
        .isUUID()
        .custom(async (value, { req }) => {
            const group = await ACLGroup.findOne({
                uuid: req.body.group
            });
            if(!group) throw new Error('존재하지 않는 그룹입니다.');
            req.body.group = group;
        }),
    body('mode')
        .isIn(['ip', 'username']),
    body('ip')
        .custom((value, { req }) => {
            if(req.body.mode !== 'ip') return true;
            if(!Address4.isValid(value) && !Address6.isValid(value)) throw new Error('invalid_cidr');
        }),
    body('username')
        .custom(async (value, { req }) => {
            if(req.body.mode !== 'username') return true;

            const user = await User.findOne({ name: value });
            if(!user) throw new Error('사용자 이름이 올바르지 않습니다.');

            req.body.user = user;
        }),
    body('note')
        .notEmpty()
        .withMessage('note의 값은 필수입니다.'),
    async (req, res) => {
    const result = validationResult(req);
    if(!result.isEmpty()) return renderSignup(res, {
        fieldErrors: result.array()
    });

    const group = req.body.group;

});

module.exports = app;