const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    ip: {
        type: String,
        required: true
    },
    user: {
        type: String
    },
    method: {
        type: String,
        required: true
    },
    url: {
        type: String,
        required: true
    },
    body: {
        type: Object
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    error: {
        type: String
    }
});

newSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

module.exports = mongoose.model('RequestLog', newSchema);