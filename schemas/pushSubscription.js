const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    user: {
        type: String,
        required: true,
        index: true
    },
    expiresAt: {
        type: Date
    },
    endpoint: {
        type: String,
        required: true,
        unique: true
    },
    p256dh: {
        type: String,
        required: true
    },
    auth: {
        type: String,
        required: true
    }
});

newSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PushSubscription', newSchema);