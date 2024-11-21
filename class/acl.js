const { Address4, Address6 } = require('ip-address');
const { lookup: ipLookup } = require('ip-location-api');

const globalUtils = require('../utils/global');
const { UserTypes, ACLTypes, ACLConditionTypes, ACLActionTypes } = require('../utils/types');

const ACLModel = require('../schemas/acl');
const User = require('../schemas/user');
const ACLGroup = require('../schemas/aclGroup');
const ACLGroupItem = require('../schemas/aclGroupItem');

const checkDefaultData = {
    permissions: [],
    user: null,
    ip: null
}

module.exports = class ACL {
    static async get(filter = {}, document = null) {
        if(typeof filter.document?.uuid === 'string') filter.document = filter.document.uuid;

        let rules;
        if(filter.document === null) rules = [];
        else rules = await ACLModel.find({
            ...filter,
            $or: [
                {
                    expiresAt: {
                        $gte: new Date()
                    }
                },
                {
                    expiresAt: null
                }
            ]
        }).sort({ order: 1 }).lean();

        let namespaceACL;
        if(document?.namespace && !filter.namespace) namespaceACL = await this.get({
            namespace: document.namespace
        }, document);

        for(let rule of rules) {
            if(rule.conditionType === ACLConditionTypes.Member) {
                rule.user = await User.findOne({
                    uuid: rule.conditionContent
                }).lean();
            }
            else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
                rule.aclGroup = await ACLGroup.findOne({
                    name: rule.conditionContent
                });
            }

            if(rule.actionType === ACLActionTypes.GotoOtherNS) {
                rule.otherNamespaceACL = await this.get({
                    namespace: rule.actionContent
                }, document);
            }
        }

        return new this(rules, document, namespaceACL);
    }

    constructor(rules = [], document = null, namespaceACL = null) {
        this.aclTypes = [...Array(Object.keys(ACLTypes).length)].map(_ => []);

        for(let rule of rules) {
            this.aclTypes[rule.type].push(rule);
        }

        if(document) {
            this.document = document;
            this.aclTabMessage = ` 해당 문서의 <a href="${globalUtils.doc_action_link(document, 'acl')}">ACL 탭</a>을 확인하시기 바랍니다.`;
        }

        if(namespaceACL) this.namespaceACL = namespaceACL;
    }

    static aclTypeToString(aclType = ACLTypes.None) {
        return {
            [ACLTypes.None]: '작업',
            [ACLTypes.Read]: '읽기',
            [ACLTypes.Edit]: '편집',
            [ACLTypes.Move]: '이동',
            [ACLTypes.Delete]: '삭제',
            [ACLTypes.CreateThread]: '토론 생성',
            [ACLTypes.WriteThreadComment]: '토론 댓글',
            [ACLTypes.EditRequest]: '편집 요청',
            [ACLTypes.ACL]: 'ACL'
        }[aclType] ?? Object.entries(ACLTypes).find(([_, v]) => v === aclType)?.[0] ?? aclType;
    }

    static permissionToString(permission, withPrefix = false) {
        let result = {
            any: '아무나',
            member: '로그인된 사용자',
            admin: '관리자',
            member_signup_15days_ago: '가입한지 15일 지난 사용자',
            document_contributor: '문서 기여자',
            match_username_and_document_title: '문서 제목과 사용자 이름이 일치'
        }[permission] ?? permission;

        return `${withPrefix && permission === result ? 'perm:' : ''}${result}`;
    }

    static conditionToString(condition) {
        return {
            [ACLConditionTypes.Perm]: '권한',
            [ACLConditionTypes.Member]: '사용자',
            [ACLConditionTypes.IP]: '아이피',
            [ACLConditionTypes.GeoIP]: 'GeoIP',
            [ACLConditionTypes.ACLGroup]: 'ACL그룹'
        }[condition] ?? Object.entries(ACLConditionTypes).find(([_, v]) => v === condition)?.[0] ?? condition;
    }

    static ruleToRequiredString(rule) {
        if(rule.conditionType === ACLConditionTypes.Perm) {
            return ACL.permissionToString(rule.conditionContent, true)
        }
        else if(rule.conditionType === ACLConditionTypes.Member) {
            return `특정 사용자`
        }
        else if(rule.conditionType === ACLConditionTypes.IP) {
            return `특정 IP`
        }
        else if(rule.conditionType === ACLConditionTypes.GeoIP) {
            return `geoip:${rule.conditionContent}`
        }
        else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            return `ACL그룹 ${rule.aclGroup.name}에 속해 있는 사용자`
        }
    }

    static ruleToDenyString(rule, aclGroupId = 0) {
        if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            return `ACL그룹 ${rule.aclGroup.name} #${aclGroupId}에 있기`
        }
        else {
            return `${ACL.ruleToConditionString(rule)}이기`
        }
    }

    static ruleToConditionString(rule, formatPerm = true) {
        if(formatPerm && rule.conditionType === ACLConditionTypes.Perm) {
            return `${ACL.permissionToString(rule.conditionContent)}`
        }
        else if(rule.conditionType === ACLConditionTypes.Member) {
            return `user:${rule.user.name}`
        }
        else {
            return `${Object.keys(ACLConditionTypes)[rule.conditionType].toLowerCase()}:${rule.conditionContent}`;
        }
    }

    static actionToString(ruleOrActionType) {
        return {
            [ACLActionTypes.Deny]: `거부`,
            [ACLActionTypes.Allow]: `허용`,
            [ACLActionTypes.GotoNS]: `이름공간ACL 실행`,
            [ACLActionTypes.GotoOtherNS]: `${ruleOrActionType.actionContent ?? '다른 이름공간'} ACL 실행`
        }[typeof ruleOrActionType === 'object' ? ruleOrActionType.actionType : ruleOrActionType];
    }

    async check(aclType = ACLTypes.None, data = {}) {
        if(aclType === ACLTypes.ACL && data?.permissions?.includes('nsacl')) return { result: true };

        let rules = this.aclTypes[aclType];
        if(!rules.length && this.namespaceACL) rules = this.namespaceACL.aclTypes[aclType];

        let nsResult;
        if(rules.some(r => r.actionType === ACLActionTypes.GotoNS)) nsResult = await this.namespaceACL.check(aclType, data);

        const allowedRules = [];
        for(let rule of rules) {
            if([
                ACLActionTypes.Allow,
                ...(nsResult?.result ? [ACLActionTypes.GotoNS] : [])
            ].includes(rule.actionType)) allowedRules.push(rule);

            const { action, aclGroupItem } = await this.testRule(rule, data);

            if(action === ACLActionTypes.Allow) return { result: true };
            else if(action === ACLActionTypes.Deny) {
                let aclMessage = `${ACL.ruleToDenyString(rule, aclGroupItem?.id)} 때문에 ${ACL.aclTypeToString(aclType)} 권한이 부족합니다.`;
                if(aclGroupItem) {
                    if(rule.aclGroup.aclMessage) aclMessage = rule.aclGroup.aclMessage + ` (#${aclGroupItem.id})`;
                    aclMessage += `\n만료일 : ${aclGroupItem.expiresAt?.toString() ?? '무기한'}`;
                    aclMessage += `\n사유 : ${aclGroupItem.memo ?? '없음'}`;

                    if(rule.aclGroup.isWarn) {
                        aclMessage = rule.aclGroup.aclMessage ?? '경고를 받았습니다.';
                        aclMessage += `\n\n<a href="/self_unblock?id=${aclGroupItem.id}">[확인했습니다. #${aclGroupItem.id}]</a>`;
                        aclMessage += `\n사유: ${aclGroupItem.memo ?? '없음'}`;
                    }
                }

                if(this.document) aclMessage += this.aclTabMessage;

                return {
                    result: false,
                    aclMessage
                }
            }
            else if(action === ACLActionTypes.GotoNS) return nsResult;
            else if(action === ACLActionTypes.GotoOtherNS) return await rule.otherNamespaceACL.check(aclType, data);
        }

        if(allowedRules.length) {
            let aclMessage = `${ACL.aclTypeToString(aclType)} 권한이 부족합니다. ${allowedRules
                .map(r => ACL.ruleToRequiredString(r))
                .join(' OR ')}(이)여야 합니다.`;
            if(this.document) aclMessage += this.aclTabMessage;

            return {
                result: false,
                aclMessage
            }
        }
        else {
            let aclMessage = `ACL에 허용 규칙이 없기 때문에 ${ACL.aclTypeToString(aclType)} 권한이 부족합니다.`;
            if(this.document) aclMessage += this.aclTabMessage;

            return {
                result: false,
                aclMessage
            }
        }
    }

    async testRule(rule, data = {}) {
        data = {
            ...checkDefaultData,
            ...data
        }

        const action = rule.actionType;

        if(rule.conditionType === ACLConditionTypes.Perm) {
            if(rule.conditionContent === 'any') return { action };

            if(!data.permissions) return ACLActionTypes.Skip;
            if(data.permissions.includes(rule.conditionContent)) return { action };
        }
        else if(rule.conditionType === ACLConditionTypes.Member) {
            if(!rule.user) return ACLActionTypes.Skip;

            if(data.user?.uuid === rule.user.uuid) return { action };
        }
        else if(rule.conditionType === ACLConditionTypes.IP) {
            if(!data.ip) return ACLActionTypes.Skip;

            const requestIsV4 = Address4.isValid(data.ip);
            const targetIsV4 = Address4.isValid(rule.conditionContent);

            if(requestIsV4 !== targetIsV4) return { action: ACLActionTypes.Skip };

            if(requestIsV4 && targetIsV4) {
                const request = new Address4(data.ip);
                const target = new Address4(rule.conditionContent);

                if(request.isInSubnet(target)) return { action };
            }
            else {
                const request = new Address6(data.ip);
                const target = new Address6(rule.conditionContent);

                if(request.isInSubnet(target)) return { action };
            }
        }
        else if(rule.conditionType === ACLConditionTypes.GeoIP) {
            if(!data.ip) return ACLActionTypes.Skip;

            const lookupResult = ipLookup(data.ip);
            if(!lookupResult) return ACLActionTypes.Skip;

            if(lookupResult.country === rule.conditionContent) return { action };
        }
        else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            if(!rule.aclGroup) return { action: ACLActionTypes.Skip };

            if(data.user?.type === UserTypes.Account) {
                const userTest = await ACLGroupItem.findOne({
                    aclGroup: rule.aclGroup.uuid,
                    expiresAt: {
                        $gte: new Date()
                    },
                    user: data.user.uuid
                });
                if(userTest) return { action, aclGroupItem: userTest };
            }

            let ipArr;
            if(Address4.isValid(data.ip)) ipArr = new Address4(data.ip).toArray();
            else ipArr = new Address6(data.ip).toByteArray();

            const ipTest = await ACLGroupItem.findOne({
                aclGroup: rule.aclGroup.uuid,
                expiresAt: {
                    $gte: new Date()
                },
                ipMin: {
                    $lte: ipArr
                },
                ipMax: {
                    $gte: ipArr
                }
            });
            if(ipTest) return { action, aclGroupItem: ipTest };
        }

        return { action: ACLActionTypes.Skip };
    }
}