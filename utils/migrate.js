const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const utils = require('./');
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
    },
    {
        timestamp: 1762954979464,
        code: async () => {
            console.log('starting gif to mp4 migration...');
            const revs = await History.find({
                fileKey: {
                    $regex: /\.gif$/
                },
                videoFileKey: {
                    $exists: false
                }
            });
            console.log(`found ${revs.length} gif revisions to migrate`);
            for(let rev of revs) {
                try {
                    const imgUrl = rev.fileKey && new URL((process.env.S3_PUBLIC_HOST_PREFIX ?? '') + rev.fileKey, process.env.S3_PUBLIC_HOST);
                    const { data } = await axios.get(imgUrl, {
                        responseType: 'arraybuffer'
                    });
                    let videoFileKey;
                    let videoFileSize;
                    let videoFileBuffer;

                    const checkOther = await History.findOne({
                        fileKey: rev.fileKey,
                        videoFileKey: { $exists: true }
                    });
                    if(checkOther) {
                        videoFileKey = checkOther.videoFileKey;
                        videoFileSize = checkOther.videoFileSize;
                    }
                    else {
                        videoFileBuffer = await utils.gifToMp4(data);
                        videoFileSize = videoFileBuffer.length;
                        const videoHash = crypto.createHash('sha256').update(videoFileBuffer).digest('hex');
                        videoFileKey = 'i/' + videoHash + '.mp4';
                    }

                    const dupCheck = await History.exists({
                        videoFileKey
                    });
                    if(!dupCheck) await S3.send(new PutObjectCommand({
                        Bucket: process.env.S3_BUCKET_NAME,
                        Key: videoFileKey,
                        Body: videoFileBuffer,
                        ContentType: 'video/mp4'
                    }));

                    rev.videoFileKey = videoFileKey;
                    rev.videoFileSize = videoFileSize;
                    await rev.save();
                    console.log(`migrated gif to mp4: ${rev.document}`);
                } catch(e) {
                    console.error(e);
                }
            }
        }
    }
]