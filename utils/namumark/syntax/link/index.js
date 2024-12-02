const { Priority } = require('../../types');
const processImage = require('./image');

const utils = require('../../../../utils');
const globalUtils = require('../../../../utils/global');

const Document = require('../../../../schemas/document');

module.exports = {
    priority: Priority.ContentChange,
    openStr: `[[`,
    closeStr: `]]`,
    format: async (content, namumark) => {
        const docTitle = globalUtils.doc_fulltitle(namumark.document);

        const splittedContent = content.split('|');

        let link = splittedContent[0];
        let text = splittedContent.at(-1);
        let notExist = false;

        const image = await processImage(content, splittedContent, link, text);
        if(typeof image === 'string') {
            namumark.files.push(link);
            return image;
        }
        else if(typeof image === 'object') {
            if(image.link) link = image.link;
            if(image.text) text = image.text;
            notExist = true;
        }

        let isCategory = false;
        if(link.startsWith('분류:')) {
            isCategory = true;
            text = text.slice(3);

            let blur;
            if(link.endsWith('#blur')) {
                link = link.slice(0, -'#blur'.length);
                blur = true;
            }
            namumark.categories.push({
                document: link,
                text: splittedContent[1],
                blur
            });
        }

        if(link.startsWith(':')) {
            const slicedLink = link.slice(1);
            const isSpecialLink = slicedLink.startsWith('파일:') || slicedLink.startsWith('분류:');

            if(isSpecialLink) {
                link = slicedLink;
                if(splittedContent.length === 1) text = text.slice(1);
            }
        }

        link = link.trim();
        text = text.trim();

        if(splittedContent.length === 1 && link.slice(1).includes('#')) {
            const splittedText = link.split('#');
            splittedText.pop();
            text = splittedText.join('#');
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

        const linkExistsCache = namumark.syntaxData.linkExistsCache ??= [];

        let title;
        if(parsedLink) {
            link = parsedLink.href;
            title = link;
        }
        else {
            if(link.startsWith('../')) {
                link = link.slice(3);
                if(namumark.document) {
                    const splittedDocument = docTitle.split('/');
                    splittedDocument.pop();
                    const document = splittedDocument.join('/');
                    link = `${document}${(document && link) ? '/' : ''}${link}`;

                    link ||= docTitle;
                }
            }

            if(link.startsWith('/')) link = docTitle + link;

            if(link.startsWith('#')) notExist = false;
            else {
                const splittedLink = link.split('#');
                if(splittedLink.length > 2) {
                    const hash = splittedLink.pop();
                    const front = splittedLink.join('#').replaceAll('#', '%23');
                    link = `${front}#${hash}`;
                }

                title = link;
                if(link.includes('../')) link = `/w?doc=${encodeURIComponent(link)}`;
                else link = `/w/${link}`;
            }

            const document = utils.parseDocumentName(title);
            const cache = linkExistsCache.find(cache => cache.namespace === document.namespace && cache.title === document.title);
            if(cache) notExist = !cache.exists;
            else {
                const documentExists = await Document.exists({
                    namespace: document.namespace,
                    title: document.title
                });
                linkExistsCache.push({
                    ...document,
                    exists: documentExists
                });
                notExist = !documentExists;
            }
        }

        console.log(`link: ${link}, text: ${text}`);

        const classList = [];

        if(notExist) classList.push('not-exist');

        if(parsedLink) classList.push('wiki-link-external');
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

        const html = `<a href="${link}" title="${title ?? ''}" class="${classList.join(' ')}" rel="${rel.join(' ')}"${parsedLink ? 'target="_blank"' : ''}>${splittedContent.length === 1 ? namumark.escape(text) : text}</a>`;

        if(isCategory) {
            namumark.categoryHtmls.push(html);
            return '';
        }

        if(!parsedLink) namumark.links.push(title);
        return html;
    }
}