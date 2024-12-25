const express = require('express');

const utils = require('../utils');
const {
    HistoryTypes
} = require('../utils/types');

const History = require('../schemas/history');

const app = express.Router();

app.get('/RecentChanges', async (req, res) => {
    const logType = {
        create: HistoryTypes.Create,
        delete: HistoryTypes.Delete,
        move: HistoryTypes.Move,
        revert: HistoryTypes.Revert
    }[req.query.logtype];

    let revs = await History.find({
        ...(logType != null ? { type: logType } : {})
    })
        .sort({ _id: -1 })
        .limit(100)
        .lean();

    revs = await utils.findUsers(revs);
    revs = await utils.findDocuments(revs);

    res.renderSkin('최근 변경내역', {
        contentName: 'recentChanges',
        serverData: {
            revs,
            logType: logType != null ? req.query.logtype : 'all'
        }
    });
});

module.exports = app;