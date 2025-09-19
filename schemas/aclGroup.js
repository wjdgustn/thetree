const mongoose = require('mongoose');
const crypto = require('crypto');

const { SignupPolicy} = require('../utils/types');

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
    managePerms: {
        type: Array,
        required: true,
        default: []
    },
    aclMessage: {
        type: String
    },
    withdrawPeriodHours: {
        type: Number,
        required: true,
        default: 0
    },
    signupPolicy: {
        type: Number,
        required: true,
        min: Math.min(...Object.values(SignupPolicy)),
        max: Math.max(...Object.values(SignupPolicy)),
        default: SignupPolicy.None
    },
    maxDuration: {
        type: Number,
        required: true,
        default: 0
    },
    maxDurationIp: {
        type: Number,
        required: true,
        default: 0
    },
    maxDurationAccount: {
        type: Number,
        required: true,
        default: 0
    },
    maxIpv4Cidr: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: 32
    },
    maxIpv6Cidr: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: 128
    },
    selfRemovable: {
        type: Boolean,
        required: true,
        default: false
    },
    selfRemoveNote: {
        type: String
    }
});

module.exports = mongoose.model('ACLGroup', newSchema);