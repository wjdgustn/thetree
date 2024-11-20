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
        type: String,
        maxLength: 255
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

newSchema.index({ document: 1, rev: 1 }, { unique: true });

newSchema.pre('save', async function() {
    const last = await model.findOne({ document: this.document }).sort({ rev: -1 });

    if(this.rev == null) {
        this.rev = last ? last.rev + 1 : 1;
    }

    if(this.content == null) {
        this.content = last ? last.content : null;
    }
    else if(this.diffLength == null) {
        this.diffLength = last ? this.content.length - last.content.length : this.content.length;
    }
});

const model = mongoose.model('History', newSchema);

module.exports = model;