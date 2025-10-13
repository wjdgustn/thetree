const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    user: {
        type: String,
        required: true
    },
    email: {
        type: String
    },
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    pin: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    tries: {
        type: Number,
        required: true,
        default: 0,
        min: 0
    }
});

newSchema.index({
    createdAt: 1
}, {
    expireAfterSeconds: 60 * 60 * 24
});

module.exports = mongoose.model('MobileVerifyInfo', newSchema);