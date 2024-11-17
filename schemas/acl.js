const mongoose = require('mongoose');
const crypto = require('crypto');

const { ACLTypes, ACLConditionTypes, ACLActionTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    document: {
        type: String,
        index: true
    },
    namespace: {
        type: String,
        index: true
    },
    type: {
        type: Number,
        required: true,
        default: ACLTypes.None,
        min: Math.min(Object.values(ACLTypes)),
        max: Math.max(Object.values(ACLTypes))
    },
    order: {
        type: Number,
        required: true,
        min: 0
    },
    conditionType: {
        type: Number,
        required: true,
        min: Math.min(Object.values(ACLConditionTypes)),
        max: Math.max(Object.values(ACLConditionTypes))
    },
    conditionContent: {
        type: String,
        required: true
    },
    actionType: {
        type: Number,
        required: true,
        min: Math.min(Object.values(ACLActionTypes)),
        max: Math.max(Object.values(ACLActionTypes))
    },
    actionContent: {
        type: String
    },
    expiresAt: {
        type: Date
    }
});

newSchema.index({ document: 1, type: 1 }, {
    unique: true,
    partialFilterExpression: {
        document: { $exists: true }
    }
});
newSchema.index({ namespace: 1, type: 1 }, {
    unique: true,
    partialFilterExpression: {
        namespace: { $exists: true }
    }
});

newSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

newSchema.pre('save', async function() {
    if(this.order == null) {
        let query = {};
        if(this.document) query.document = this.document;
        else if(this.namespace) query.namespace = this.namespace;

        const last = await model.findOne({
            ...query,
            type: this.type
        }).sort({ order: -1 });
        this.order = last ? last.order + 1 : 0;
    }
});

const model = mongoose.model('ACL', newSchema);

module.exports = model;