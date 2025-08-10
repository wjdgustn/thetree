const { models } = require('mongoose');
const { Address4, Address6 } = require('ip-address');
const { lookup: ipLookup } = require('ip-location-api');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const namumarkUtils = require('../utils/newNamumark/utils');
const { UserTypes, ACLTypes, ACLConditionTypes, ACLActionTypes } = require('../utils/types');

const checkDefaultData = {
    permissions: [],
    user: null,
    ip: null
}

module.exports = class ACL {
    static async get(filter = {}, document = null, noOtherNS = false) {
        let thread;
        if(typeof filter.thread?.uuid === 'string') {
            thread = filter.thread;
            filter.thread = filter.thread.uuid;

            if(!document) {
                const doc = await models.Document.findOne({
                    uuid: thread.document
                });
                if(doc) document = utils.dbDocumentToDocument(doc);
            }
        }
        else if(typeof filter.document?.uuid === 'string') {
            if(document == null) document = filter.document;
            filter.document = filter.document.uuid;
        }

        let rules;
        if(filter.document === null) rules = [];
        else rules = await models.ACL.find({
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

        let documentACL;
        if(document && thread?.document) documentACL = await this.get({
            document: thread.document
        });

        let namespaceACL;
        if(document?.namespace && !filter.namespace) namespaceACL = await this.get({
            namespace: document.namespace
        }, document);

        for(let rule of rules) {
            if(rule.conditionType === ACLConditionTypes.User) {
                rule.user = await models.User.findOne({
                    uuid: rule.conditionContent
                })
                    .select('type uuid name -_id')
                    .lean();
            }
            else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
                rule.aclGroup = await models.ACLGroup.findOne({
                    uuid: rule.conditionContent
                })
                    .select('uuid name aclMessage isWarn -_id')
                    .lean();
            }

            if(rule.actionType === ACLActionTypes.GotoOtherNS && !noOtherNS) {
                rule.otherNamespaceACL = await this.get({
                    namespace: rule.actionContent
                }, document, true);
            }
        }

        return new this(rules, document, { thread, documentACL, namespaceACL }, noOtherNS);
    }

    constructor(rules = [], document = null, { thread, documentACL, namespaceACL }, noOtherNS = false) {
        this.aclTypes = [...Array(Object.keys(ACLTypes).length)].map(_ => []);

        for(let rule of rules) {
            this.aclTypes[rule.type].push(rule);
        }

        if(document) {
            this.document = document;
            this.aclTabMessage = ` 해당 ${thread ? '토론' : '문서'}의 <a href="${thread ? `/thread/${thread.url}/acl` : globalUtils.doc_action_link(document, 'acl')}">ACL 탭</a>을 확인하시기 바랍니다.`;
        }

        if(documentACL) this.documentACL = documentACL;
        if(namespaceACL) this.namespaceACL = namespaceACL;

        this.noOtherNS = noOtherNS;
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
            [ACLTypes.ACL]: 'ACL 편집'
        }[aclType] ?? utils.getKeyFromObject(ACLTypes, aclType) ?? aclType;
    }

    static permissionToString(permission, withPrefix = false) {
        let result = {
            any: '아무나',
            ip: '아이피 사용자',
            member: '로그인된 사용자',
            admin: '관리자',
            member_signup_15days_ago: '가입한지 15일 지난 사용자',
            document_contributor: '해당 문서 기여자',
            contributor: '위키 기여자',
            match_username_and_document_title: '문서 제목과 사용자 이름이 일치',
            auto_verified_member: '자동 인증된 사용자'
        }[permission] ?? permission;

        return `${withPrefix && permission === result ? 'perm:' : ''}${result}`;
    }

    static conditionToString(condition) {
        return {
            [ACLConditionTypes.Perm]: '권한',
            [ACLConditionTypes.User]: '사용자',
            [ACLConditionTypes.IP]: '아이피',
            [ACLConditionTypes.GeoIP]: 'GeoIP',
            [ACLConditionTypes.ACLGroup]: 'ACL그룹'
        }[condition] ?? utils.getKeyFromObject(ACLConditionTypes, condition) ?? condition;
    }

    static ruleToRequiredString(rule) {
        if(rule.conditionType === ACLConditionTypes.Perm) {
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
            return `ACL그룹 ${rule.aclGroup?.name ?? rule.conditionContent}에 속해 있는 사용자`
        }
    }

    static ruleToDenyString(rule, aclGroupId = 0, isIp = false) {
        if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            return `${isIp ? '현재 사용중인 아이피가 ' : ''}ACL그룹 ${rule.aclGroup.name} #${aclGroupId}에 있기`
        }
        else {
            return `${ACL.ruleToConditionString(rule)}이기`
        }
    }

    static ruleToConditionString(rule, formatPerm = true) {
        if(rule.conditionType === ACLConditionTypes.Perm) {
            return `${ACL.permissionToString(rule.conditionContent, !formatPerm)}`
        }
        else if(rule.conditionType === ACLConditionTypes.User) {
            return `user:${rule.user?.name ?? rule.conditionContent}`
        }
        else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            return `aclgroup:${rule.aclGroup?.name ?? rule.conditionContent}`
        }
        else {
            return `${Object.keys(ACLConditionTypes)[rule.conditionType].toLowerCase()}:${rule.conditionContent}`;
        }
    }

    static actionToString(ruleOrActionType) {
        const safeActionContent = namumarkUtils.escapeHtml(ruleOrActionType.actionContent);
        return {
            [ACLActionTypes.Deny]: `거부`,
            [ACLActionTypes.Allow]: `허용`,
            [ACLActionTypes.GotoNS]: `이름공간ACL 실행`,
            [ACLActionTypes.GotoOtherNS]: `${ruleOrActionType.actionContent
                ? `<a href="/acl/${safeActionContent}:#namespace.${utils.camelToSnakeCase(utils.getKeyFromObject(ACLTypes, ruleOrActionType.type))}">${safeActionContent}</a>`
                : '다른 이름공간'} ACL 실행`
        }[typeof ruleOrActionType === 'object' ? ruleOrActionType.actionType : ruleOrActionType];
    }

    async check(aclType = ACLTypes.None, data = {}, noReadCheck = false) {
        if(data.alwaysAllow) return { result: true };

        const nsaclPerm = data?.permissions?.includes('nsacl') || data?.permissions?.includes('developer');
        const nsaclPermValid = nsaclPerm && (!this.document || !config.protected_namespaces?.includes(this.document.namespace));
        const configPerm = data?.permissions?.includes('config');
        if(aclType === ACLTypes.ACL && (nsaclPermValid || (nsaclPerm && configPerm))) return { result: true };

        if(!noReadCheck && aclType !== ACLTypes.Read && aclType !== ACLTypes.ACL) {
            const readCheck = await this.check(ACLTypes.Read, data);
            if(!readCheck.result) return readCheck;
        }

        if([
            ACLTypes.Move,
            ACLTypes.Delete
        ].includes(aclType)) {
            const editCheck = await this.check(ACLTypes.Edit, data, true);
            if(!editCheck.result) return editCheck;
        }

        if(aclType === ACLTypes.CreateThread) {
            const commentCheck = await this.check(ACLTypes.WriteThreadComment, data, true);
            if(!commentCheck.result) return commentCheck;
        }

        let rules = this.aclTypes[aclType];
        if(!rules.length && this.documentACL) rules = this.documentACL.aclTypes[aclType];
        if(!rules.length && this.namespaceACL) rules = this.namespaceACL.aclTypes[aclType];

        let nsResult;
        if(rules.some(r => r.actionType === ACLActionTypes.GotoNS)) nsResult = await this.namespaceACL.check(aclType, data, true);

        const otherNSResults = {};

        const allowedRules = [];
        for(let rule of rules) {
            if(rule.actionType === ACLActionTypes.GotoOtherNS && !otherNSResults[rule.actionContent] && !this.noOtherNS) {
                otherNSResults[rule.actionContent] = await rule.otherNamespaceACL.check(aclType, data, true);
            }

            if([
                ACLActionTypes.Allow,
                // ...(nsResult?.result ? [ACLActionTypes.GotoNS] : [])
                ACLActionTypes.GotoNS
            ].includes(rule.actionType)) allowedRules.push(rule);
            else if(rule.actionType === ACLActionTypes.GotoOtherNS
                && otherNSResults[rule.actionContent]?.result) allowedRules.push(rule);

            const { action, aclGroupItem } = await this.testRule(rule, data);

            if(action === ACLActionTypes.Allow) return { result: true };
            else if(action === ACLActionTypes.Deny) {
                let aclMessage = `${ACL.ruleToDenyString(rule, aclGroupItem?.id, aclGroupItem?.ip != null)} 때문에 ${ACL.aclTypeToString(aclType)} 권한이 부족합니다.`;
                if(aclGroupItem) {
                    if(rule.aclGroup.aclMessage) aclMessage = rule.aclGroup.aclMessage + ` (#${aclGroupItem.id})`;
                    aclMessage += `<br>만료일 : ${aclGroupItem.expiresAt?.toString() ?? '무기한'}`;
                    aclMessage += `<br>\n사유 : ${namumarkUtils.escapeHtml(aclGroupItem.note ?? '없음')}`;

                    if(rule.aclGroup.isWarn) {
                        aclMessage = rule.aclGroup.aclMessage || '경고를 받았습니다.';
                        aclMessage += `<br><br><a href="/self_unblock?id=${aclGroupItem.id}">[확인했습니다. #${aclGroupItem.id}]</a>`;
                        aclMessage += `<br>\n사유: ${namumarkUtils.escapeHtml(aclGroupItem.note ?? '없음')}`;
                    }
                }

                if(this.document && !aclGroupItem) aclMessage += this.aclTabMessage;

                return {
                    result: false,
                    aclMessage
                }
            }
            else if(action === ACLActionTypes.GotoNS) return nsResult;
            else if(action === ACLActionTypes.GotoOtherNS) {
                if(this.noOtherNS) return { result: false, aclMessage: '다른 이름공간 ACL 실행이 이중으로 사용되었습니다.' };
                else return await rule.otherNamespaceACL.check(aclType, data, true);
            }
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

        if(action >= ACLActionTypes.Allow
            && data?.permissions?.includes('developer')) return { action };

        if(rule.conditionType === ACLConditionTypes.Perm) {
            if(rule.conditionContent === 'any') return { action };

            if(data.user && rule.document && rule.conditionContent === 'document_contributor') {
                const contribution = await models.History.exists({
                    document: rule.document,
                    user: data.user.uuid
                });
                if(contribution) return { action };
                else return { action: ACLActionTypes.Skip };
            }
            if(data.user && this.document && rule.conditionContent === 'match_username_and_document_title') {
                const docName = this.document.title.split('/')[0];
                if(data.user.name === docName) return { action };
                else return { action: ACLActionTypes.Skip };
            }

            if(!data.permissions) return { action: ACLActionTypes.Skip };
            if(data.permissions.includes(rule.conditionContent)) return { action };
        }
        else if(rule.conditionType === ACLConditionTypes.User) {
            if(!rule.user) return { action: ACLActionTypes.Skip };

            if(data.user?.uuid === rule.user.uuid) return { action };
        }
        else if(rule.conditionType === ACLConditionTypes.IP) {
            if(!data.ip) return { action: ACLActionTypes.Skip };

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
            if(!data.ip) return { action: ACLActionTypes.Skip };

            const lookupResult = ipLookup(data.ip);
            if(!lookupResult) return { action: ACLActionTypes.Skip };

            if(lookupResult.country === rule.conditionContent) return { action };
        }
        else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            if(!rule.aclGroup) return { action: ACLActionTypes.Skip };

            if(data.user?.type === UserTypes.Account) {
                const userTest = await models.ACLGroupItem.findOne({
                    aclGroup: rule.aclGroup.uuid,
                    $or: [
                        {
                            expiresAt: {
                                $gte: new Date()
                            }
                        },
                        {
                            expiresAt: null
                        }
                    ],
                    user: data.user.uuid
                });
                if(userTest) return { action, aclGroupItem: userTest };
            }

            if(data.ip) {
                let ipArr;
                if(Address4.isValid(data.ip)) ipArr = new Address4(data.ip).toArray();
                else ipArr = new Address6(data.ip).toByteArray();

                const ipTest = await models.ACLGroupItem.findOne({
                    aclGroup: rule.aclGroup.uuid,
                    $or: [
                        {
                            expiresAt: {
                                $gte: new Date()
                            }
                        },
                        {
                            expiresAt: null
                        }
                    ],
                    ipMin: {
                        $lte: ipArr
                    },
                    ipMax: {
                        $gte: ipArr
                    }
                });
                if(ipTest) return { action, aclGroupItem: ipTest };
            }
        }

        return { action: ACLActionTypes.Skip };
    }
}