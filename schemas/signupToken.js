const mongoose = require('mongoose');
const randomstring = require('randomstring');

const { Schema } = mongoose;
const newSchema = new Schema({
    token: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: () => randomstring.generate({
            charset: 'hex',
            length: 64
        })
    },
    email: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    ip: {
        type: String,
        index: true
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    name: {
        type: String
    }
});

newSchema.index({
    createdAt: 1
}, {
    expireAfterSeconds: 60 * 60 * 24
});
newSchema.index({
    ip: 1
}, {
    unique: true,
    partialFilterExpression: {
        ip: { $exists: true }
    }
});

module.exports = mongoose.model('SignupToken', newSchema);