const mongoose = require('mongoose');
const crypto = require('crypto');

const { UserTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    type: {
        type: Number,
        required: true,
        index: true,
        default: UserTypes.Account,
        min: Math.min(...Object.values(UserTypes)),
        max: Math.max(...Object.values(UserTypes))
    },
    ip: {
        type: String,
        unique: true,
        index: true
    },
    email: {
        type: String,
        unique: true,
        index: true
    },
    password: {
        type: String
    },
    name: {
        type: String,
        unique: true,
        index: true
    },
    lastNameChange: {
        type: Date,
        default: Date.now
    },
    permissions: {
        type: Array,
        default: []
    },
    otpToken: {
        type: String
    },
    skin: {
        type: String,
        default: 'default'
    },
    apiToken: {
        type: String
    },
    emailPin: {
        type: String
    },
    totpToken: {
        type: String
    },
    lastLoginRequest: {
        type: Date
    }
});

module.exports = mongoose.model('User', newSchema);