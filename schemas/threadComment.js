const mongoose = require('mongoose');
const crypto = require('crypto');

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

module.exports = mongoose.model('ThreadComment', newSchema);