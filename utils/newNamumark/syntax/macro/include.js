const mainUtils = require('../../../');
const parser = require('../../parser');

module.exports = async (params, { toHtml, includeData, revDocCache }, obj) => {
    if(includeData) return '';

    const docName = mainUtils.parseDocumentName(obj.splittedParams[0]);
    const doc = revDocCache.find(a => a.namespace === docName.namespace && a.title === docName.title);
    if(doc.rev?.content == null) return '';

    const newIncludeData = {};
    for(let param of obj.splittedParams.slice(1)) {
        const splittedParam = param.split('=');
        if(splittedParam.length < 2) continue;

        const key = splittedParam[0].replaceAll(' ', '');
        newIncludeData[key] = splittedParam.slice(1).join('=');
    }

    const result = parser(doc.rev.content, {
        noTopParagraph: !obj.topParagraph
    });
    const final = await toHtml(result, {
        includeData: newIncludeData
    });
    return final.html;
}