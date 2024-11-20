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
    name: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    forBlock: {
        type: Boolean,
        required: true,
        default: false
    },
    forLoginAllowedIP: {
        type: Boolean,
        required: true,
        default: false
    },
    forVPN: {
        type: Boolean,
        required: true,
        default: false
    },
    hiddenFromPublic: {
        type: Boolean,
        required: true,
        default: false
    },
    preventDelete: {
        type: Boolean,
        required: true,
        default: false
    },
    isWarn: {
        type: Boolean,
        required: true,
        default: false
    },
    warnMessage: {
        type: String
    }
});

module.exports = mongoose.model('ACLGroup', newSchema);