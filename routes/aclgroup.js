const express = require('express');
const { body } = require('express-validator');
const { Address4, Address6 } = require('ip-address');

const utils = require('../utils');
const middleware = require('../utils/middleware');
const {
    BlockHistoryTypes,
    AuditLogTypes
} = require('../utils/types');

const User = require('../schemas/user');
const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');
const BlockHistory = require('../schemas/blockHistory');
const AuditLog = require('../schemas/auditLog');

const app = express.Router();

const aclGroupsQuery = req => ({
    ...(req.permissions.includes('config') ? {} : {
        $or: [
            {
                accessPerms: {
                    $size: 0
                }
            },
            {
                accessPerms: {
                    $in: req.permissions
                }
            }
        ]
    })
});

app.get('/aclgroup', async (req, res) => {
    const rawAclGroups = await ACLGroup.find(aclGroupsQuery(req));
    const aclGroups = [...new Set([
        ...(config.aclgroup_order ?? []).map(a => rawAclGroups.find(b => b.name === a)).filter(a => a),
        ...rawAclGroups
    ])];
    const selectedGroup = aclGroups.find(a => a.name === req.query.group) ?? aclGroups[0];

    let query;
    let groupItems;
    if(selectedGroup) {
        query = {
            aclGroup: selectedGroup.uuid
        };

        const until = parseInt(req.query.until);
        const from = parseInt(req.query.from);
        if(!isNaN(until)) query.id = { $gte: until };
        else if(!isNaN(from)) query.id = { $lte: from };

        groupItems = await ACLGroupItem.find(query)
            .sort({ id: query.id?.$gte ? 1 : -1 })
            .limit(50)
            .lean();

        if(query.id?.$gte) groupItems.reverse();
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

        groupItems = await utils.findUsers(req, groupItems);
    }

    res.renderSkin('ACLGroup', {
        contentName: 'admin/aclgroup',
        serverData: {
            aclGroups: aclGroups.map(a => ({
                ...utils.onlyKeys(a, [
                    'uuid',
                    'name'
                ]),
                deletable: a.deleteGroupPerms.length
                    ? a.deleteGroupPerms.some(b => req.permissions.includes(b))
                    : req.permissions.includes('aclgroup')
            })),
            selectedGroup: req.permissions.includes('config') ? utils.withoutKeys(selectedGroup, [
                '_id',
                '__v'
            ]) : utils.onlyKeys(selectedGroup, [
                'uuid',
                'name'
            ]),
            addable: selectedGroup?.addPerms.length
                ? selectedGroup.addPerms.some(a => req.permissions.includes(a))
                : req.permissions.includes('aclgroup'),
            removable: selectedGroup?.removePerms.length
                ? selectedGroup.removePerms.some(a => req.permissions.includes(a))
                : req.permissions.includes('aclgroup'),
            permissions: {
                aclgroup: req.permissions.includes('aclgroup'),
                hidelog: req.permissions.includes('aclgroup_hidelog'),
                config: req.permissions.includes('config')
            },
            groupItems: utils.onlyKeys(groupItems, [
                'id',
                'uuid',
                'user',
                'ip',
                'note',
                'createdAt',
                'expiresAt'
            ]),
            prevItem: prevItem?.id,
            nextItem: nextItem?.id
        }
    });
});

app.get('/aclgroup/groups', async (req, res) => {
    const aclGroups = await ACLGroup.find(aclGroupsQuery(req));
    res.json(aclGroups.map(a => ({
        uuid: a.uuid,
        name: a.name
    })));
});

