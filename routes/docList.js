const express = require('express');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const {

} = require('../utils/types');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const History = require('../schemas/history');

const app = express.Router();

const noRedirectQuery = {
    $or: [
        { backlinks: { $not: { $elemMatch: { flags: 8 } } } }
    ]
};

app.get('/UncategorizedPages', async (req, res) => {
    const namespace = config.namespaces.includes(req.query.namespace) ? req.query.namespace : '문서';
    const baseQuery = {
        namespace,
        categories: { $size: 0 },
        ...noRedirectQuery,
        contentExists: true
    }
    const serverData = await utils.pagination(req, Document, baseQuery, 'uuid', 'upperTitle');

    for(let item of serverData.items)
        item.parsedName = utils.dbDocumentToDocument(item);

    res.renderSkin('분류가 되지 않은 문서', {
        contentName: 'docList/UncategorizedPages',
        serverData
    });
});

app.get('/OldPages', async (req, res) => {
    const baseQuery = {
        namespace: '문서',
        redirect: false,
        content: { $exists: true },
        latest: true
    }
    const serverData = await utils.pagination(req, History, baseQuery, 'uuid', 'createdAt', {
        sortDirection: 1,
        limit: 5
    });
    serverData.items = await utils.findDocuments(serverData.items);

    if(serverData.prevItem) serverData.prevItem.document = await Document.findOne({ uuid: serverData.prevItem.document });
    if(serverData.nextItem) serverData.nextItem.document = await Document.findOne({ uuid: serverData.nextItem.document });

    res.renderSkin('편집된 지 오래된 문서', {
        contentName: 'docList/OldPages',
        serverData
    });
});

const contentLengthHandler = shortest => async (req, res) => {
    const baseQuery = {
        namespace: '문서',
        redirect: false,
        content: { $exists: true },
        latest: true
    }
    const serverData = await utils.pagination(req, History, baseQuery, 'uuid', 'contentLength', {
        sortDirection: shortest ? 1 : -1,
        limit: 5
    });
    serverData.items = await utils.findDocuments(serverData.items);

    if(serverData.prevItem) serverData.prevItem.document = await Document.findOne({ uuid: serverData.prevItem.document });
    if(serverData.nextItem) serverData.nextItem.document = await Document.findOne({ uuid: serverData.nextItem.document });

    res.renderSkin(`내용이 ${shortest ? '짧은' : '긴'} 문서`, {
        contentName: 'docList/ContentLength',
        serverData
    });
}

app.get('/ShortestPages', contentLengthHandler(true));
app.get('/LongestPages', contentLengthHandler(false));

module.exports = app;