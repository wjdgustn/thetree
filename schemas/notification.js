const mongoose = require('mongoose');
const crypto = require('crypto');

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

module.exports = mongoose.model('Notification', newSchema);