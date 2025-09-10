const processImage = require('./image');

const utils = require('../../utils');
const mainUtils = require('../../../../utils');
const globalUtils = require('../../../../utils/global');

module.exports = async (obj, options = {}) => {
    const { document, Store, thread, toHtml } = options;

    // content = utils.parseIncludeParams(content, namumark.includeData);

    const docTitle = globalUtils.doc_fulltitle(document);

    let link = obj.link;
    let text = obj.text = utils.parseIncludeParams(obj.text, options.includeData);
    const hash = utils.parseIncludeParams(obj.hash, options.includeData);
    let notExist = false;

    let isImage = false;
    const image = await processImage(obj, link, options);
    if(typeof image === 'string') {
        if(!options.includeData) Store.files.push(link);
        return image;
    }
    else if(typeof image === 'object') {
        if(image.link) link = image.link;
        if(image.text) {
            text = image.text;
            obj.textExists = false;
        }
        if(!options.includeData) Store.files.push(link);
        notExist = true;
        isImage = true;
    }

    if(link.startsWith('분류:') && !thread)
        return;

    if(link.startsWith(':')) {
        const slicedLink = link.slice(1);
        const isSpecialLink = slicedLink.startsWith('파일:') || slicedLink.startsWith('분류:');

        if(config.namespaces.some(a => slicedLink.startsWith(a + ':'))) {
            link = slicedLink;
            if(isSpecialLink && !obj.textExists) text = text.slice(1);
        }
    }

    link = utils.parseIncludeParams(link, options.includeData).trim();
    text = text.trim();

    // if(!isImage && !obj.textExists && link.slice(1).includes('#')) {
    //     const splittedText = link.split('#');
    //     splittedText.pop();
    //     text = splittedText.join('#');
    // }

    const imageDocNames = obj.parsedText.filter(a => a.type === 'link' && a.link.startsWith('파일:')).map(a => a.link);

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
    let hasHash = false;
    if(parsedLink) {
        link = parsedLink.href;
        title = link;

        if(imageDocNames.length && !obj.parsedText.some(a => a.type !== 'link' || !a.link.startsWith('파일:'))) {
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

        if(!link && hash) {
            link = '#' + hash;
            text ||= link;
            title = docTitle;
            notExist = false;
            hasHash = true;
        }
        else {
            // const splittedLink = link.split('#');
            // if(splittedLink.length >= 2) {
            //     const hash = splittedLink.pop();
            //     const front = splittedLink.join('#').replaceAll('#', '%23');
            //     link = `${front}#${hash}`;
            //     title = front;
            //     hasHash = true;
            // }
            // else title = link;
            if(hash) hasHash = true;
            title = link;

            if(link.startsWith('문서:')) link = link.slice(3);
            if(link.includes('../')) link = `/w?doc=${encodeURIComponent(link)}${hash ? `#${hash}` : ''}`;
            else link = `/w/${globalUtils.encodeSpecialChars(link)}${hash ? `#${hash}` : ''}`;

            const document = mainUtils.parseDocumentName(title);
            titleDocument = document;
            const cache = Store.dbDocuments.find(cache => cache.namespace === document.namespace && cache.title === document.title);
            if(cache) notExist = !cache.contentExists;
            else notExist = true;
        }
    }

    const classList = [];

    if(notExist) classList.push('not-exist');

    if(parsedLink) classList.push(hideExternalLinkIcon ? 'wiki-link-whitelisted' : 'wiki-link-external');
    else if(title === docTitle && !hasHash && !thread) classList.push('wiki-self-link');

    const rel = [];

    if(notExist) rel.push('nofollow');

    if(parsedLink) rel.push('nofollow', 'noopener', 'ugc');

    // while(text.includes('<a') || text.includes('</a>')) {
    //     const aOpenText = '<a';
    //     const aPos = text.indexOf(aOpenText);
    //     const aCloseText = '</a>';
    //     const aClosePos = text.indexOf(aCloseText, aPos);
    //     const aClosePosEnd = aClosePos + aCloseText.length;
    //
    //     text = text.slice(0, aPos) + text.slice(aClosePosEnd);
    // }

    const safeLink = utils.escapeHtml(globalUtils.removeHtmlTags(link));
    const parsedTitle = obj.textExists ? await toHtml(obj.parsedText, { disableImageLinkButton: true }) : utils.escapeHtml(text);

    const titleDocName = titleDocument ? globalUtils.doc_fulltitle(titleDocument) : null;
    const html = `<a href="${safeLink}" title="${link.startsWith('#') ? '' : utils.escapeHtml(titleDocName ?? link)}" class="${classList.join(' ')}" rel="${rel.join(' ')}"${parsedLink ? 'target="_blank"' : ''}>${parsedTitle}</a>`;

    if(titleDocName
        && !parsedLink
        && titleDocName !== docTitle
        && !isImage
        && !Store.links.includes(titleDocName)
        && !options.includeData
    )
        Store.links.push(titleDocName);
    return html;
}