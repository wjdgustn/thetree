const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true
    },
    ip: {
        type: String,
        required: true
    },
    userAgent: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    trusted: {
        type: Boolean,
        required: true,
        default: false
    }
});

module.exports = mongoose.model('LoginHistory', newSchema);