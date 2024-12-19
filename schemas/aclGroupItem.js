const mongoose = require('mongoose');
const crypto = require('crypto');
const { Address4, Address6 } = require('ip-address');

const globalUtils = require('../utils/global');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    aclGroup: {
        type: String,
        required: true,
        index: true
    },
    id: {
        type: Number,
        min: 1
    },
    user: {
        type: String,
        index: true
    },
    ip: {
        type: String,
        index: true,
        validate: {
            validator: v => Address4.isValid(v) || Address6.isValid(v),
            message: 'Invalid IP CIDR.'
        }
    },
    memo: {
        type: String
    },
    expiresAt: {
        type: Date
    },

    ipVersion: {
        type: Number,
        min: 4,
        max: 6
    },

    ipMin: {
        type: Array
    },
    ipMax: {
        type: Array
    }
});

newSchema.index({ aclGroup: 1, user: 1 }, {
    unique: true,
    partialFilterExpression: {
        user: { $exists: true }
    }
});
newSchema.index({ aclGroup: 1, ip: 1 }, {
    unique: true,
    partialFilterExpression: {
        ip: { $exists: true }
    }
});

newSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

let lastItem;
const locks = [];
newSchema.pre('save', async function() {
    if(this.id == null) {
        let last = lastItem;
        lastItem = this;

        if(last && last.id === null) await globalUtils.waitUntil(new Promise(resolve => {
            locks.push(resolve);
        }), 5000);

        if(!last) last = await model.findOne().sort({ id: -1 });
        this.id = last ? last.id + 1 : 1;

        locks.forEach(r => r());
    }

    if(this.ip !== null) {
        if(Address4.isValid(this.ip)) {
            this.ipVersion = 4;

            const ip = new Address4(this.ip);
            this.ipMin = ip.startAddress().toArray();
            this.ipMax = ip.endAddress().toArray();
        }
        else {
            this.ipVersion = 6;

            const ip = new Address6(this.ip);
            this.ipMin = ip.startAddress().toByteArray();
            this.ipMax = ip.endAddress().toByteArray();
        }
    }
});

const model = mongoose.model('ACLGroupItem', newSchema);

module.exports = model;