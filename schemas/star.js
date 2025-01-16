const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    document: {
        type: String,
        required: true,
        index: true
    },
    user: {
        type: String,
        required: true,
        index: true
    }
});

newSchema.index({ document: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Star', newSchema);