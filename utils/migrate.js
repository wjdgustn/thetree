const fs = require('fs');

const {
    UserTypes
} = require('./types');

const Document = require('../schemas/document');
const History = require('../schemas/history');
const User = require('../schemas/user');

module.exports = [
    {
        timestamp: 1752803911011,
        code: () => {
            console.log('migration test');
        }
    },
    {
        timestamp: 1752849211824,
        code: async () => {
            console.log('deleting lastMigrationCheck.json...');
            fs.unlinkSync('./cache/lastMigrationCheck.json');
            console.log('deleted lastMigrationCheck.json');
            console.log('migrating deleted user documents...');
            await Document.updateMany({
                namespace: '사용자',
                title: {
                    $regex: /^\*/
                }
            }, [{
                $set: {
                    namespace: '삭제된사용자',
                    title: {
                        $substrCP: ['$title', 1, { $strLenCP: '$title' }]
                    }
                }
            }]);
            console.log('migrated deleted user documents');
            console.log('migrating deleted user histories...');
            await History.updateMany({
                type: 3,
                moveNewDoc: {
                    $regex: /^사용자:\*/
                }
            }, [{
                $set: {
                    moveNewDoc: {
                        $replaceOne: {
                            input: '$moveNewDoc',
                            find: '사용자:*',
                            replacement: '삭제된사용자:'
                        }
                    }
                }
            }]);
            console.log('migrated deleted user histories');
        }
    },
    {
        timestamp: 1755837033735,
        code: async () => {
            await User.updateMany({
                permissions: 'no_force_captcha'
            }, {
                $addToSet: {
                    permissions: 'skip_captcha'
                }
            });
            await User.updateMany({
                permissions: 'no_force_captcha'
            }, {
                $pull: {
                    permissions: 'no_force_captcha'
                }
            });
        }
    },
    {
        timestamp: 1756890112548,
        code: async () => {
            const threadPerms = ['update_thread_status', 'hide_thread_comment', 'update_thread_document', 'update_thread_topic'];

            await User.updateMany({
                permissions: {
                    $in: threadPerms
                }
            }, {
                $addToSet: {
                    permissions: 'manage_thread'
                }
            });
            await User.updateMany({
                permissions: {
                    $in: threadPerms
                }
            }, {
                $pullAll: {
                    permissions: threadPerms
                }
            });
        }
    },
    {
        timestamp: 1758254444363,
        code: async () => {
            await User.updateMany({
                $and: [
                    {
                        permissions: 'aclgroup'
                    },
                    {
                        permissions: { $nin: ['config', 'developer'] }
                    }
                ]
            }, {
                $pull: {
                    permissions: 'aclgroup'
                }
            });
        }
    },
    {
        timestamp: 1758778622368,
        code: async () => {
            await User.updateMany({
                type: UserTypes.Account
            }, {
                $addToSet: {
                    permissions: 'member'
                }
            });
        }
    }
]