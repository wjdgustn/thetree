const mongoose = require('mongoose');

const { Schema } = mongoose;
const newSchema = new Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    value: {
        type: Object,
        required: true
    }
});

module.exports = mongoose.model('ServerKeyValue', newSchema);