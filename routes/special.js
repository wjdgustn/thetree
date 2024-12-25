const express = require('express');
const fs = require('fs');
const { execSync } = require('child_process');

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

let commitId;
let skinCommitId = {};
let openSourceLicense;
app.get('/License', (req, res) => {
    let skin = req.user?.skin;
    if(!skin || skin === 'default') skin = config.default_skin;

    commitId ??= execSync('git rev-parse HEAD').toString().trim().slice(0, 7);
    skinCommitId[skin] ??= execSync('git rev-parse HEAD', {
        cwd: `./skins/${skin}`
    }).toString().trim().slice(0, 7);

    openSourceLicense ??= fs.readFileSync('./OPEN_SOURCE_LICENSE.txt').toString();

    res.renderSkin('라이선스', {
        viewName: 'license',
        contentName: 'license',
        serverData: {
            commitId,
            skinCommitId: skinCommitId[skin],
            openSourceLicense
        }
    });
});

module.exports = app;