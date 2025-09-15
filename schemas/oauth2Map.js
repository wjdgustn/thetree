const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    user: {
        type: String,
        required: true
    },
    provider: {
        type: String,
        required: true
    },
    sub: {
        type: String,
        required: true,
        index: true
    },

    name: {
        type: String
    },
    email: {
        type: String
    }
});

newSchema.index({ user: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('OAuth2Map', newSchema);