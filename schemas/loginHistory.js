const mongoose = require('mongoose');

const { LoginHistoryTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    type: {
        type: Number,
        required: true,
        min: Math.min(...Object.values(LoginHistoryTypes)),
        max: Math.max(...Object.values(LoginHistoryTypes)),
        default: LoginHistoryTypes.Login
    },
    uuid: {
        type: String,
        required: true
    },
    ip: {
        type: String,
        required: true
    },
    device: {
        type: String
    },
    userAgent: {
        type: String
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    }
});

module.exports = mongoose.model('LoginHistory', newSchema);