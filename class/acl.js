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
        const rules = await ACLModel.find({
            ...filter,
            expiresAt: {
                $gte: new Date()
            }
        }).sort({ order: 1 }).lean();

        let namespaceACL;
        if(document.namespace && filter.document) namespaceACL = await this.get({
            namespace: document.namespace
        }, document);

        for(let rule of rules) {
            if(rule.conditionType === ACLConditionTypes.User) {
                rule.user = await User.findOne({
                    uuid: rule.conditionContent
                }).lean();
            }
            else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
                rule.aclGroup = await ACLGroup.findOne({
                    name: rule.conditionContent
                });
            }

            if(rule.actionType === ACLActionTypes.GotoNamespace) {
                if(document) rule.namespaceACL = await this.get({
                    namespace: document.namespace
                });
            }
            else if(rule.actionType === ACLActionTypes.GotoOtherNamespace) {
                rule.otherNamespaceACL = await this.get({
                    namespace: rule.actionContent
                });
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
            [ACLTypes.EditAcl]: 'ACL'
        }[aclType];
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

    static ruleToRequiredString(rule) {
        if(rule.conditionType === ACLConditionTypes.Permission) {
            return ACL.permissionToString(rule.conditionContent, true)
        }
        else if(rule.conditionType === ACLConditionTypes.User) {
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
        if(rule.conditionType === ACLConditionTypes.Permission) {
            return `${ACL.permissionToString(rule.conditionContent)}이기`
        }
        else if(rule.conditionType === ACLConditionTypes.User) {
            return `user:${rule.user.username}이기`
        }
        else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            return `ACL그룹 ${rule.aclGroup.name} #${aclGroupId}에 있기`
        }
        else {
            return `${Object.keys(ACLConditionTypes)[rule.conditionType].toLowerCase()}:${rule.conditionContent}이기`
        }
    }

    async check(aclType = ACLTypes.None, data = {}) {
        let rules = this.aclTypes[aclType];
        if(!rules.length && this.namespaceACL) rules = this.namespaceACL.aclTypes[aclType];

        const allowedRules = [];
        for(let rule of rules) {
            if(rule.actionType === ACLActionTypes.Allow) allowedRules.push(rule);

            const { result, aclGroupId } = await this.testRule(rule, data);

            if(result === ACLActionTypes.Allow) return { result };
            else if(result === ACLActionTypes.Deny) {
                let aclMessage = `${ACL.ruleToDenyString(rule, aclGroupId)}이기 때문에 ${ACL.aclTypeToString(aclType)} 권한이 부족합니다.`;
                if(this.document) aclMessage += this.aclTabMessage;

                return {
                    result,
                    aclMessage
                }
            }
            else if(result === ACLActionTypes.GotoNamespace) return await rule.namespaceACL.check(aclType, data);
            else if(result === ACLActionTypes.GotoOtherNamespace) return await rule.otherNamespaceACL.check(aclType, data);
        }

        if(allowedRules.length) {
            let aclMessage = `${ACL.aclTypeToString(aclType)} 권한이 부족합니다. ${rules.map(r => ACL.ruleToRequiredString(r)).join(' OR ')}(이)여야 합니다.`;
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

        if(rule.conditionType === ACLConditionTypes.User) {
            if(!rule.user) return ACLActionTypes.Skip;

            if(data.user?.uuid === rule.user.uuid) return { action };
        }
        else if(rule.conditionType === ACLConditionTypes.IP) {
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
            const { country } = ipLookup(data.ip);
            if(country === rule.conditionContent) return { action };
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
                if(userTest) return { action, aclGroupId: userTest.id };
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
            if(ipTest) return { action, aclGroupId: ipTest.id };
        }

        return { action: ACLActionTypes.Skip };
    }
}