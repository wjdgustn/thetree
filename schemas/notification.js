const mongoose = require('mongoose');
const crypto = require('crypto');
const webpush = require('web-push');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const { NotificationTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    user: {
        type: String,
        required: true,
        index: true
    },
    type: {
        type: Number,
        required: true,
        min: Math.min(...Object.values(NotificationTypes)),
        max: Math.max(...Object.values(NotificationTypes))
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    read: {
        type: Boolean,
        required: true,
        default: false,
        index: true
    },
    data: {
        type: String,
        required: true,
        index: true
    },
    thread: {
        type: String,
        index: true
    }
});

let didSetup = false;
newSchema.post('save', function() {
    const notification = this.toJSON();

    setTimeout(async () => {
        if(!didSetup) {
            const vapidKeys = await mongoose.models.ServerKeyValue.findOne({ key: 'vapidKeys' });
            if(vapidKeys) {
                webpush.setVapidDetails(
                    config.base_url.startsWith('https://') ? config.base_url : `https://example.com`,
                    vapidKeys.value.publicKey,
                    vapidKeys.value.privateKey
                );
                didSetup = true;
            }
            else return;
        }

        const [item] = await utils.notificationMapper({ permissions: [] }, [notification]);

        let title = `[${config.site_name ?? '위키'}] `;
        let body;
        switch(item.type) {
            case NotificationTypes.UserDiscuss:
                title += `${item.comment.user.name} 사용자가 ${item.thread.topic} #${item.comment.id} 사용자 토론 댓글 작성`;
                body = globalUtils.removeHtmlTags(item.comment.contentHtml);
                break;
            case NotificationTypes.Mention:
                title += `${item.comment.user.name} 사용자가 ${item.thread.topic} #${item.comment.id} 댓글에서 호출`;
                body = globalUtils.removeHtmlTags(item.comment.contentHtml);
                break;
            default:
                title += '알림';
                body = globalUtils.removeHtmlTags(item.data);
                break;
        }

        const subscriptions = await mongoose.models.PushSubscription.find({ user: item.user });
        await Promise.allSettled(subscriptions.map(async sub => {
            try {
                await webpush.sendNotification({
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth
                    }
                }, JSON.stringify({
                    type: 'notification',
                    notification: {
                        title,
                        options: {
                            body,
                            icon: '/favicon.ico',
                            data: {
                                url: item.url ?? undefined
                            }
                        }
                    }
                }));
            } catch(e) {
                await mongoose.models.PushSubscription.deleteOne({ _id: sub._id });
            }
        }));
    }, 0);
});

module.exports = mongoose.model('Notification', newSchema);