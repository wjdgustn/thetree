const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    comment: {
        type: String,
        required: true,
        index: true
    },
    voteIndex: {
        type: Number,
        required: true,
        index: true,
        min: 0
    },
    user: {
        type: String,
        required: true,
        index: true
    },
    value: {
        type: Number,
        required: true,
        min: 0
    }
});

newSchema.index({ comment: 1, voteIndex: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Vote', newSchema);