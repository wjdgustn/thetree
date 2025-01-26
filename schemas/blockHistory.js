const mongoose = require('mongoose');
const crypto = require('crypto');

const { BlockHistoryTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    createdUser: {
        type: String,
        required: true
    },
    type: {
        type: Number,
        required: true,
        min: Math.min(...Object.values(BlockHistoryTypes)),
        max: Math.max(...Object.values(BlockHistoryTypes))
    },
    targetUser: {
        type: String
    },
    targetUsername: {
        type: String
    },
    targetContent: {
        type: String
    },
    aclGroup: {
        type: String
    },
    aclGroupId: {
        type: Number
    },
    aclGroupName: {
        type: String
    },
    duration: {
        type: Number
    },
    content: {
        type: String
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    hideLog: {
        type: Boolean,
        required: true,
        default: false
    }
});

module.exports = mongoose.model('BlockHistory', newSchema);