const mongoose = require('mongoose');
const crypto = require('crypto');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true
    },
    token: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: () => crypto.randomBytes(96).toString('base64url')
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    }
});

module.exports = mongoose.model('AutoLoginToken', newSchema);