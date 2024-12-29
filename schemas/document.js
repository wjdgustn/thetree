const mongoose = require('mongoose');
const crypto = require('crypto');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    namespace: {
        type: String,
        required: true,
        index: true,
        default: '문서'
    },
    title: {
        type: String,
        required: true,
        index: true
    },
    upperTitle: {
        type: String,
        index: true
    },
    contentExists: {
        type: Boolean,
        required: true,
        default: false
    },
    lastReadACL: {
        type: Number,
        required: true,
        default: -1
    },
    updatedAt: {
        type: Date,
        required: true,
        default: Date.now
    },

    backlinks: [{
        docName: {
            type: String,
            required: true
        },
        flags: {
            type: Array,
            required: true,
            default: []
        }
    }],
    categories: {
        type: Array,
        default: []
    },

    isFileLicense: {
        type: Boolean
    },
    isFileCategory: {
        type: Boolean
    }
});

newSchema.index({ namespace: 1, title: 1 }, { unique: true });

const validate = (doc, oldDoc) => {
    if(doc.title) {
        doc.upperTitle = doc.title.toUpperCase();

        const namespace = doc.namespace || oldDoc?.namespace;
        if(namespace === '틀'
            && doc.title.startsWith('이미지 라이선스/')
            && doc.title.length > '이미지 라이선스/'.length) {
            doc.isFileLicense = true;
        } else if(doc.isFileLicense || oldDoc?.isFileLicense) doc.isFileLicense = false;

        if(namespace === '분류'
            && doc.title.startsWith('파일/')
            && doc.title.length > '파일/'.length) {
            doc.isFileCategory = true;
        } else if(doc.isFileCategory || oldDoc?.isFileCategory) doc.isFileCategory = false;
    }

    doc.updatedAt = new Date();
}

newSchema.pre('save', function() {
    validate(this);
});

newSchema.pre('updateOne', async function() {
    const oldDoc = await this.model.findOne(this.getQuery());
    validate(this._update, oldDoc);
});

module.exports = mongoose.model('Document', newSchema);