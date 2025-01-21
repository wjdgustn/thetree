const express = require('express');
const fs = require('fs');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const middleware = require('../utils/middleware');
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
        sortDirection: 1
    });
    serverData.items = await utils.findDocuments(serverData.items);

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
        sortDirection: shortest ? 1 : -1
    });
    serverData.items = await utils.findDocuments(serverData.items);

    res.renderSkin(`내용이 ${shortest ? '짧은' : '긴'} 문서`, {
        contentName: 'docList/ContentLength',
        serverData
    });
}

app.get('/ShortestPages', contentLengthHandler(true));
app.get('/LongestPages', contentLengthHandler(false));

let neededPages = fs.existsSync('./cache/neededPages.json') ? JSON.parse(fs.readFileSync('./cache/neededPages.json').toString()) : {};
let orphanedPages = fs.existsSync('./cache/orphanedPages.json') ? JSON.parse(fs.readFileSync('./cache/orphanedPages.json').toString()) : {};

const updateNeededPages = async () => {
    const newNeededPages = {};
    for(let namespace of config.namespaces) newNeededPages[namespace] = [];

    const allDocuments = await Document.find().lean();
    const allBacklinks = allDocuments.flatMap(a => a.backlinks.map(b => b.docName));

    for(let docName of allBacklinks) {
        const parsedName = utils.parseDocumentName(docName);
        const doc = allDocuments.find(a => a.namespace === parsedName.namespace && a.title === parsedName.title && a.contentExists);
        const arr = newNeededPages[parsedName.namespace];
        if(!doc && !arr.includes(docName)) arr.push(docName);
    }

    for(let arr of Object.values(newNeededPages)) arr.sort(Intl.Collator('en').compare);

    neededPages = newNeededPages;
    fs.writeFileSync('./cache/neededPages.json', JSON.stringify(neededPages));
}

const updateOrphanedPages = async () => {
    const newOrphanedPages = {};
    for(let namespace of config.namespaces) newOrphanedPages[namespace] = [];

    const allDocuments = await Document.find({
        contentExists: true,
        ...noRedirectQuery
    }).lean();
    const notOrphaned = [];

    const frontPageName = utils.parseDocumentName(config.front_page);
    const checkDocs = [allDocuments.find(a => a.namespace === frontPageName.namespace && a.title === frontPageName.title)];
    while(true) {
        const currDoc = checkDocs.shift();
        if(!currDoc) break;
        notOrphaned.push(currDoc);

        const links = [
            ...currDoc.backlinks.map(a => a.docName),
            ...currDoc.categories.map(a => `분류:${a}`)
        ];
        if(currDoc.namespace === '분류') {
            const categoryDocs = allDocuments.filter(a => a.categories.some(b => b.document === currDoc.title));
            links.push(...categoryDocs.map(a => `분류:${a.title}`));
        }
        const parsedLinks = links.map(a => utils.parseDocumentName(a));
        const uncheckedParsedLinks = parsedLinks.filter(a => !notOrphaned.some(b => a.namespace === b.namespace && a.title === b.title));
        if(!uncheckedParsedLinks.length) continue;

        const newCheckDocs = uncheckedParsedLinks.map(a => allDocuments.find(b => a.namespace === b.namespace && a.title === b.title)).filter(a => a);
        for(let doc of newCheckDocs) {
            if(!checkDocs.includes(doc)) checkDocs.push(doc);
        }
    }

    const orphaned = allDocuments.filter(a => !notOrphaned.includes(a));
    for(let doc of orphaned) {
        const parsedName = utils.dbDocumentToDocument(doc);
        newOrphanedPages[parsedName.namespace].push(globalUtils.doc_fulltitle(parsedName));
    }

    for(let arr of Object.values(newOrphanedPages)) arr.sort(Intl.Collator('en').compare);

    orphanedPages = newOrphanedPages;
    fs.writeFileSync('./cache/orphanedPages.json', JSON.stringify(orphanedPages));
}

const updateDailyLists = () => {
    updateNeededPages().then();
    scheduleUpdateDailyLists();
}
const scheduleUpdateDailyLists = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    setTimeout(updateDailyLists, tomorrow - Date.now());
}

app.get('/NeededPages', (req, res) => {
    const namespace = config.namespaces.includes(req.query.namespace) ? req.query.namespace : '문서';

    const displayCount = 100;
    const pageStr = req.query.from || req.query.until;
    const skipCount = pageStr ? (req.query.from ? parseInt(req.query.from) : parseInt(req.query.until) - displayCount + 1) : 0;
    const fullItems = (neededPages[namespace] ?? []);
    const items = fullItems.slice(skipCount, skipCount + displayCount);

    res.renderSkin('작성이 필요한 문서', {
        contentName: 'docList/NeededPages',
        serverData: {
            items,
            prevItem: skipCount - 1,
            nextItem: skipCount + displayCount,
            total: fullItems.length
        }
    });
});

app.get('/NeededPages/update', middleware.permission('developer'), middleware.referer('/NeededPages'), async (req, res) => {
    res.status(204).end();
    await updateNeededPages();
});

app.get('/OrphanedPages', (req, res) => {
    const namespace = config.namespaces.includes(req.query.namespace) ? req.query.namespace : '문서';

    const displayCount = 100;
    const pageStr = req.query.from || req.query.until;
    const skipCount = pageStr ? (req.query.from ? parseInt(req.query.from) : parseInt(req.query.until) - displayCount + 1) : 0;
    const fullItems = (orphanedPages[namespace] ?? []);
    const items = fullItems.slice(skipCount, skipCount + displayCount);

    res.renderSkin('고립된 문서', {
        contentName: 'docList/OrphanedPages',
        serverData: {
            items,
            prevItem: skipCount - 1,
            nextItem: skipCount + displayCount,
            total: fullItems.length
        }
    });
});

app.get('/OrphanedPages/update', middleware.permission('developer'), middleware.referer('/OrphanedPages'), async (req, res) => {
    res.status(204).end();
    await updateOrphanedPages();
});

module.exports = app;