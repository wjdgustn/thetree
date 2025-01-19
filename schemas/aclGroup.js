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
    userCSS: {
        type: String
    },
    accessPerms: {
        type: Array,
        required: true,
        default: []
    },
    addPerms: {
        type: Array,
        required: true,
        default: []
    },
    removePerms: {
        type: Array,
        required: true,
        default: []
    },
    deleteGroupPerms: {
        type: Array,
        required: true,
        default: []
    },
    aclMessage: {
        type: String
    },
    isWarn: {
        type: Boolean,
        required: true,
        default: false
    },
    noSignup: {
        type: Boolean,
        required: true,
        default: false
    }
});

module.exports = mongoose.model('ACLGroup', newSchema);