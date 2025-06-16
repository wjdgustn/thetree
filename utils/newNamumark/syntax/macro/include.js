const mainUtils = require('../../../');
const parser = require('../../parser');

module.exports = async (params, { toHtml, includeData, revDocCache }, obj) => {
    if(includeData) return '';

    const docName = mainUtils.parseDocumentName(obj.splittedParams[0]);
    const doc = revDocCache.find(a => a.namespace === docName.namespace && a.title === docName.title);
    if(doc.rev.content == null) return '';

    const result = parser(doc.rev.content, {
        noTopParagraph: !obj.topParagraph
    });
    const final = await toHtml(result);
    return final.html;
}