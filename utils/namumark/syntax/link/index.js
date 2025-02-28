const cheerio = require('cheerio');

const { Priority } = require('../../types');
const processImage = require('./image');

const utils = require('../../utils');
const mainUtils = require('../../../../utils');
const globalUtils = require('../../../../utils/global');
const { BacklinkFlags, ACLTypes } = require('../../../types');

const Document = require('../../../../schemas/document');
const History = require('../../../../schemas/history');

const ACL = require('../../../../class/acl');

module.exports = {
    priority: Priority.ContentChange,
    openStr: `[[`,
    closeStr: `]]`,
    allowMultiline: true,
    format: async (content, namumark) => {
        const linkExistsCache = namumark.linkExistsCache;
        const fileDocCache = namumark.fileDocCache;

        if(!namumark.syntaxData.checkedLinkCache) {
            namumark.syntaxData.checkedLinkCache = true;

            const bulkFindDocuments = async docNames => {
                const parsedDocs = docNames.map(a => mainUtils.parseDocumentName(a));
                const namespaces = [...new Set(parsedDocs.map(a => a.namespace))];

                const query = { $or: [] };
                for(let namespace of namespaces) {
                    query.$or.push({
                        namespace,
                        title: {
                            $in: parsedDocs.filter(a => a.namespace === namespace).map(a => a.title)
                        }
                    });
                }
                if(!query.$or.length) return [];

                const result = await Document.find(query);
                return [
                    ...result,
                    ...parsedDocs
                        .map(a => !result.some(b => a.namespace === b.namespace && a.title === b.title) ? {
                            ...a,
                            contentExists: false
                        } : null)
                        .filter(a => a)
                ]
            }
            if(namumark.dbDocument) {
                const links = namumark.dbDocument.backlinks
                    .filter(a => a.flags.includes(BacklinkFlags.Link))
                    .map(a => a.docName)
                    .filter(a => {
                        const docName = mainUtils.parseDocumentName(a);
                        return !linkExistsCache.some(b => b.namespace === docName.namespace && b.title === docName.title);
                    });
                const categories = namumark.dbDocument.categories
                    .map(a => a.document)
                    .filter(a => {
                        return !linkExistsCache.some(b => b.namespace === '분류' && b.title === a);
                    })
                    .map(a => `분류:${a}`);

                if(config.experimental?.meilisearch_link_check) {

                }
                else {
                    const linkDocs = await bulkFindDocuments(links);
                    const categoryDocs = await bulkFindDocuments(categories);

                    for(let doc of [...linkDocs, ...categoryDocs]) {
                        linkExistsCache.push({
                            namespace: doc.namespace,
                            title: doc.title,
                            exists: doc.contentExists
                        });
                    }
                }

                const files = namumark.dbDocument.backlinks
                    .filter(a => a.flags.includes(BacklinkFlags.File))
                    .map(a => a.docName)
                    .filter(a => {
                        const docName = mainUtils.parseDocumentName(a);
                        return !fileDocCache.some(b => b.namespace === docName.namespace && b.title === docName.title);
                    });

                let fileDocs = [];
                if(!namumark.thread) fileDocs = await bulkFindDocuments(files);

                let revs;
                if(!namumark.thread) revs = await History.find({
                    document: {
                        $in: fileDocs.map(a => a.uuid)
                    }
                });

                const nsACLResultCache = {};
                for(let doc of fileDocs) {
                    let readable;
                    if(doc.contentExists) {
                        if(doc.lastReadACL === -1) {
                            if(nsACLResultCache[doc.namespace] == null) {
                                const acl = await ACL.get({ namespace: doc.namespace }, doc);
                                const { result } = await acl.check(ACLTypes.Read, namumark.aclData);
                                readable = result;
                                nsACLResultCache[doc.namespace] = readable;
                            }

                            readable = nsACLResultCache[doc.namespace];
                        }
                        else {
                            const acl = await ACL.get({ document: doc });
                            const { result } = await acl.check(ACLTypes.Read, namumark.aclData);
                            readable = result;
                        }
                    }
                    else readable = false;

                    fileDocCache.push({
                        namespace: doc.namespace,
                        title: doc.title,
                        readable,
                        rev: revs.find(a => a.document === doc.uuid)
                    });
                }
            }
        }

        content = utils.parseIncludeParams(content, namumark.includeData);

        const docTitle = globalUtils.doc_fulltitle(namumark.originalDocument ?? namumark.document);

        const splittedContent = content.split(/(?<!\\)\|/).map(a => utils.removeBackslash(a));

        let link = splittedContent[0];
        let text = splittedContent.slice(1).join('|') || link;
        let notExist = false;

        let isImage = false;
        const image = await processImage(content, splittedContent, link, namumark);
        if(typeof image === 'string') {
            namumark.files.push(link);
            return image;
        }
        else if(typeof image === 'object') {
            if(image.link) link = image.link;
            if(image.text) text = image.text;
            namumark.files.push(link);
            notExist = true;
            isImage = true;
        }

        let isCategory = false;
        let newCategory;
        if(link.startsWith('분류:') && !namumark.thread) {
            isCategory = true;

            if(!namumark.categories.find(a => a.document === link)) {
                let blur;
                if(link.endsWith('#blur')) {
                    link = link.slice(0, -'#blur'.length);
                    blur = true;
                }
                newCategory = {
                    document: utils.unescapeHtml(link),
                    text: splittedContent.length > 1 ? utils.unescapeHtml(text) : null,
                    blur
                }
                namumark.categories.push(newCategory);
            }

            text = link;
        }

        if(link.startsWith(':')) {
            const slicedLink = link.slice(1);
            const isSpecialLink = slicedLink.startsWith('파일:') || slicedLink.startsWith('분류:');

            if(config.namespaces.some(a => slicedLink.startsWith(a + ':'))) {
                link = slicedLink;
                if(isSpecialLink && splittedContent.length === 1) text = text.slice(1);
            }
        }

        link = utils.unescapeHtml(link.trim());
        text = text.trim();

        if(!isImage && splittedContent.length === 1 && link.slice(1).includes('#')) {
            const splittedText = link.split('#');
            splittedText.pop();
            text = splittedText.join('#');
        }

        const imageDocNames = [];
        if(!isImage) {
            const parseResult = await namumark.parse(text, true, true);
            if(parseResult.hasNewline) return null;
            text = parseResult.html;

            if(text.startsWith('<span class="wiki-image-align') && text.endsWith('</span></span>')) {
                const $ = cheerio.load(text);
                for(let child of $('body').children()) {
                    if(!child.attribs.class?.split(' ').includes('wiki-image-align')) {
                        imageDocNames.length = 0;
                        break;
                    }

                    const image = child.children[0].children[1];
                    const docName = image.attribs['data-doc'];
                    imageDocNames.push(docName);
                }
            }
        }

        let parsedLink;
        try {
            parsedLink = new URL(link);
        } catch(e) {}

        if(parsedLink) {
            if(![
                'http',
                'https',
                'ftp'
            ].includes(parsedLink.protocol.slice(0, -1))) parsedLink = null;
        }

        let title;
        let titleDocument;
        let hideExternalLinkIcon = false;
        if(parsedLink) {
            link = parsedLink.href;
            title = link;

            if(imageDocNames.length) {
                let passedCount = 0;
                for(let docName of imageDocNames) {
                    let linkRules = config.external_link_icons?.[docName];
                    if(linkRules != null) {
                        if(!Array.isArray(linkRules)) linkRules = [linkRules];
                        const splittedRules = linkRules.map(r => r.split('.').reverse().filter(a => a));
                        const splittedUrl = parsedLink.hostname.split('.').reverse();

                        if(splittedRules.some(rule => rule.every((a, i) => a === splittedUrl[i]))) passedCount++;
                        else break;
                    }
                    else break;
                }
                if(passedCount === imageDocNames.length) hideExternalLinkIcon = true;
            }
        }
        else {
            if(link.startsWith('../')) {
                link = link.slice(3);
                if(docTitle) {
                    const splittedDocument = docTitle.split('/');
                    splittedDocument.pop();
                    const document = splittedDocument.join('/');
                    link = `${document}${(document && link) ? '/' : ''}${link}`;

                    link ||= docTitle;
                }
            }

            if(link.startsWith('/')) link = docTitle + link;

            if(link.startsWith('#')) {
                title = docTitle;
                notExist = false;
            }
            else {
                const splittedLink = link.split('#');
                if(splittedLink.length >= 2) {
                    const hash = splittedLink.pop();
                    const front = splittedLink.join('#').replaceAll('#', '%23');
                    link = `${front}#${hash}`;
                    title = front;
                }
                else title = link;

                if(link.startsWith('문서:')) link = link.slice(3);
                if(link.includes('../')) link = `/w?doc=${encodeURIComponent(link)}`;
                else link = `/w/${globalUtils.encodeSpecialChars(link, ['#'])}`;
            }

            const document = mainUtils.parseDocumentName(utils.unescapeHtml(title));
            titleDocument = document;
            const cache = linkExistsCache.find(cache => cache.namespace === document.namespace && cache.title === document.title);
            if(cache) notExist = !cache.exists;
            else if(isImage && !namumark.thread) notExist = true;
            else {
                const dbDocument = await Document.findOne({
                    namespace: document.namespace,
                    title: document.title
                });
                const documentExists = dbDocument?.contentExists;
                linkExistsCache.push({
                    ...document,
                    exists: documentExists
                });
                notExist = !documentExists;
            }

            if(newCategory) newCategory.notExist = notExist;
        }

        const classList = [];

        if(notExist) classList.push('not-exist');

        if(parsedLink) classList.push(hideExternalLinkIcon ? 'wiki-link-whitelisted' : 'wiki-link-external');
        else if(title === docTitle) classList.push('wiki-self-link');

        const rel = [];

        if(notExist) rel.push('nofollow');

        if(parsedLink) rel.push('nofollow', 'noopener', 'ugc');

        while(text.includes('<a') || text.includes('</a>')) {
            const aOpenText = '<a';
            const aPos = text.indexOf(aOpenText);
            const aCloseText = '</a>';
            const aClosePos = text.indexOf(aCloseText, aPos);
            const aClosePosEnd = aClosePos + aCloseText.length;

            text = text.slice(0, aPos) + text.slice(aClosePosEnd);
        }

        const html = `<a href="${mainUtils.removeHtmlTags(link)}" title="${mainUtils.removeHtmlTags(title ?? '')}" class="${classList.join(' ')}" rel="${rel.join(' ')}"${parsedLink ? 'target="_blank"' : ''}>${splittedContent.length === 1 ? namumark.escape(text) : text}</a>`;

        if(isCategory) {
            // namumark.categoryHtmls.push(html);
            return '<removeNewline/>';
        }

        const titleDocName = titleDocument ? globalUtils.doc_fulltitle(titleDocument) : null;
        if(!parsedLink
            && titleDocName !== docTitle
            && !namumark.redirect) namumark.links.push(titleDocName);
        return html;
    }
}