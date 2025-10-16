const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    phone: {
        type: String
    },
    expiresAt: {
        type: Date
    }
});

newSchema.index({
    expiresAt: 1
}, {
    expireAfterSeconds: 0
});

module.exports = mongoose.model('Blacklist', newSchema);