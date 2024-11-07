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
            charset: 'hex'
        })
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    ip: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    }
});

newSchema.index({
    createdAt: 1
}, {
    expireAfterSeconds: 60 * 60 * 24
});

module.exports = mongoose.model('SignupToken', newSchema);