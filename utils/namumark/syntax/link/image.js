const querystring = require('querystring');

const utils = require('../../utils');
const mainUtils = require('../../../../utils');
const globalUtils = require('../../../../utils/global');

const Document = require('../../../../schemas/document');
const History = require('../../../../schemas/history');
const ACL = require('../../../../class/acl');
const { ACLTypes } = require('../../../types');

module.exports = async (content, splittedContent, link, namumark) => {
    if(!link.startsWith('파일:')) return;

    const options = splittedContent.length === 1 ? {} : querystring.parse(utils.unescapeHtml(splittedContent[1]));

    const fallback = {
        link,
        text: link
    }

    const document = mainUtils.parseDocumentName(link);
    const { namespace, title } = document;

    let rev;
    const fileDocCache = namumark.fileDocCache;
    const checkCache = fileDocCache.find(a => a.namespace === namespace && a.title === title);
    if(checkCache) {
        if(!checkCache.readable) return fallback;
        if(!checkCache.rev.fileKey) return fallback;
        rev = checkCache.rev;
    }
    else {
        const dbDocument = await Document.findOne({
            namespace,
            title
        });
        if(!dbDocument) return fallback;

        const acl = await ACL.get({ document: dbDocument }, document);

        const { result: readable } = await acl.check(ACLTypes.Read, namumark.aclData);
        if(!readable) return fallback;

        const dbRev = await History.findOne({
            document: dbDocument.uuid
        }).sort({ rev: -1 });
        if(!dbRev?.fileKey) return fallback;
        rev = dbRev;

        fileDocCache.push({
            namespace: dbDocument.namespace,
            title: dbDocument.title,
            readable,
            rev
        });
    }

    const imgUrl = new URL(rev.fileKey, process.env.S3_PUBLIC_HOST);

    options.borderRadius = options['border-radius'];
    delete options['border-radius'];

    let widthUnit = 'px';
    let heightUnit = 'px';
    let borderRadiusUnit = 'px';

    if(options.width?.endsWith('%')) {
        widthUnit = '%';
        options.width = options.width.slice(0, -1);
    }
    if(options.height?.endsWith('%')) {
        heightUnit = '%';
        options.height = options.height.slice(0, -1);
    }
    if(options.borderRadius?.endsWith('%')) {
        borderRadiusUnit = '%';
        options.borderRadius = options.borderRadius.slice(0, -1);
    }

    const parseFrontInt = str => {
        if(str == null) return NaN;

        str = str.split('');
        let result = '';
        while(!isNaN(str[0])) result += str.shift();
        return parseInt(result);
    }

    options.width = parseFrontInt(options.width);
    options.height = parseFrontInt(options.height);
    options.borderRadius = parseFrontInt(options.borderRadius);

    if(isNaN(options.width)) delete options.width;
    if(isNaN(options.height)) delete options.height;
    if(isNaN(options.borderRadius)) delete options.borderRadius;

    if(![
        'bottom',
        'center',
        'left',
        'middle',
        'normal',
        'right',
        'top'
    ].includes(options.align)) delete options.align;

    if(!utils.validateColor(options.bgcolor)) delete options.bgcolor;

    if(![
        'light',
        'dark'
    ].includes(options.theme)) delete options.theme;

    if(![
        'auto',
        'smooth',
        'high-quality',
        'pixelated',
        'crisp-edges'
    ].includes(options.rendering)) delete options.rendering;

    const imgSpanClassList = [`wiki-image-align${options.align ? `-${options.align}` : ''}`];
    let imgSpanStyle = ``;
    let imgWrapperStyle = `width: 100%; height: 100%;`;
    let imgStyle = ``;

    if(options.width) imgSpanStyle += `width:${options.width}${widthUnit};`;
    if(options.height) imgSpanStyle += `height:${options.height}${heightUnit};`;

    if(options.bgcolor) imgWrapperStyle += `background-color:${options.bgcolor};`;

    if(options.borderRadius) imgStyle += `border-radius:${options.borderRadius}${borderRadiusUnit};`;
    if(options.rendering) imgStyle += `image-rendering:${options.rendering};`;

    if(options.theme) imgSpanClassList.push(`wiki-theme-${options.theme}`);

    const fullTitle = utils.escapeHtml(globalUtils.doc_fulltitle(document));

    // TODO: over 1MB remove option, loading lazy config
    return `
<span class="${imgSpanClassList.join(' ')}" style="${imgSpanStyle}">
<span class="wiki-image-wrapper" style="${imgWrapperStyle}">
<img width="100%" height="100%" style="${imgStyle}" src="data:image/svg+xml;base64,${Buffer.from(`<svg width="${rev.fileWidth}" height="${rev.fileHeight}" xmlns="http://www.w3.org/2000/svg"></svg>`).toString('base64')}">
<img class="wiki-image" width="100%" height="100%" style="${imgStyle}" src="${imgUrl}" alt="${fullTitle}" data-filesize="${rev.fileSize}" data-src="${imgUrl}" data-doc="${fullTitle}" loading="lazy">
${namumark.document.namespace === namespace && namumark.document.title === title 
    ? '' 
    : `<a class="wiki-image-info" href="${globalUtils.doc_action_link(document, 'w')}" rel="nofollow noopener"></a>`
}
</span>
</span>`;
}