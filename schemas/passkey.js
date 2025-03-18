const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    user: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    lastUsedAt: {
        type: Date
    },
    id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    publicKey: {
        type: Buffer,
        required: true
    },
    counter: {
        type: Number,
        required: true
    },
    transports: {
        type: Array,
        required: true
    },
    deviceType: {
        type: String,
        required: true
    },
    backedUp: {
        type: Boolean,
        required: true
    }
});

newSchema.index({ user: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Passkey', newSchema);