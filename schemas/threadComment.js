const mongoose = require('mongoose');
const crypto = require('crypto');

const globalUtils = require("../utils/global");
const { ThreadCommentTypes } = require('../utils/types');

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
    const locks = lockPromise[this.id] ??= [];

    let last = lastItem[this.id];
    lastItem[this.id] = this;

    if(last && last.id == null) await globalUtils.waitUntil(new Promise(resolve => {
        locks.push(resolve);
    }), 5000);

    if (!last) last = await model.findOne({ thread: this.id }).sort({ id: -1 });

    locks.forEach(r => r());

    if(this.id == null) {
        this.id = last ? last.id + 1 : 1;
    }
});

newSchema.post('save', function() {
    delete lastItem[this.id];
});

const model = mongoose.model('ThreadComment', newSchema);

module.exports = model;