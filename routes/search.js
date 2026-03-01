const express = require('express');

const utils = require('../utils');
const namumarkUtils = require('../utils/namumark/utils');
const globalUtils = require('../utils/global');
const { ACLTypes } = require('../utils/types');

const Document = require('../schemas/document');

const ACL = require('../class/acl');

const app = express.Router();

app.get('/Complete', async (req, res) => {
    if(!req.get('Referer')) return res.error(req.t('errors.invalid_request'));

    if(!req.query.q) return res.status(400).json({
        error: 'missing query'
    });

    if(!global.documentIndex) return res.json([]);

    const document = utils.parseDocumentName(req.query.q, true);

    const filter = [];
    if(!req.permissions.includes('developer')) filter.push('anyoneReadable = true');
    if(document.namespaceExists) filter.push(`namespace = '${document.namespace}'`);
    else filter.push(`namespace = 문서`);

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
    if(!req.query.q) return res.error('missing_query');

    const document = utils.parseDocumentName(req.query.q);
    const upperTitle = document.title.toUpperCase();
    const noSpaceUpperTitle = upperTitle.replaceAll(' ', '');
    const docs = await Document.find({
        contentExists: true,
        namespace: document.namespace,
        noSpaceUpperTitle
    });
    const dbDocument = docs.find(a => a.title === document.title)
        || docs.find(a => a.upperTitle === upperTitle)
        || docs.find(a => a.noSpaceUpperTitle === noSpaceUpperTitle)
        || docs[0];
    if(!dbDocument) return res.redirect(`/Search?q=${encodeURIComponent(req.query.q)}`);

    res.redirect(globalUtils.doc_action_link({
        ...document,
        title: dbDocument.title
    }, 'w'));
});

const getSearch = async (req, res) => {
    if(!global.documentIndex) return res.error(req.t('routes.search.errors.search_engine_disabled'));

    if(!req.query.q) return res.error('missing_query');

    // const readableNamespaces = await utils.getReadableNamespaces(req.aclData);
    const readableNamespaces = config.namespaces.filter(a => req.permissions.includes('developer') || !(config.hidden_namespaces ?? []).includes(a));
    if(!readableNamespaces.length) return res.error(req.t('routes.search.errors.no_readable_namespace'));

    const filter = [];
    const attributesToRetrieve = ['namespace', 'title'];
    const attributesToSearchOn = [];
    const attributesToCrop = [];

    if(req.query.namespace && readableNamespaces.includes(req.query.namespace))
        filter.push(`namespace = '${req.query.namespace}'`);
    else
        filter.push(readableNamespaces.map(a => `namespace = '${a}'`));

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
        highlightPreTag: '',
        highlightPostTag: '',
        showMatchesPosition: true,
        attributesToCrop,
        cropLength: 64
    });

    result.hits = result.hits.map(a => {
        for(let key of ['raw']) {
            const prevStr = a._formatted[key];
            if(!prevStr) continue;
            a._formatted[key] = namumarkUtils.escapeHtml(prevStr);

            const matchesPosition = a._matchesPosition[key] ?? [];
            for(let pos of matchesPosition.reverse()) {
                const frontPrev = prevStr.slice(0, pos.start);
                const frontNew = namumarkUtils.escapeHtml(frontPrev);
                const frontExtendedLen = frontNew.length - frontPrev.length;

                const backPrev = prevStr.slice(pos.start + pos.length);
                const backNew = namumarkUtils.escapeHtml(backPrev);
                const backExtendedLen = backNew.length - backPrev.length;

                a._formatted[key] = utils.insertText(a._formatted[key], pos.start + backExtendedLen + pos.length, '</span>');
                a._formatted[key] = utils.insertText(a._formatted[key], pos.start + frontExtendedLen, '<span class="search-highlight">');
            }
        }
        return a;
    });

    res.renderSkin('search', {
        contentName: 'search',
        serverData: {
            query: req.query.q,
            readableNamespaces,
            hits: result.hits.map(a => ({
                ...a._formatted,
                ...utils.dbDocumentToDocument(a._formatted)
            })),
            totalHits: result.totalHits,
            totalPages: result.totalPages,
            processingTime: result.processingTimeMs
        }
    });
}
module.exports.getSearch = getSearch;

app.get('/Search', getSearch);

module.exports.router = app;