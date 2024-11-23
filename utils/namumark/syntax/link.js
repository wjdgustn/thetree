module.exports = {
    openStr: `[[`,
    closeStr: `]]`,
    format: (content, sourceContent) => {
        const splittedContent = content.split('|');
        const splittedSourceContent = sourceContent.split('|');

        let link = splittedSourceContent[0];
        let text = splittedContent.at(-1);

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
            title = link;
            link = new URL(`/w/${link}`, config.base_url).href;
        }

        console.log(`link: ${link}, text: ${text}`);
        return `<a href="${link}" title="${title}">${text}</a>`;
    }
}