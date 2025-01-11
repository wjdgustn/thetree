const mongoose = require('mongoose');
const crypto = require('crypto');

const utils = require('../utils');
const { EditRequestStatusTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        unique: true,
        index: true
    },
    url: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: utils.generateUrl
    },
    document: {
        type: String,
        required: true,
        index: true
    },
    createdUser: {
        type: String,
        required: true
    },
    lastUpdateUser: {
        type: String
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    lastUpdatedAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    status: {
        type: Number,
        required: true,
        default: EditRequestStatusTypes.Open,
        min: Math.min(...Object.values(EditRequestStatusTypes)),
        max: Math.max(...Object.values(EditRequestStatusTypes))
    },
    closedReason: {
        type: String
    },
    content: {
        type: String,
        required: true
    },
    log: {
        type: String,
        maxLength: 255
    },
    baseUuid: {
        type: String,
        required: true
    },
    diffLength: {
        type: Number,
        required: true
    },
    acceptedRev: {
        type: String
    }
});

newSchema.index({ document: 1, createdUser: 1 }, {
    unique: true,
    partialFilterExpression: {
        status: EditRequestStatusTypes.Open
    }
});

newSchema.pre('updateOne', async function() {
    this._update.lastUpdatedAt = new Date();
});

newSchema.pre('findOneAndUpdate', async function() {
    const oldDoc = await this.model.findOne(this.getQuery());
    if(!oldDoc) this._update.uuid = crypto.randomUUID();
    this._update.lastUpdatedAt = new Date();
});

module.exports = mongoose.model('EditRequest', newSchema);