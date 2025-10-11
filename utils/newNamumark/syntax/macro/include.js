const mainUtils = require('../../../');
const parser = require('../../parser');
const ivm = require('isolated-vm');

module.exports = async (params, { toHtml, includeData, revDocCache, Store }, obj) => {
    if(includeData) return '';

    const docName = mainUtils.parseDocumentName(obj.splittedParams[0]);
    const doc = revDocCache.find(a => a.namespace === docName.namespace && a.title === docName.title);
    if(!doc?.readable || doc.rev?.content == null) return '';

    const result = parser(doc.rev.content, {
        noTopParagraph: !obj.topParagraph,
        tokens: doc.parseResult.tokens
    });
    const isolate = new ivm.Isolate({ memoryLimit: 8 });
    const isolateContext = await isolate.createContext();
    const final = await toHtml(result, {
        document: docName,
        includeData: obj.includeData,
        Store: {
            ...Store,
            heading: {
                list: [],
                html: ''
            },
            isolate,
            isolateContext
        }
    });
    return final.html;
}