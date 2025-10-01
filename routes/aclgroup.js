const express = require('express');
const { body } = require('express-validator');
const { Address4, Address6 } = require('ip-address');

const utils = require('../utils');
const namumarkUtils = require('../utils/newNamumark/utils');
const middleware = require('../utils/middleware');
const {
    BlockHistoryTypes,
    AuditLogTypes,
    SignupPolicy,
    AllPermissions,
    ProtectedPermissions
} = require('../utils/types');

const User = require('../schemas/user');
const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');
const BlockHistory = require('../schemas/blockHistory');
const AuditLog = require('../schemas/auditLog');

const app = express.Router();

const aclGroupsQuery = req => ({
    ...(req.permissions.includes('developer') ? {} : {
        $or: [
            ...(req.permissions.includes('aclgroup') ? [{
                accessPerms: {
                    $size: 0
                }
            }] : []),
            {
                accessPerms: {
                    $in: req.permissions
                }
            },
            {
                managePerms: {
                    $in: req.permissions
                }
            }
        ]
    })
});

const groupPermChecker = (req, group, key) => {
    if(!group) return false;

    if(req.permissions.includes('developer')) return true;
    if(key !== 'managePerms' && groupPermChecker(req, group, 'managePerms'))
        return true;
    if(key !== 'accessPerms' && key !== 'managePerms' && !groupPermChecker(req, group, 'accessPerms'))
        return false;

    const perms = group[key] ?? [];
    return perms.length
        ? perms.some(a => req.permissions.includes(a))
        : req.permissions.includes('aclgroup');
}

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
                managable: groupPermChecker(req, a, 'managePerms')
            })),
            selectedGroup: utils.onlyKeys(selectedGroup, [
                'uuid',
                'name'
            ]),
            addable: groupPermChecker(req, selectedGroup, 'addPerms'),
            removable: groupPermChecker(req, selectedGroup, 'removePerms'),
            permissions: {
                aclgroup: req.permissions.includes('aclgroup'),
                hidelog: req.permissions.includes('aclgroup_hidelog')
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
        newGroup.signupPolicy = SignupPolicy.Block;
        newGroup.userCSS = 'color: gray !important; text-decoration: line-through !important;';
        newGroup.accessPerms = ['admin'];
        newGroup.addPerms = ['admin'];
        newGroup.removePerms = ['admin'];
        newGroup.managePerms = ['developer'];
    }
    else if(name === '편집요청 차단') {
        newGroup.accessPerms = ['admin'];
        newGroup.addPerms = ['admin'];
        newGroup.removePerms = ['admin'];
    }
    else if(name === '로그인 허용 차단' || name.includes('통신사') || name.toLowerCase().includes('vpn')) {
        newGroup.signupPolicy = SignupPolicy.Block;
        newGroup.userCSS = 'color: green !important; text-decoration: line-through !important;';
        newGroup.accessPerms = ['admin'];
        newGroup.addPerms = ['admin'];
        newGroup.removePerms = ['admin'];
    }
    else if(name.startsWith('경고')) {
        newGroup.selfRemovable = true;
        newGroup.accessPerms = ['any'];
        newGroup.addPerms = ['admin'];
        newGroup.removePerms = ['admin'];
        newGroup.selfRemoveNote = '확인했습니다.';
        newGroup.aclMessage = `
경고를 받았습니다.

<a href="/aclgroup/self_remove?id={id}">[확인했습니다. #{id}]</a>
사유: {note}
        `.trim().replaceAll('\n', '<br>');
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
    if(!groupPermChecker(req, target, 'managePerms')) return res.status(403).send('권한이 부족합니다.');

    const deleted = await ACLGroup.findOneAndDelete({ uuid });
    await AuditLog.create({
        user: req.user.uuid,
        action: AuditLogTypes.ACLGroupDelete,
        target: deleted.name
    });

    res.redirect('/aclgroup');
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
            const ipv4 = Address4.isValid(value);
            const ipv6 = Address6.isValid(value);
            if(!ipv4 && !ipv6) throw new Error('invalid_cidr');

            if(ipv4 && req.modifiedBody.group.maxIpv4Cidr) {
                const addr = new Address4(value);
                if(addr.subnetMask < req.modifiedBody.group.maxIpv4Cidr)
                    throw new Error(`max_ipv4_cidr은 /${req.modifiedBody.group.maxIpv4Cidr}입니다.`);
            }
            if(ipv6 && req.modifiedBody.group.maxIpv6Cidr) {
                const addr = new Address6(value);
                if(addr.subnetMask < req.modifiedBody.group.maxIpv6Cidr)
                    throw new Error(`max_ipv6_cidr은 /${req.modifiedBody.group.maxIpv6Cidr}입니다.`);
            }

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
            let result;
            if(value === 'raw') {
                const rawDuration = req.body.rawDuration;
                const rawMultiplier = req.body.rawMultiplier;

                if(!rawDuration) throw new Error('duration의 값은 필수입니다.');

                const customValue = rawDuration * rawMultiplier;
                req.modifiedBody.duration = customValue;
                if(customValue < 0) throw new Error('duration의 값은 0 이상이여야 합니다.');
                result = !isNaN(customValue);
            }
            else {
                req.modifiedBody.duration = Number(value);
                if(value < 0) throw new Error('duration의 값은 0 이상이여야 합니다.');
                result = !isNaN(value);
            }

            if(req.body.mode === 'username'
                && req.modifiedBody.group.maxDurationAccount
                && (!req.modifiedBody.duration || req.modifiedBody.duration > req.modifiedBody.group.maxDurationAccount))
                throw new Error(`max_duration_account는 ${req.modifiedBody.group.maxDurationAccount}입니다.`);
            if(req.body.mode === 'ip'
                && req.modifiedBody.group.maxDurationIp
                && (!req.modifiedBody.duration || req.modifiedBody.duration > req.modifiedBody.group.maxDurationIp))
                throw new Error(`max_duration_ip는 ${req.modifiedBody.group.maxDurationIp}입니다.`);
            if(req.modifiedBody.group.maxDuration
                && (!req.modifiedBody.duration || req.modifiedBody.duration > req.modifiedBody.group.maxDuration))
                throw new Error(`max_duration은 ${req.modifiedBody.group.maxDuration}입니다.`);

            return result;
        }),
    body('hidelog')
        .custom((value, { req }) => {
            if(value === 'Y' && !req.permissions.includes('aclgroup_hidelog')) throw new Error('권한이 부족합니다.');
            return true;
        }),
    middleware.fieldErrors,
    async (req, res) => {
    const group = req.modifiedBody.group;

    if(!groupPermChecker(req, group, 'addPerms')) return res.status(403).send('권한이 부족합니다.');

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

    if(!groupPermChecker(req, group, 'removePerms')) return res.status(403).send('권한이 부족합니다.');

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

app.get('/aclgroup/group_manage', async (req, res) => {
    const group = await ACLGroup.findOne({
        name: req.query.name
    });
    if(!group
        || !groupPermChecker(req, group, 'managePerms'))
        return res.error('존재하지 않는 그룹입니다.', 404);

    return res.renderSkin('ACLGroup 설정', {
        contentName: 'admin/aclgroupManage',
        serverData: {
            group: Object.fromEntries(Object.entries(utils.withoutKeys(group, [
                '_id',
                '__v'
            ])).map(([k, v]) => {
                if(Array.isArray(v)) v = v.join(',');
                else if(typeof v !== 'boolean') v = v.toString();
                return [k, v];
            }))
        }
    });
});

const permValidator = field => body(field)
    .customSanitizer(value => [...new Set(value.split(',').map(a => a.trim()).filter(a => a))])
    .custom((value, { req }) => {
        const invalid = value.find(a => !['any', ...AllPermissions].includes(a));
        if(invalid)
            throw new Error(`${namumarkUtils.escapeHtml(invalid)} 권한은 유효하지 않습니다.`);
        if(field === 'managePerms'
            && (
                (value.length && !req.permissions.some(a => value.includes(a)))
                || (!value.length && !req.permissions.includes('aclgroup'))
            ))
            throw new Error('본인이 가진 권한이 포함되지 않았습니다.');
        if(field === 'permissions') {
            const groupPermissions = req.body.group.permissions;
            const modifiedPermissions = [
                ...groupPermissions.filter(a => !value.includes(a)),
                ...value.filter(a => !groupPermissions.includes(a))
            ];
            if(modifiedPermissions.length && !req.permissions.includes('grant'))
                throw new Error('이 값을 수정하려면 grant 권한이 필요합니다.');

            const addablePermissions = [...req.permissions];
            if(req.permissions.includes('config'))
                addablePermissions.push(
                    ...AllPermissions
                        .filter(a => req.permissions.includes('developer') || !ProtectedPermissions.includes(a))
                );

            const noGrantablePermission = modifiedPermissions.find(a => !addablePermissions.includes(a));
            if(noGrantablePermission)
                throw new Error(`${namumarkUtils.escapeHtml(noGrantablePermission)} 권한을 수정할 권한이 없습니다.`);
        }
        return true;
    });

app.post('/aclgroup/group_manage',
    body('uuid')
        .custom(async (value, { req }) => {
            const group = await ACLGroup.findOne({
                uuid: value
            });
            if(!group
                || !groupPermChecker(req, group, 'managePerms'))
                throw new Error('존재하지 않는 그룹입니다.');

            req.body.group = group;
        }),
    body('name')
        .notEmpty()
        .withMessage('그룹 이름은 필수입니다.'),
    body('withdrawPeriodHours')
        .isInt({ min: 0 }),
    body('signupPolicy')
        .isInt({
            min: Math.min(...Object.values(SignupPolicy)),
            max: Math.max(...Object.values(SignupPolicy))
        }),
    body('maxDuration')
        .isInt({ min: 0 }),
    body('maxDurationIp')
        .isInt({ min: 0 }),
    body('maxDurationAccount')
        .isInt({ min: 0 }),
    body('maxIpv4Cidr')
        .isInt({ min: 0, max: 32 }),
    body('maxIpv6Cidr')
        .isInt({ min: 0, max: 128 }),
    permValidator('accessPerms'),
    permValidator('addPerms'),
    permValidator('removePerms'),
    permValidator('managePerms'),
    body('userCSS')
        .customSanitizer((value, { req }) => {
            if(req.body.group.userCSS !== value
                && !req.permissions.includes('config'))
                namumarkUtils.cssFilter(value);
        }),
    body('aclMessage')
        .customSanitizer(value => namumarkUtils.baseSanitizeHtml(value)),
    permValidator('permissions'),
    body('captchaRate')
        .isInt({ min: 0 }),
    middleware.fieldErrors,
    async (req, res) => {
    const group = req.body.group;

    await ACLGroup.findOneAndUpdate({
        uuid: group.uuid
    }, {
        name: req.body.name,
        withdrawPeriodHours: req.body.withdrawPeriodHours,
        signupPolicy: req.body.signupPolicy,
        maxDuration: req.body.maxDuration,
        maxDurationIp: req.body.maxDurationIp,
        maxDurationAccount: req.body.maxDurationAccount,
        maxIpv4Cidr: req.body.maxIpv4Cidr,
        maxIpv6Cidr: req.body.maxIpv6Cidr,
        accessPerms: req.body.accessPerms,
        addPerms: req.body.addPerms,
        removePerms: req.body.removePerms,
        managePerms: req.body.managePerms,
        userCSS: req.body.userCSS,
        aclMessage: req.body.aclMessage,
        selfRemoveNote: req.body.selfRemoveNote,
        forBlock: req.body.forBlock === 'Y',
        selfRemovable: req.body.selfRemovable === 'Y',
        permissions: req.body.permissions,
        captchaRate: req.body.captchaRate
    });

    if(req.body.name === group.name) res.reload();
    else res.redirect(`/aclgroup/group_manage?name=${encodeURIComponent(req.body.name)}`);
});

app.get('/aclgroup/self_remove', async (req, res) => {
    const item = await ACLGroupItem.findOne({
        id: req.query.id
    });
    if(!item || !req.query.id || (item.user !== req.user.uuid && item.ip !== req.ip)) return res.error('aclgroup_not_found');

    const group = await ACLGroup.findOne({
        uuid: item.aclGroup
    });
    if(!group.selfRemovable) return res.error('해제할 수 없는 요소입니다.');

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
        content: group.selfRemoveNote || 'SELF REMOVE'
    });

    res.reload(null, true);
});

module.exports = app;