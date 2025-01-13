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
        index: true
    },
    email: {
        type: String,
        index: true
    },
    password: {
        type: String
    },
    name: {
        type: String,
        index: true
    },
    lastNameChange: {
        type: Date,
        default: Date.now
    },
    lastActivity: {
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
    },
    lastUserDocumentDiscuss: {
        type: Date
    }
});

newSchema.index({ name: 1 }, {
    unique: true,
    partialFilterExpression: {
        name: { $exists: true }
    }
});

newSchema.index({ ip: 1 }, {
    unique: true,
    partialFilterExpression: {
        ip: { $exists: true }
    }
});

newSchema.index({ user: 1 }, {
    unique: true,
    partialFilterExpression: {
        user: { $exists: true }
    }
});

module.exports = mongoose.model('User', newSchema);