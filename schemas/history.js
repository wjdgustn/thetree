const mongoose = require('mongoose');
const crypto = require('crypto');

const { HistoryTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    user: {
        type: String,
        required: true,
        index: true
    },
    rev: {
        type: Number,
        index: true,
        min: 1
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    type: {
        type: Number,
        required: true,
        min: Math.min(...Object.values(HistoryTypes)),
        max: Math.max(...Object.values(HistoryTypes))
    },
    document: {
        type: String,
        required: true,
        index: true
    },
    content: {
        type: String
    },
    diffLength: {
        type: Number
    },
    log: {
        type: String
    },
    editRequest: {
        type: String
    },
    troll: {
        type: Boolean,
        required: true,
        default: false
    },
    hideLog: {
        type: Boolean,
        required: true,
        default: false
    },
    hidden: {
        type: Boolean,
        required: true,
        default: false
    }
});

const model = mongoose.model('History', newSchema);

newSchema.pre('save', async function() {
    if(this.rev == null) {
        const last = await model.findOne({ document: this.document }).sort({ rev: -1 });
        this.rev = last ? last.rev + 1 : 1;
    }
});

newSchema.index({ document: 1, rev: 1 }, { unique: true });

module.exports = model;