app.post('/aclgroup/group_add', middleware.permission('aclgroup'), async (req, res) => {
    const name = req.body.name;

    if(!name) return res.status(400).send('그룹 이름을 입력해주세요.');

    const checkExists = await ACLGroup.exists({ name });
    if(checkExists) return res.status(409).send('이미 존재하는 그룹 이름입니다.');

    const newGroup = {
        name
    };

    if(name === '차단된 사용자') {
        newGroup.forBlock = true;
        newGroup.noSignup = true;
        newGroup.userCSS = 'color: gray !important; text-decoration: line-through !important;';
        newGroup.accessPerms = ['admin'];
        newGroup.addPerms = ['admin'];
        newGroup.removePerms = ['admin'];
        newGroup.deleteGroupPerms = ['developer'];
    }
    else if(name === '로그인 허용 차단' || name.includes('통신사') || name.toLowerCase().includes('vpn')) {
        newGroup.noSignup = true;
        newGroup.userCSS = 'color: green !important; text-decoration: line-through !important;';
        newGroup.addPerms = ['admin'];
        newGroup.removePerms = ['admin'];
    }
    else if(name.startsWith('경고')) {
        newGroup.isWarn = true;
        newGroup.addPerms = ['admin'];
        newGroup.removePerms = ['admin'];
    }

    await ACLGroup.create(newGroup);
    await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.ACLGroupCreate,
        target: name
    });

    if(req.backendMode) res.reload();
    else res.redirect(`/aclgroup?group=${encodeURIComponent(name)}`);
});

app.post('/aclgroup/group_remove', async (req, res) => {
    const uuid = req.body.uuid;
    const target = await ACLGroup.findOne({ ...aclGroupsQuery(req), uuid });

    if(!target) return res.status(404).send('존재하지 않는 그룹입니다.');
    if(target.deleteGroupPerms.length
        ? !target.deleteGroupPerms.some(a => req.permissions.includes(a))
        : !req.permissions.includes('aclgroup')) return res.status(403).send('권한이 부족합니다.');

    const deleted = await ACLGroup.findOneAndDelete({ uuid });
    await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.ACLGroupDelete,
        target: deleted.name
    });

    if(req.backendMode) res.reload();
    else res.redirect('/aclgroup');
});

