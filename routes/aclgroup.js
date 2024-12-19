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
    const selectedGroup = aclGroups.find(a => a.name === req.query.group) ?? aclGroups[0];

    let query;
    let groupItems;
    if(selectedGroup) {
        query = {
            aclGroup: selectedGroup.uuid
        };

        if(!isNaN(req.query.until)) query.id = { $gte: parseInt(req.query.until) };
        else if(!isNaN(req.query.from)) query.id = { $lte: parseInt(req.query.from) };

        groupItems = await ACLGroupItem.find(query)
            .sort({ id: query.id?.$gte ? 1 : -1 })
            .limit(50)
            .lean();

        if(query.rev?.$gte) revs.reverse();
    }

    let prevItem;
    let nextItem;
    if(groupItems?.length) {
        prevItem = await ACLGroupItem.findOne({
            ...query,
            id: {$gt: groupItems[0].id}
        }).sort({ id: 1 });
        nextItem = await ACLGroupItem.findOne({
            ...query,
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

    if(!name) return res.status(400).send('그룹 이름을 입력해주세요.');

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
    (req, res, next) => {
        req.modifiedBody = {};
        next();
    },
    body('group')
        .isUUID()
        .custom(async (value, { req }) => {
            const group = await ACLGroup.findOne({
                uuid: req.body.group
            });
            if(!group) throw new Error('존재하지 않는 그룹입니다.');
            req.modifiedBody.group = group;
        }),
    body('mode')
        .isIn(['ip', 'username']),
    body('ip')
        .custom((value, { req }) => {
            if(req.body.mode !== 'ip') return true;
            if(!Address4.isValid(value) && !Address6.isValid(value)) throw new Error('invalid_cidr');
            return true;
        }),
    body('username')
        .custom(async (value, { req }) => {
            if(req.body.mode !== 'username') return true;

            const user = await User.findOne({ name: value });
            if(!user) throw new Error('사용자 이름이 올바르지 않습니다.');

            req.modifiedBody.user = user;
        }),
    body('note')
        .notEmpty()
        .withMessage('note의 값은 필수입니다.'),
    body('duration')
        .custom((value, { req }) => {
            if(value === 'raw') {
                const rawDuration = req.body.rawDuration;
                const rawMultiplier = req.body.rawMultiplier;

                if(!rawDuration) throw new Error('duration의 값은 필수입니다.');

                const customValue = rawDuration * rawMultiplier;
                req.modifiedBody.duration = customValue;
                if(customValue < 0) throw new Error('duration의 값은 0 이상이여야 합니다.');
                return !isNaN(customValue);
            }
            else {
                req.modifiedBody.duration = Number(value);
                if(value < 0) throw new Error('duration의 값은 0 이상이여야 합니다.');
                return !isNaN(value);
            }
        }),
    body('hidelog')
        .custom((value, { req }) => {
            if(value === 'Y' && !req.permissions.includes('developer')) throw new Error('권한이 부족합니다.');
            return true;
        }),
    async (req, res) => {
    const result = validationResult(req);
    if(!result.isEmpty()) return res.status(400).send({
        fieldErrors: result.mapped()
    });

    const group = req.modifiedBody.group;

    const newItem = {
        aclGroup: group.uuid,
        note: req.body.note
    }

    const mode = req.body.mode;
    if(mode === 'ip') newItem.ip = req.body.ip;
    else if(mode === 'username') newItem.user = req.modifiedBody.user.uuid;

    const duration = req.modifiedBody.duration;
    if(duration > 0) newItem.expiresAt = new Date(Date.now() + duration * 1000);

    await ACLGroupItem.create(newItem);

    res.redirect(`/aclgroup?group=${encodeURIComponent(group.name)}`);
});

app.post('/aclgroup/remove', middleware.permission('admin'),
    (req, res, next) => {
        req.modifiedBody = {};
        next();
    },
    body('group')
        .isUUID()
        .custom(async (value, { req }) => {
            const group = await ACLGroup.findOne({
                uuid: req.body.group
            });
            if(!group) throw new Error('존재하지 않는 그룹입니다.');
            req.modifiedBody.group = group;
        }),
    body('note')
        .notEmpty()
        .withMessage('note의 값은 필수입니다.'),
    body('hidelog')
        .custom((value, { req }) => {
            if(value === 'Y' && !req.permissions.includes('developer')) throw new Error('권한이 부족합니다.');
            return true;
        }),
    async (req, res) => {
    const result = validationResult(req);
    if(!result.isEmpty()) return res.status(400).send({
        fieldErrors: result.mapped()
    });

    const group = req.modifiedBody.group;

    const deleted = await ACLGroupItem.findOneAndDelete({
        uuid: req.body.uuid
    });
    if(!deleted) return res.status(404).send('ACL 요소가 존재하지 않습니다.');

    res.redirect(`/aclgroup?group=${encodeURIComponent(group.name)}`);
});

module.exports = app;