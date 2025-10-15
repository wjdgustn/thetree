const SeedPermissions = [
    'member',
    'auto_verified_member',
    'mobile_verified_member',
    'developer',
    'nsacl',
    'admin',
    'config',
    'delete_thread',
    'aclgroup',
    'hideip',
    'aclgroup_hidelog',
    'no_force_captcha',
    'skip_captcha',
    'manage_thread',
    'grant',
    'login_history',
    'api_access',
    'hide_document_history_log',
    'hide_revision',
    'mark_troll_revision',
    'batch_revert',
    'edit_protected_file',
    'delete_edit_request'
]
const TreePermissions = [
    'disable_two_factor_login',
    'grant_hidelog',
    'login_history_hidelog',
    'batch_revert_hidelog',
    'engine_developer',
    'manage_account'
]

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
        UpdateDocument: 3,
        PinComment: 4,
        UnpinComment: 5
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
        ACLGroupDelete: 4,
        ManageAccount: 5,
        ModifyConfig: 6,
        ThreadACL: 7
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
    SignupPolicy: {
        None: 0,
        Block: 1,
        RequireVerification: 2
    },
    AllPermissions: [
        ...SeedPermissions,
        ...TreePermissions
    ],
    PermissionFlags: {
        ...Object.fromEntries(SeedPermissions.map((a, i) => [a, 1n << BigInt(i)])),
        ...Object.fromEntries(TreePermissions.map((a, i) => [a, 1n << (BigInt(i) + 50n)]))
    },
    ProtectedPermissions: [
        'developer'
    ],
    AlwaysProtectedPermissions: [
        'mobile_verified_member'
    ],
    NoGrantPermissions: [
        'delete_edit_request',
        'engine_developer'
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
        manage_account: [{
            l: '/admin/manage_account',
            t: '계정 관리'
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
            name: '문서 생성 비활성화',
            methodField: 'POST',
            type: 'js',
            condition: `!req.permissions.includes('admin') && url.startsWith('/edit/') && req.body.baseuuid === 'create'`,
            messageType: 'plaintext',
            message: '새 문서 생성이 비활성화되어 있습니다.'
        }
    ]
}