app.post('/aclgroup',
    (req, res, next) => {
        req.modifiedBody = {};
        next();
    },
    body('group')
        .isUUID()
        .custom(async (value, { req }) => {
            const group = await ACLGroup.findOne({
                ...aclGroupsQuery(req),
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

            const user = await User.findOne({
                name: {
                    $regex: new RegExp(`^${utils.escapeRegExp(value)}$`, 'i')
                }
            });
            if(!user || !value) throw new Error('사용자 이름이 올바르지 않습니다.');

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
            if(value === 'Y' && !req.permissions.includes('aclgroup_hidelog')) throw new Error('권한이 부족합니다.');
            return true;
        }),
    middleware.fieldErrors,
    async (req, res) => {
    const group = req.modifiedBody.group;

    if(group.addPerms.length
        ? !group.addPerms.some(a => req.permissions.includes(a))
        : !req.permissions.includes('aclgroup')) return res.status(403).send('권한이 부족합니다.');

    const newItem = {
        aclGroup: group.uuid,
        note: req.body.note
    }

    const mode = req.body.mode;
    if(mode === 'ip') newItem.ip = req.body.ip;
    else if(mode === 'username') newItem.user = req.modifiedBody.user.uuid;

    const duration = req.modifiedBody.duration;
    if(duration > 0) newItem.expiresAt = new Date(Date.now() + duration * 1000);

    let aclGroupItem;
    try {
        aclGroupItem = await ACLGroupItem.create(newItem);
    } catch (e) {
        if(e.code === 11000) return res.status(409).send('이미 해당 요소가 존재합니다.');
        throw e;
    }

    await BlockHistory.create({
        type: BlockHistoryTypes.ACLGroupAdd,
        createdUser: req.user.uuid,
        ...(mode === 'ip' ? {
            targetContent: req.body.ip
        } : {
            targetUser: req.modifiedBody.user.uuid,
            targetUsername: req.modifiedBody.user.name
        }),
        aclGroup: group.uuid,
        aclGroupName: group.name,
        aclGroupId: aclGroupItem.id,
        ...(duration > 0 ? {
            duration: duration * 1000
        } : {}),
        content: req.body.note,
        hideLog: req.body.hidelog === 'Y'
    });

    if(req.referer?.pathname.startsWith('/aclgroup')) {
        if(req.backendMode) res.reload();
        else res.redirect(`/aclgroup?group=${encodeURIComponent(group.name)}`);
    }
    else res.status(204).end();
});

app.post('/aclgroup/remove',
    (req, res, next) => {
        req.modifiedBody = {};
        next();
    },
    body('group')
        .isUUID()
        .custom(async (value, { req }) => {
            const group = await ACLGroup.findOne({
                ...aclGroupsQuery(req),
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
            if(value === 'Y' && !req.permissions.includes('aclgroup_hidelog')) throw new Error('권한이 부족합니다.');
            return true;
        }),
    middleware.fieldErrors,
    async (req, res) => {
    const group = req.modifiedBody.group;

    if(group.removePerms.length
        ? !group.removePerms.some(a => req.permissions.includes(a))
        : !req.permissions.includes('aclgroup')) return res.status(403).send('권한이 부족합니다.');

    const deleted = await ACLGroupItem.findOneAndDelete({
        uuid: req.body.uuid
    });
    if(!deleted) return res.status(404).send('ACL 요소가 존재하지 않습니다.');

    let targetUser;
    if(deleted.user) targetUser = await User.findOne({
        uuid: deleted.user
    });

    await BlockHistory.create({
        type: BlockHistoryTypes.ACLGroupRemove,
        createdUser: req.user.uuid,
        ...(deleted.user == null ? {
            targetContent: deleted.ip
        } : {
            targetUser: targetUser?.uuid || deleted.user,
            targetUsername: targetUser?.name
        }),
        aclGroup: deleted.aclGroup,
        aclGroupName: group.name,
        aclGroupId: deleted.id,
        content: req.body.note,
        hideLog: req.body.hidelog === 'Y'
    });

    if(req.backendMode) res.reload();
    else res.redirect(`/aclgroup?group=${encodeURIComponent(group.name)}`);
});

app.post('/aclgroup/group_edit', middleware.permission('config'),
    body('name')
        .notEmpty()
        .withMessage('그룹 이름은 필수입니다.'),
    middleware.fieldErrors,
    async (req, res) => {
    const updated = await ACLGroup.findOneAndUpdate({
        uuid: req.body.uuid
    }, {
        name: req.body.name,
        userCSS: req.body.userCSS,
        aclMessage: req.body.aclMessage,
        forBlock: req.body.forBlock === 'Y',
        isWarn: req.body.isWarn === 'Y',
        noSignup: req.body.noSignup === 'Y',
        accessPerms: req.body.accessPerms.split(',').map(a => a.trim()).filter(a => a),
        addPerms: req.body.addPerms.split(',').map(a => a.trim()).filter(a => a),
        removePerms: req.body.removePerms.split(',').map(a => a.trim()).filter(a => a),
        deleteGroupPerms: req.body.deleteGroupPerms.split(',').map(a => a.trim()).filter(a => a)
    });
    if(!updated) return res.status(404).send('존재하지 않는 그룹입니다.');

    res.redirect(`/aclgroup?group=${encodeURIComponent(req.body.name)}`);
});

app.get('/self_unblock', async (req, res) => {
    const item = await ACLGroupItem.findOne({
        id: req.query.id
    });
    if(!item || !req.query.id || (item.user !== req.user.uuid && item.ip !== req.ip)) return res.error('aclgroup_not_found');

    const group = await ACLGroup.findOne({
        uuid: item.aclGroup
    });
    if(!group.isWarn) return res.error('해제할 수 없는 요소입니다.');

    await ACLGroupItem.deleteOne({
        uuid: item.uuid
    });

    await BlockHistory.create({
        type: BlockHistoryTypes.ACLGroupRemove,
        createdUser: req.user.uuid,
        ...(item.user == null ? {
            targetContent: item.ip
        } : {
            targetUser: req.user.uuid,
            targetUsername: req.user.name
        }),
        aclGroup: item.aclGroup,
        aclGroupName: group.name,
        aclGroupId: item.id,
        content: '확인했습니다.'
    });

    res.reload(null, true);
});

module.exports = app;