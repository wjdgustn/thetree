module.exports = {
    UserTypes: {
        Deleted: -1,
        IP: 0,
        Account: 1
    },
    HistoryTypes: {
        Create: 0,
        Edit: 1,
        Delete: 2,
        Move: 3,
        ACL: 4,
        Rollback: 5
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
        Permission: 0,
        User: 1,
        IP: 2,
        GeoIP: 3,
        ACLGroup: 4
    },
    ACLActionTypes: {
        Skip: -1,
        Deny: 0,
        Allow: 1,
        GotoNamespace: 2,
        GotoOtherNamespace: 3
    }
}