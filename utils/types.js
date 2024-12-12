module.exports = {
    UserTypes: {
        Deleted: -1,
        IP: 0,
        Account: 1
    },
    HistoryTypes: {
        Create: 0,
        Modify: 1,
        Delete: 2,
        Move: 3,
        ACL: 4,
        Revert: 5
    },
    ACLTypes: {
        None: -1,
        Read: 0,
        Edit: 1,
        Move: 2,
        Delete: 3,
        CreateThread: 4,
        WriteThreadComment: 5,
        EditRequest: 6,
        ACL: 7
    },
    ACLConditionTypes: {
        Perm: 0,
        Member: 1,
        IP: 2,
        GeoIP: 3,
        ACLGroup: 4
    },
    ACLActionTypes: {
        Skip: -1,
        Deny: 0,
        Allow: 1,
        GotoNS: 2,
        GotoOtherNS: 3
    },
    GrantablePermissions: [
        'delete_thread',
        'admin',
        'update_thread_status',
        'nsacl',
        'hide_thread_comment',
        'grant',
        'no_force_captcha',
        'login_history',
        'update_thread_document',
        'update_thread_topic',
        'aclgroup',
        'api_access'
    ],
    DevPermissions: [
        'developer',
        'hideip'
    ],
    ACLPermissions: [
        'any',
        'member',
        'admin',
        'member_signup_15days_ago',
        'document_contributor',
        'match_username_and_document_title',
        'ip'
    ],
    permissionMenus: {
        'grant': [{
            l: '/admin/grant',
            t: '권한'
        }],
        'login_history': [{
            l: '/admin/login_history',
            t: '로그인 기록 조회'
        }],
        'admin': [{
            l: '/aclgroup',
            t: 'ACL Group'
        }],
        'developer': [{
            l: '/admin/config',
            t: '개발자 설정'
        }]
    }
}