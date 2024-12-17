const mongoose = require('mongoose');
const crypto = require('crypto');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    namespace: {
        type: String,
        required: true,
        index: true,
        default: '문서'
    },
    title: {
        type: String,
        required: true,
        index: true
    }
});

newSchema.index({ namespace: 1, title: 1 }, { unique: true });

module.exports = mongoose.model('Document', newSchema);