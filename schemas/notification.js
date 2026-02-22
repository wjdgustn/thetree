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

        const $t = i18next.getFixedT(config.lang);
        const defaultOptions = {
            interpolation: {
                prefix: '{',
                suffix: '}'
            }
        }

        let title = `[${config.site_name ?? $t('notification.site_name_placeholder')}] `;
        let body;
        switch(item.type) {
            case NotificationTypes.UserDiscuss:
                title += $t('notification.user_discuss', {
                    ...defaultOptions,
                    user: item.comment.user.name,
                    topic: item.thread.topic,
                    id: item.comment.id
                });
                body = globalUtils.removeHtmlTags(item.comment.contentHtml);
                break;
            case NotificationTypes.Mention:
                title += $t('notification.mention', {
                    ...defaultOptions,
                    user: item.comment.user.name,
                    topic: item.thread.topic,
                    id: item.comment.id
                });
                body = globalUtils.removeHtmlTags(item.comment.contentHtml);
                break;
            default:
                title += $t('notification.default');
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