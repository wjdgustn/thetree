const mongoose = require('mongoose');
const uuid = require('uuid').v4;

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: uuid
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    email: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    password: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    lastNameChange: {
        type: Date,
        required: true,
        default: Date.now
    },
    permissions: {
        type: Array,
        required: true,
        default: []
    },
    otpToken: {
        type: String
    },
    skin: {
        type: String,
        required: true,
        default: 'default'
    },
    apiToken: {
        type: String
    },
    emailPin: {
        type: String
    },
    totpToken: {
        type: String
    },
    lastLoginRequest: {
        type: Date
    }
});

module.exports = mongoose.model('User', newSchema);