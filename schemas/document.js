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

module.exports = mongoose.model('Document', newSchema);