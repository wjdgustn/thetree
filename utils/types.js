module.exports = {
    UserTypes: {
        Deleted: -1,
        IP: 0,
        Account: 1,
        Migrated: 2
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
        User: 1,
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
    BacklinkFlags: {
        Link: 1,
        File: 2,
        Include: 4,
        Redirect: 8
    },
    BlockHistoryTypes: {
        ACLGroupAdd: 0,
        ACLGroupRemove: 1,
        Grant: 2,
        BatchRevert: 3,
        LoginHistory: 4
    },
    ThreadStatusTypes: {
        Normal: 0,
        Pause: 1,
        Close: 2
    },
    ThreadCommentTypes: {
        Default: 0,
        UpdateStatus: 1,
        UpdateTopic: 2,
        UpdateDocument: 3
    },
    EditRequestStatusTypes: {
        Open: 0,
        Accepted: 1,
        Closed: 2,
        Locked: 3
    },
    AuditLogTypes: {
        NamespaceACL: 0,
        DeleteThread: 1,
        DevSupport: 2,
        ACLGroupCreate: 3,
        ACLGroupDelete: 4
    },
    LoginHistoryTypes: {
        Login: 0,
        IPChange: 1
    },
    NotificationTypes: {
        UserDiscuss: 0,
        Mention: 1,
        Owner: 2,
        Plugin: 3
    },
    AllPermissions: [
        'delete_thread',
        'admin',
        'update_thread_status',
        'nsacl',
        'hide_thread_comment',
        'grant',
        'disable_two_factor_login',
        'login_history',
        'update_thread_document',
        'update_thread_topic',
        'aclgroup',
        'hide_document_history_log',
        'hide_revision',
        'mark_troll_revision',
        'batch_revert',
        'api_access',
        'developer',
        'hideip',
        'config',
        'skip_captcha',
        'aclgroup_hidelog',
        'grant_hidelog',
        'login_history_hidelog',
        'batch_revert_hidelog',
        'edit_protected_file',
        'engine_developer',
        'auto_verified_member'
    ],
    ProtectedPermissions: [
        'developer'
    ],
    NoGrantPermissions: [
        'engine_developer',
        'auto_verified_member'
    ],
    ACLPermissions: [
        'any',
        'ip',
        'member',
        'admin',
        'member_signup_15days_ago',
        'document_contributor',
        'contributor',
        'match_username_and_document_title'
    ],
    permissionMenus: {
        grant: [{
            l: '/admin/grant',
            t: '권한'
        }],
        login_history: [{
            l: '/admin/login_history',
            t: '로그인 기록 조회'
        }],
        admin: [{
            l: '/aclgroup',
            t: 'ACL Group'
        }],
        batch_revert: [{
            l: '/admin/batch_revert',
            t: '일괄 되돌리기'
        }],
        config: [
            {
                l: '/admin/audit_log',
                t: '감사 로그'
            },
            {
                l: '/admin/config',
                t: '설정'
            }
        ],
        developer: [{
            l: '/admin/developer',
            t: '개발자 설정'
        }]
    },
    disabledFeaturesTemplates: [
        {
            name: '빈 템플릿',
            methodField: 'ALL',
            type: 'string',
            condition: '',
            messageType: 'res.error',
            message: ''
        },
        {
            name: '읽기 전용 모드',
            methodField: 'ALL',
            type: 'js',
            condition: `['/edit/','/move/','/delete/','/member/login','/member/logout'].some(a => url.startsWith(a)) || req.method !== 'GET'`,
            messageType: 'flexible',
            message: '위키가 읽기 전용 모드입니다.'
        },
        {
            name: '계정 만들기 비활성화',
            methodField: 'ALL',
            type: 'js',
            condition: `url.split('/')[1] === 'member' && url.split('/')[2] === 'signup' && !url.split('/')[3]`,
            messageType: 'flexible',
            message: '계정 만들기가 비활성화되어 있습니다.'
        },
        {
            name: '문서 생성 비활성화',
            methodField: 'POST',
            type: 'js',
            condition: `!req.permissions.includes('admin') && url.startsWith('/edit/') && req.body.baseuuid === 'create'`,
            messageType: 'plaintext',
            message: '새 문서 생성이 비활성화되어 있습니다.'
        }
    ]
}