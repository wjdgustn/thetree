const mongoose = require('mongoose');
const crypto = require('crypto');

const { Schema } = mongoose;
const newSchema = new Schema({
    token: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: () => crypto.randomBytes(48).toString('base64')
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    namespace: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    baseuuid: {
        type: String,
        required: true
    },
    user: {
        type: String,
        required: true
    }
});

newSchema.index({
    createdAt: 1
}, {
    expireAfterSeconds: 60 * 60
});

module.exports = mongoose.model('EditToken', newSchema);