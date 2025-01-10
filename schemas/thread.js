const mongoose = require('mongoose');
const crypto = require('crypto');
const { generateSlug } = require('random-word-slugs');

const { ThreadStatusTypes } = require('../utils/types');

const urlGenerator = () => generateSlug(4, {
    format: 'title'
}).replaceAll(' ', '');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    url: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: urlGenerator
    },
    document: {
        type: String,
        required: true,
        index: true
    },
    topic: {
        type: String,
        required: true
    },
    createdUser: {
        type: String,
        required: true
    },
    lastUpdateUser: {
        type: String,
        required: true
    },
    lastUpdatedAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    status: {
        type: Number,
        required: true,
        default: ThreadStatusTypes.Normal,
        min: Math.min(...Object.values(ThreadStatusTypes)),
        max: Math.max(...Object.values(ThreadStatusTypes))
    },
    deleted: {
        type: Boolean,
        required: true,
        default: false
    }
});

module.exports = mongoose.model('Thread', newSchema);