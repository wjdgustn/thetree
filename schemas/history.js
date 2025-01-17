const mongoose = require('mongoose');
const crypto = require('crypto');

const docUtils = require('../utils/docUtils');
const globalUtils = require('../utils/global');
const { HistoryTypes } = require('../utils/types');

const { Schema } = mongoose;
const newSchema = new Schema({
    namespace: {
        type: String,
        index: true
    },
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    user: {
        type: String,
        required: true,
        index: true
    },
    rev: {
        type: Number,
        index: true,
        min: 1
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    type: {
        type: Number,
        required: true,
        min: Math.min(...Object.values(HistoryTypes)),
        max: Math.max(...Object.values(HistoryTypes))
    },
    document: {
        type: String,
        required: true,
        index: true
    },
    latest: {
        type: Boolean,
        required: true,
        default: true
    },
    content: {
        type: String
    },
    fileKey: {
        type: String
    },
    fileSize: {
        type: Number
    },
    fileWidth: {
        type: Number
    },
    fileHeight: {
        type: Number
    },
    diffLength: {
        type: Number
    },
    contentLength: {
        type: Number
    },
    log: {
        type: String,
        maxLength: 255
    },
    revertRev: {
        type: Number,
        min: 1
    },
    revertUuid: {
        type: String
    },
    moveOldDoc: {
        type: String
    },
    moveNewDoc: {
        type: String
    },
    editRequest: {
        type: String
    },
    troll: {
        type: Boolean,
        required: true,
        default: false
    },
    trollBy: {
        type: String
    },
    hideLog: {
        type: Boolean,
        required: true,
        default: false
    },
    hideLogBy: {
        type: String
    },
    hidden: {
        type: Boolean,
        required: true,
        default: false
    },
    blame: {
        type: Array
    },
    migrated: {
        type: Boolean
    },
    redirect: {
        type: Boolean
    }
});

newSchema.index({ document: 1, rev: 1 }, { unique: true });

const lastItem = {};
const lockPromise = {};
newSchema.pre('save', async function() {
    const locks = lockPromise[this.document] ??= [];

    let last = lastItem[this.document];
    lastItem[this.document] = this;

    if(last && last.rev == null) await globalUtils.waitUntil(new Promise(resolve => {
        locks.push(resolve);
    }), 5000);

    if(!last) last = await model.findOne({ document: this.document }).sort({ rev: -1 });

    locks.forEach(r => r());

    if(this.rev == null) {
        this.rev = last ? last.rev + 1 : 1;
    }

    if(this.content == null && this.type !== HistoryTypes.Delete) {
        this.content = last ? last.content : null;
    }
    else if(this.diffLength == null) {
        this.diffLength = last ? (this.content?.length || 0) - (last.content?.length || 0) : (this.content?.length || 0);
    }

    if(this.fileKey == null && last?.fileKey) {
        this.fileKey = last.fileKey;
        this.fileSize = last.fileSize;
        this.fileWidth = last.fileWidth;
        this.fileHeight = last.fileHeight;
    }

    if([
        HistoryTypes.Create,
        HistoryTypes.Modify,
        HistoryTypes.Revert,
        HistoryTypes.Delete
    ].includes(this.type)) {
        this.blame = docUtils.generateBlame(last, this);
    }
    else this.blame = last ? last.blame : [];

    this.redirect = this.content?.startsWith('#redirect ');
    this.contentLength = this.content?.length || 0;
});

newSchema.post('save', function() {
    delete lastItem[this.document];

    if(!this.migrated) docUtils.postHistorySave(this).then();
});

const model = mongoose.model('History', newSchema);

module.exports = model;