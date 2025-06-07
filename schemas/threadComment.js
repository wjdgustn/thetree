const mongoose = require('mongoose');
const crypto = require('crypto');

const docUtils = require('../utils/docUtils');
const globalUtils = require('../utils/global');
const { ThreadCommentTypes, NotificationTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    id: {
        type: Number,
        index: true,
        min: 1
    },
    thread: {
        type: String,
        required: true,
        index: true
    },
    type: {
        type: Number,
        required: true,
        default: ThreadCommentTypes.Default,
        min: Math.min(...Object.values(ThreadCommentTypes)),
        max: Math.max(...Object.values(ThreadCommentTypes))
    },
    user: {
        type: String,
        required: true
    },
    admin: {
        type: Boolean,
        required: true,
        default: false
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    content: {
        type: String,
        required: true
    },
    prevContent: {
        type: String
    },
    hidden: {
        type: Boolean,
        required: true,
        default: false
    },
    hiddenBy: {
        type: String
    }
});

newSchema.index({ thread: 1, id: 1 }, { unique: true });

const lastItem = {};
const lockPromise = {};
newSchema.pre('save', async function() {
    const locks = lockPromise[this.thread] ??= [];

    let last = lastItem[this.thread];
    lastItem[this.thread] = this;

    if(last && last.id == null) await globalUtils.waitUntil(new Promise(resolve => {
        locks.push(resolve);
    }), 5000);

    if (!last) last = await model.findOne({ thread: this.thread }).sort({ id: -1 });

    locks.forEach(r => r());
    delete lockPromise[this.thread];

    if(this.id == null) {
        this.id = last ? last.id + 1 : 1;
    }
});

newSchema.post('save', async function() {
    delete lastItem[this.id];

    mongoose.models.Thread.updateOne({
        uuid: this.thread
    }, {
        lastUpdateUser: this.user,
        lastUpdatedAt: this.createdAt
    }).then();

    const thread = await mongoose.models.Thread.findOne({
        uuid: this.thread
    });
    const dbDocument = await mongoose.models.Document.findOne({
        uuid: thread.document
    });
    if(!dbDocument) return;

    const parser = new global.NamumarkParser({
        document: dbDocument,
        aclData: {
            alwaysAllow: true
        },
        dbComment: this,
        thread: true,
        commentId: this.id
    });
    const { links } = await parser.parse(this.content);
    const mentions = links.filter(a => a.startsWith('사용자:')).map(a => a.slice(4));
    const users = await mongoose.models.User.find({
        name: {
            $in: mentions
        }
    });
    await Promise.all(users.filter(a => a).map(a => mongoose.models.Notification.create({
        type: NotificationTypes.Mention,
        user: a.uuid,
        data: this.uuid,
        thread: this.thread
    })));

    docUtils.checkMemberContribution(this.user).then();
});

const model = mongoose.model('ThreadComment', newSchema);

module.exports = model;