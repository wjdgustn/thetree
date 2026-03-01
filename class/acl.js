const { models } = require('mongoose');
const { Address4, Address6 } = require('ip-address');
const { lookup: ipLookup } = require('ip-location-api');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const namumarkUtils = require('../utils/namumark/utils');
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
                    .select('uuid name aclMessage -_id')
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
        }

        if(documentACL) this.documentACL = documentACL;
        if(namespaceACL) this.namespaceACL = namespaceACL;

        this.thread = thread;
        this.noOtherNS = noOtherNS;
    }

    static aclTabMessage(lang = 'ko') {
        return ' ' + i18next.t('acl.acl_tab_message', {
            lng: lang,
            target: i18next.t(`acl.acl_target_${this.thread ? 'thread' : 'document'}`, {
                lng: lang
            }),
            linkOpen: `<a href="${this.thread ? `/thread/${this.thread.url}/acl` : globalUtils.doc_action_link(this.document, 'acl')}">`,
            linkClose: '</a>'
        })
    }

    static aclTypeToString(aclType = ACLTypes.None, lang = 'ko') {
        return i18next.t(`acl.types.${aclType}`, {
            lng: lang,
            defaultValue: utils.getKeyFromObject(ACLTypes, aclType) ?? aclType.toString()
        });
    }

    static permissionToString(permission, lang = 'ko', withPrefix = false) {
        let result = i18next.t(`permissions.${permission}`, {
            lng: lang,
            defaultValue: permission
        });

        return `${withPrefix && permission === result ? 'perm:' : ''}${namumarkUtils.escapeHtml(result)}`;
    }

    // static conditionToString(condition) {
    //     return {
    //         [ACLConditionTypes.Perm]: '권한',
    //         [ACLConditionTypes.User]: '사용자',
    //         [ACLConditionTypes.IP]: '아이피',
    //         [ACLConditionTypes.GeoIP]: 'GeoIP',
    //         [ACLConditionTypes.ACLGroup]: 'ACL그룹'
    //     }[condition] ?? utils.getKeyFromObject(ACLConditionTypes, condition) ?? condition;
    // }

    static ruleToRequiredString(rule, lang = 'ko') {
        let str = rule.not ? 'NOT ' : '';
        if(rule.conditionType === ACLConditionTypes.Perm) {
            str += ACL.permissionToString(rule.conditionContent, lang, true);
        }
        else if(rule.conditionType === ACLConditionTypes.User) {
            str += i18next.t('acl.required_string.user', { lng: lang });
        }
        else if(rule.conditionType === ACLConditionTypes.IP) {
            str += i18next.t('acl.required_string.ip', { lng: lang });
        }
        else if(rule.conditionType === ACLConditionTypes.GeoIP) {
            str += `geoip:${namumarkUtils.escapeHtml(rule.conditionContent)}`;
        }
        else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            str += i18next.t('acl.required_string.aclgroup', {
                lng: lang,
                group: namumarkUtils.escapeHtml(rule.aclGroup?.name ?? rule.conditionContent)
            });
        }
        return str;
    }

    static ruleToDenyString(rule, lang = 'ko', aclGroupId = null, isIp = false) {
        if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            return i18next.t(`acl.deny_string.${aclGroupId ? 'in_group' : 'not_in_group'}`, {
                lng: lang,
                usingIpStr: isIp ? i18next.t('acl.deny_string.using_ip', { lng: lang }) : '',
                group: namumarkUtils.escapeHtml(rule.aclGroup.name),
                groupId: aclGroupId?.toString()
            });
        }
        else {
            return i18next.t('acl.deny_string.condition', {
                lng: lang,
                condition: ACL.ruleToConditionString(rule, lang, false)
            });
        }
    }

    static ruleToConditionString(rule, lang = 'ko', formatPerm = true) {
        let str = rule.not ? 'NOT ' : '';
        if(rule.conditionType === ACLConditionTypes.Perm) {
            str += `${ACL.permissionToString(rule.conditionContent, lang, !formatPerm)}`
        }
        else if(rule.conditionType === ACLConditionTypes.User) {
            str += `user:${namumarkUtils.escapeHtml(rule.user?.name ?? rule.conditionContent)}`
        }
        else if(rule.conditionType === ACLConditionTypes.ACLGroup) {
            str += `aclgroup:${namumarkUtils.escapeHtml(rule.aclGroup?.name ?? rule.conditionContent)}`
        }
        else {
            str += `${Object.keys(ACLConditionTypes)[rule.conditionType].toLowerCase()}:${namumarkUtils.escapeHtml(rule.conditionContent)}`;
        }
        return str;
    }

    static actionToString(ruleOrActionType, lang = 'ko') {
        const safeActionContent = namumarkUtils.escapeHtml(ruleOrActionType.actionContent);
        const actionType = typeof ruleOrActionType === 'object' ? ruleOrActionType.actionType : ruleOrActionType;
        return i18next.t(`acl.actions.${actionType}`, {
            lng: lang,
            ...(actionType === ACLActionTypes.GotoOtherNS ? {
                namespace: ruleOrActionType.actionContent
                    ? `<a href="/acl/${safeActionContent}:document#namespace.${utils.camelToSnakeCase(utils.getKeyFromObject(ACLTypes, ruleOrActionType.type))}">${safeActionContent}</a>`
                    : i18next.t('acl.actions.other_namespace', { lng: lang })
            } : {})
        });
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
                let aclMessage = i18next.t('acl.deny_string.message', {
                    lng: data.lang,
                    rule: ACL.ruleToDenyString(rule, data.lang, aclGroupItem?.id, aclGroupItem?.ip != null),
                    type: ACL.aclTypeToString(aclType, data.lang)
                });
                if(aclGroupItem) {
                    // if(rule.aclGroup.aclMessage) aclMessage = rule.aclGroup.aclMessage + ` (#${aclGroupItem.id})`;
                    aclMessage += `<br>${i18next.t('acl.deny_string.expiry', { lng: data.lang })} : ${aclGroupItem.expiresAt?.toString() ?? i18next.t('acl.deny_string.forever', { lng: data.lang })}`;
                    aclMessage += `<br>\n${i18next.t('acl.deny_string.reason', { lng: data.lang })} : ${namumarkUtils.escapeHtml(aclGroupItem.note ?? 'null')}`;
                    if(rule.aclGroup.aclMessage) {
                        aclMessage = rule.aclGroup.aclMessage;
                        for(let [key, value] of Object.entries({
                            name: rule.aclGroup.name,
                            id: aclGroupItem.id,
                            note: aclGroupItem.note,
                            expired: aclGroupItem.expiresAt?.toString() ?? i18next.t('acl.deny_string.forever', { lng: data.lang })
                        })) {
                            aclMessage = aclMessage.replaceAll(`{${key}}`, namumarkUtils.escapeHtml(value));
                        }
                    }
                }

                if(this.document && !aclGroupItem) aclMessage += ACL.aclTabMessage(data.lang);

                return {
                    result: false,
                    aclMessage
                }
            }
            else if(action === ACLActionTypes.GotoNS) return nsResult;
            else if(action === ACLActionTypes.GotoOtherNS) {
                if(this.noOtherNS) return { result: false, aclMessage: i18next.t('acl.deep_other_ns', { lang: data.lang }) };
                else return await rule.otherNamespaceACL.check(aclType, data, true);
            }
        }

        if(allowedRules.length) {
            let aclMessage = i18next.t('acl.allowed_listing_deny' + (allowedRules.length > 5 ? '_many' : ''), {
                lng: data.lang,
                type: ACL.aclTypeToString(aclType, data.lang),
                rules: allowedRules
                    .slice(0, 5)
                    .map(r => ACL.ruleToRequiredString(r, data.lang))
                    .join(' OR '),
                count: allowedRules.length - 5
            });
            if(this.document) aclMessage += ACL.aclTabMessage(data.lang);

            return {
                result: false,
                aclMessage
            }
        }
        else {
            let aclMessage = i18next.t('acl.no_rules_deny', {
                lng: data.lang,
                type: ACL.aclTypeToString(aclType, data.lang)
            });
            if(this.document) aclMessage += ACL.aclTabMessage(data.lang);

            return {
                result: false,
                aclMessage
            }
        }
    }

    async testRule(rule, data = {}) {
        const action = rule.actionType;
        if(action >= ACLActionTypes.Allow
            && data?.permissions?.includes('developer')) return { action };

        const result = await this.actualTestRule(rule, data);
        if(rule.not) result.result = !result.result;
        if(result.result) {
            delete result.result;
            result.action = action;
            return result;
        }
        else return { action: ACLActionTypes.Skip };
    }

    async actualTestRule(rule, data = {}) {
        data = {
            ...checkDefaultData,
            ...data
        }

        if(rule.conditionType === ACLConditionTypes.Perm) {
            if(rule.conditionContent === 'any') return { result: true };

            if(data.user && rule.document && rule.conditionContent === 'document_contributor') {
                const contribution = await models.History.exists({
                    document: rule.document,
                    user: data.user.uuid
                });
                if(contribution) return { result: true };
                else return { action: ACLActionTypes.Skip };
            }
            if(data.user && this.document && rule.conditionContent === 'match_username_and_document_title') {
                const docName = this.document.title.split('/')[0];
                if(data.user.name === docName) return { result: true };
                else return { action: ACLActionTypes.Skip };
            }

            if(!data.permissions) return { action: ACLActionTypes.Skip };
            if(data.permissions.includes(rule.conditionContent)) return { result: true };
        }
        else if(rule.conditionType === ACLConditionTypes.User) {
            if(!rule.user) return { action: ACLActionTypes.Skip };

            if(data.user?.uuid === rule.user.uuid) return { result: true };
        }
        else if(rule.conditionType === ACLConditionTypes.IP) {
            if(!data.ip) return { action: ACLActionTypes.Skip };

            const requestIsV4 = Address4.isValid(data.ip);
            const targetIsV4 = Address4.isValid(rule.conditionContent);

            if(requestIsV4 !== targetIsV4) return { action: ACLActionTypes.Skip };

            if(requestIsV4 && targetIsV4) {
                const request = new Address4(data.ip);
                const target = new Address4(rule.conditionContent);

                if(request.isInSubnet(target)) return { result: true };
            }
            else {
                const request = new Address6(data.ip);
                const target = new Address6(rule.conditionContent);

                if(request.isInSubnet(target)) return { result: true };
            }
        }
        else if(rule.conditionType === ACLConditionTypes.GeoIP) {
            if(!data.ip) return { action: ACLActionTypes.Skip };

            const lookupResult = ipLookup(data.ip);
            if(!lookupResult) return { action: ACLActionTypes.Skip };

            if(lookupResult.country === rule.conditionContent) return { result: true };
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
                if(userTest) return { result: true, aclGroupItem: userTest };
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
                if(ipTest) return { result: true, aclGroupItem: ipTest };
            }
        }

        return { action: ACLActionTypes.Skip };
    }
}