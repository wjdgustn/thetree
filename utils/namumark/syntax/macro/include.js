const utils = require('../../../../utils');
const globalUtils = require('../../../../utils/global');
const {
    ACLTypes
} = require('../../../../utils/types');

const Document = require('../../../../schemas/document');
const History = require('../../../../schemas/history');

const ACL = require('../../../../class/acl');

const dummyDocument = {
    readable: false
}
const getDocument = async (document, namumark) => {
    const { namespace, title } = document;

    const dbDocument = await Document.findOne({
        namespace,
        title
    });
    if(!dbDocument) return dummyDocument;

    const rev = await History.findOne({
        document: dbDocument.uuid
    }).sort({ rev: -1 });
    if(!rev.content) return dummyDocument;

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: readable } = await acl.check(ACLTypes.Read, namumark.aclData);

    return {
        document,
        dbDocument,
        acl,
        readable,
        content: rev?.content
    }
}

const getCachedDocument = async (name, namumark) => {
    const contentCache = namumark.syntaxData.contentCache ??= {};

    const document = utils.parseDocumentName(name);
    const fullName = globalUtils.doc_fulltitle(document);

    return contentCache[fullName] ??= await getDocument(document, namumark);
}

module.exports = async (params, namumark) => {
    if(namumark.includeData) return '';

    const removeNewParagraph = params.startsWith('<removeNewParagraph/>');
    if(removeNewParagraph) params = params.slice('<removeNewParagraph/>'.length);

    const document = await getCachedDocument(params, namumark);
    if(!document.readable) return '';

    const parser = new namumark.NamumarkParser({
        document: document.document,
        aclData: namumark.aclData,
        req: namumark.req,
        includeData: {}
    });

    const { html: contentHtml } = await parser.parse(document.content);
    return `${removeNewParagraph ? '' : '</div>'}${contentHtml}${removeNewParagraph ? '' : '<div class="wiki-paragraph">'}`;
}