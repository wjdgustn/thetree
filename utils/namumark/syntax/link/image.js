const querystring = require('querystring');

const utils = require('../../utils');
const mainUtils = require('../../../../utils');
const globalUtils = require('../../../../utils/global');

module.exports = async (obj, link, {
    Store,
    thread,
    document: docDocument,
    dbDocument: docDbDocument,
    rev: docRev,
    includeData,
    isInternal
}) => {
    const document = mainUtils.parseDocumentName(obj.link);
    let { namespace, title } = document;

    if(!namespace.includes('파일')) return;

    title = document.title = await utils.parseIncludeParams(title, Store.isolateContext);

    const options = !obj.textExists ? {} : querystring.parse(obj.text);

    const fallback = {
        link,
        text: link
    }
    if(thread) return fallback;

    let rev;
    const checkCache = Store.revDocCache.find(a => a.namespace === namespace && a.title === title);
    if(checkCache && checkCache.rev?.document !== docRev?.document) {
        if(!checkCache.readable) return fallback;
        if(!checkCache.rev.fileKey && !checkCache.rev.videoFileKey) return fallback;
        rev = checkCache.rev;
    }
    else {
        // let dbDocument;
        // let readable = false;
        if(namespace === docDbDocument?.namespace
            && title === docDbDocument?.title
            && (docRev?.fileKey || docRev?.videoFileKey)) {
            // dbDocument = docDbDocument;
            rev = docRev;
            // readable = true;
        }

        if(!rev?.fileKey && !rev?.videoFileKey) return fallback;
    }

    const imgUrl = rev.fileKey && new URL((process.env.S3_PUBLIC_HOST_PREFIX ?? '') + rev.fileKey, process.env.S3_PUBLIC_HOST);
    if(!includeData && imgUrl) Store.embed.image ??= imgUrl.toString();

    const videoUrl = rev.videoFileKey && new URL((process.env.S3_PUBLIC_HOST_PREFIX ?? '') + rev.videoFileKey, process.env.S3_PUBLIC_HOST);

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

    if(![
        'fill',
        'contain',
        'cover',
        'none',
        'scale-down'
    ].includes(options['object-fit'])) delete options['object-fit'];

    const imgSpanClassList = [`wiki-image-align${options.align ? `-${options.align}` : ''}`];
    let imgSpanStyle = ``;
    let imgWrapperStyle = ``;
    let imgAttrib = ``;
    let imgStyle = ``;

    if(options.width) {
        imgSpanStyle += `width:${options.width}${widthUnit};`;
        imgWrapperStyle += `width: 100%;`;
        imgAttrib += ` width="100%"`;
    }
    if(options.height) {
        imgSpanStyle += `height:${options.height}${heightUnit};`;
        imgWrapperStyle += `height: 100%;`;
        imgAttrib += ` height="100%"`;
    }

    if(options.bgcolor) imgWrapperStyle += `background-color:${options.bgcolor};`;

    if(options.borderRadius) imgStyle += `border-radius:${options.borderRadius}${borderRadiusUnit};`;
    if(options.rendering) imgStyle += `image-rendering:${options.rendering};`;
    if(options['object-fit']) {
        imgWrapperStyle += `object-fit:${options['object-fit']};`;
        imgStyle += `object-fit:${options['object-fit']};`;
    }

    if(options.theme) imgSpanClassList.push(`wiki-theme-${options.theme}`);

    const fullTitle = utils.escapeHtml(globalUtils.doc_fulltitle(document));

    const b64Image = `data:image/svg+xml;base64,${Buffer.from(`<svg width="${rev.fileWidth}" height="${rev.fileHeight}" xmlns="http://www.w3.org/2000/svg"></svg>`).toString('base64')}`;

    return `
<span class="${imgSpanClassList.join(' ')}" style="${imgSpanStyle}">
<span class="wiki-image-wrapper" style="${imgWrapperStyle}">
<img${imgAttrib} style="${imgStyle}" src="${b64Image}">
<img class="wiki-image wiki-image-loading"${imgAttrib} style="${imgStyle}" src="${b64Image}" alt="${fullTitle}"${imgUrl ? ` data-src="${imgUrl}" data-filesize="${rev.fileSize}"` : ''}${videoUrl ? ` data-video-src="${videoUrl}" data-video-filesize="${rev.videoFileSize}"` : ''}${(docDocument.namespace === namespace && docDocument.title === title) ? '' : ` data-doc="${utils.escapeHtml(globalUtils.doc_action_link(document, 'w'))}"`}>
${isInternal
    ? '' 
    : (
        imgUrl
            ? `<noscript><img class="wiki-image"${imgAttrib} style="${imgStyle}" src="${imgUrl}" alt="${fullTitle}"></noscript>`
            : `<noscript><video class="wiki-image"${imgAttrib} style="${imgStyle}" src="${videoUrl}" alt="${fullTitle}" controls playsinline></video></noscript>`
        )
}
</span>
</span>`.replaceAll('\n', '');
}