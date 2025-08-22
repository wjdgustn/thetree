const fs = require('fs');

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
        timestamp: 1755836893854,
        code: async () => {
            await User.updateMany({
                permissions: 'no_force_captcha'
            }, {
                $addToSet: {
                    permissions: 'skip_captcha'
                },
                $pull: {
                    permissions: 'no_force_captcha'
                }
            });
        }
    }
]