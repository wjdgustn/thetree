const express = require('express');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const { ACLTypes } = require('../utils/types');

const Document = require('../schemas/document');

const ACL = require('../class/acl');

const app = express.Router();

app.get('/Complete', async (req, res) => {
    if(!req.get('Referer')) return res.error('잘못된 요청입니다.');

    if(!req.query.q) return res.status(400).json({
        error: 'missing query'
    });

    const document = utils.parseDocumentName(req.query.q);

    const filter = ['anyoneReadable = true'];
    if(document.namespaceExists) filter.push(`namespace = ${document.namespace}`);

    const result = await documentIndex.search(document.title, {
        limit: 10,
        filter,
        attributesToRetrieve: ['namespace', 'title'],
        attributesToSearchOn: ['title', 'choseong']
    });

    const completes = result.hits.map(a => globalUtils.doc_fulltitle(utils.dbDocumentToDocument(a)));
    return res.json(completes);
});

app.get('/Go', async (req, res) => {
    if(!req.query.q) return res.error('검색어가 없습니다.');

    const document = utils.parseDocumentName(req.query.q);
    const docs = await Document.find({
        namespace: document.namespace,
        upperTitle: document.title.toUpperCase()
    });
    const dbDocument = docs.find(a => a.title === document.title) || docs[0];
    if(!dbDocument) return res.redirect(`/Search?q=${encodeURIComponent(req.query.q)}`);

    res.redirect(globalUtils.doc_action_link({
        ...document,
        title: dbDocument.title
    }, 'w'));
});

app.get('/Search', async (req, res) => {
    if(!req.query.q) return res.error('검색어가 없습니다.');

    const readableNamespaces = [];
    for(let namespace of config.namespaces) {
        const acl = await ACL.get({
            namespace
        });
        const { result: readable } = await acl.check(ACLTypes.Read, req.aclData);
        if(readable) readableNamespaces.push(namespace);
    }
    if(!readableNamespaces.length) return res.error('읽을 수 있는 이름공간이 없습니다.');

    const filter = [];
    const attributesToRetrieve = ['namespace', 'title'];
    const attributesToSearchOn = [];
    const attributesToCrop = [];

    if(req.query.namespace && readableNamespaces.includes(req.query.namespace))
        filter.push(`namespace = ${req.query.namespace}`);
    else
        filter.push(readableNamespaces.map(a => `namespace = ${a}`));

    switch(req.query.target || 'title_content') {
        case 'title_content':
            attributesToSearchOn.push('title', 'content');
            attributesToRetrieve.push('content');
            attributesToCrop.push('content');
            break;
        case 'title':
            attributesToSearchOn.push('title');
            attributesToRetrieve.push('content');
            attributesToCrop.push('content');
            break;
        case 'content':
            attributesToSearchOn.push('content');
            attributesToRetrieve.push('content');
            attributesToCrop.push('content');
            break;
        case 'raw':
            attributesToSearchOn.push('raw');
            attributesToRetrieve.push('raw');
            attributesToCrop.push('raw');
            break;
    }

    const page = parseInt(req.query.page) || 1;

    const result = await documentIndex.search(req.query.q, {
        hitsPerPage: 20,
        page,
        filter,
        attributesToRetrieve,
        attributesToSearchOn,
        attributesToHighlight: attributesToCrop,
        highlightPreTag: '<span class="search-highlight">',
        highlightPostTag: '</span>',
        attributesToCrop,
        cropLength: 64
    });

    res.renderSkin('검색', {
        contentName: 'search',
        serverData: {
            readableNamespaces,
            hits: result.hits.map(a => a._formatted),
            totalHits: result.totalHits,
            totalPages: result.totalPages,
            processingTime: result.processingTimeMs
        }
    });
});

module.exports = app;