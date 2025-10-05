const mongoose = require('mongoose');

const { AuditLogTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    user: {
        type: String,
        required: true
    },
    action: {
        type: Number,
        required: true,
        min: Math.min(...Object.values(AuditLogTypes)),
        max: Math.max(...Object.values(AuditLogTypes))
    },
    target: {
        type: String
    },
    targetUser: {
        type: String
    },
    content: {
        type: String
    },
    diffOld: {
        type: String
    },
    diffNew: {
        type: String
    },
    devOnly: {
        type: Boolean,
        required: true,
        default: false
    }
});

module.exports = mongoose.model('AuditLog', newSchema);