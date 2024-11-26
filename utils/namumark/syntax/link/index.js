const { Priority } = require('../../types');

const globalUtils = require('../../../../utils/global');

const processImage = require('./image');

module.exports = {
    priority: Priority.ContentChange,
    openStr: `[[`,
    closeStr: `]]`,
    format: async (content, sourceContent, namumark) => {
        const docTitle = globalUtils.doc_fulltitle(namumark.document);

        const splittedContent = content.split('|');
        const splittedSourceContent = sourceContent.split('|');

        let link = splittedSourceContent[0];
        let text = splittedContent.at(-1);
        let notExist = true;

        const image = await processImage(content, sourceContent, splittedContent, splittedSourceContent, link, text);
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
            namumark.categories.push({
                document: link,
                text: splittedSourceContent[1]
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

        if(splittedSourceContent.length === 1 && link.slice(1).includes('#')) text = link.split('#')[0];

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
                    link = `${document}${document ? '/' : ''}${link}`;

                    link ||= docTitle;
                }
            }

            if(link.startsWith('/')) link = docTitle + link;

            if(link.startsWith('#')) notExist = false;
            else {
                title = link;
                if(link.includes('../')) link = `/w?doc=${encodeURIComponent(link)}`;
                else link = `/w/${link}`;
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

        const html = `<a href="${link}" title="${title ?? ''}" class="${classList.join(' ')}" rel="${rel.join(' ')}"${parsedLink ? 'target="_blank"' : ''}>${text}</a>`;

        if(isCategory) {
            namumark.categoryHtmls.push(html);
            return '';
        }

        if(!parsedLink) namumark.links.push(title);
        return html;
    }
}