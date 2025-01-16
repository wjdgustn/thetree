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
        BatchRevert: 3
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
        'hide_document_history_log',
        'hide_revision',
        'mark_troll_revision',
        'batch_revert',
        'api_access'
    ],
    DevPermissions: [
        'developer',
        'hideip'
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
        developer: [{
            l: '/admin/config',
            t: '개발자 설정'
        }]
    }
}