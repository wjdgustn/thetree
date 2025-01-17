const express = require('express');
const fs = require('fs');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const {

} = require('../utils/types');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const History = require('../schemas/history');

const app = express.Router();

app.get('/UncategorizedPages', async (req, res) => {
    const namespace = config.namespaces.includes(req.query.namespace) ? req.query.namespace : '문서';
    const baseQuery = {
        namespace,
        categories: { $size: 0 },
        $or: [
            { backlinks: { $not: { $elemMatch: { flags: 8 } } } }
        ],
        contentExists: true
    }
    const data = await utils.pagination(req, Document, baseQuery, 'uuid', 'upperTitle');

    for(let item of data.items)
        item.parsedName = utils.dbDocumentToDocument(item);

    res.renderSkin('분류가 되지 않은 문서', {
        contentName: 'docList/UncategorizedPages',
        serverData: data
    });
});

module.exports = app;