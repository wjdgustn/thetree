const {
    validateHTMLColorHex,
    validateHTMLColorName
} = require('validate-color');
const sanitizeHtml = require('sanitize-html');

const utils = require('../../utils');
const CSSFilter = require('./cssFilter');

const sanitizeHtmlOptions = {
    disallowedTagsMode: 'completelyDiscard',
    allowedAttributes: {
        '*': ['style'],
        a: ['href']
    },
    allowedSchemes: ['http', 'https', 'ftp'],
    transformTags: {
        '*': (tagName, attribs) => {
            if(!attribs.style) return { tagName, attribs };

            const style = CSSFilter(attribs.style);

            return {
                tagName,
                attribs: { ...attribs, style }
            }
        },
        a: sanitizeHtml.simpleTransform('a', {
            class: 'wiki-link-external',
            rel: 'nofollow noopener ugc',
            target: '_blank'
        })
    }
}

module.exports = content => {
    const splittedContent = content.split(' ');
    const firstParam = splittedContent[0];
    const paramContent = splittedContent.slice(1).join(' ');

    if(firstParam.startsWith('#!wiki')) {
        const lines = content.split('\n');
        let wikiParamsStr = lines[0].slice('#!wiki '.length);

        const styleCloseStr = '&quot;';

        const darkStyleOpenStr = 'dark-style=&quot;';
        const darkStyleIndex = wikiParamsStr.indexOf(darkStyleOpenStr);
        const darkStyleEndIndex = wikiParamsStr.indexOf(styleCloseStr, darkStyleIndex + darkStyleOpenStr.length);
        let darkStyle;
        if(darkStyleIndex >= 0 && darkStyleEndIndex >= 0) {
            darkStyle = CSSFilter(wikiParamsStr.slice(darkStyleIndex + darkStyleOpenStr.length, darkStyleEndIndex));
            wikiParamsStr = wikiParamsStr.slice(0, darkStyleIndex) + wikiParamsStr.slice(darkStyleEndIndex + styleCloseStr.length);
        }

        const styleOpenStr = 'style=&quot;';
        const styleIndex = wikiParamsStr.indexOf(styleOpenStr);
        const styleEndIndex = wikiParamsStr.indexOf('&quot;', styleIndex + styleOpenStr.length);
        let style;
        if(styleIndex >= 0 && styleEndIndex >= 0) {
            style = CSSFilter(wikiParamsStr.slice(styleIndex + styleOpenStr.length, styleEndIndex));
            // wikiParamsStr = wikiParamsStr.slice(0, styleIndex) + wikiParamsStr.slice(styleEndIndex + styleCloseStr.length);
        }

        let text = lines.slice(1).join('\n');
        if(text.endsWith('\n')) text = text.slice(0, -1);
        text = text.replaceAll('\n', '<newLine/>');

        return `<removebr/><div${style ? ` style="${style}"` : ''}${darkStyle ? ` data-dark-style="${darkStyle}"` : ''}>${text}</div>`;
    }

    if(firstParam.startsWith('#!html')) {
        const html = utils.unescapeHtml(content.slice('#!html'.length).trim());
        console.log('html:', html);
        const safeHtml = sanitizeHtml(html, sanitizeHtmlOptions);
        console.log('safeHtml:', safeHtml);
        return `${safeHtml}`;
    }

    if(firstParam.startsWith('+')) {
        const size = parseInt(firstParam.slice(1));
        if(!isNaN(size) && size >= 1 && size <= 5)
            return `<span class="wiki-size-up-${size}">${paramContent}</span>`;
    }
    if(firstParam.startsWith('-')) {
        const size = parseInt(firstParam.slice(1));
        if(!isNaN(size) && size >= 1 && size <= 5)
            return `<span class="wiki-size-down-${size}">${paramContent}</span>`;
    }

    if(firstParam.startsWith('#')) {
        const colorParams = firstParam.split(',');

        if(colorParams.length === 1) {
            const slicedFirstParam = firstParam.slice(1);

            if(validateHTMLColorHex(firstParam))
                return `<span style="color: ${firstParam}">${paramContent}</span>`;
            else if(validateHTMLColorName(slicedFirstParam))
                return `<span style="color: ${slicedFirstParam}">${paramContent}</span>`;
        }
        else if(colorParams.length === 2) {
            const slicedColorParams = colorParams.map(colorParam => colorParam.slice(1));

            // TODO: data-dark-style 구현
            if(validateHTMLColorHex(colorParams[0]) && validateHTMLColorHex(colorParams[1]))
                return `<span style="color: ${colorParams[0]}" data-dark-style="color: ${colorParams[1]};">${paramContent}</span>`;
            else if(validateHTMLColorName(slicedColorParams[0]) && validateHTMLColorName(slicedColorParams[1]))
                return `<span style="color: ${slicedColorParams[0]}" data-dark-style="color: ${slicedColorParams[1]};">${paramContent}</span>`;
        }
    }
}