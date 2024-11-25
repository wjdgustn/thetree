const {
    validateHTMLColorHex,
    validateHTMLColorName
} = require('validate-color');
const querystring = require('querystring');

const utils = require('../../utils');
const globalUtils = require('../../../../utils/global');

module.exports = async (content, sourceContent, splittedContent, splittedSourceContent, link) => {
    if(!link.startsWith('파일:')) return;

    const options = splittedContent.length === 1 ? {} : querystring.parse(utils.unescapeHtml(splittedSourceContent[1]));
    // TODO: load image from db
    if(false) return {
        link,
        text: link
    }

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

    if(!validateHTMLColorHex(options.bgcolor)
        && !validateHTMLColorName(options.bgcolor)) delete options.bgcolor;

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

    let imgSpanStyle = ``;
    let imgWrapperStyle = `width: 100%; height: 100%;`;
    let imgStyle = ``;

    if(options.width) imgSpanStyle += `width:${options.width}${widthUnit};`;
    if(options.height) imgSpanStyle += `height:${options.height}${heightUnit};`;

    if(options.bgcolor) imgWrapperStyle += `background-color:${options.bgcolor};`;

    if(options.borderRadius) imgStyle += `border-radius:${options.borderRadius}${borderRadiusUnit};`;
    if(options.rendering) imgStyle += `image-rendering:${options.rendering};`;

    // TODO: implement data-filesize(for over 1MB remove option), alt, data-doc, loading lazy config, put image size to svg
    return `
<span class="wiki-image-align${options.align ? `-${options.align}` : ''}" style="${imgSpanStyle}">
<span class="wiki-image-wrapper" style="${imgWrapperStyle}">
<img width="100%" height="100%" style="${imgStyle}" src="data:image/svg+xml;base64,${Buffer.from(`<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg"></svg>`).toString('base64')}">
<img class="wiki-image" width="100%" height="100%" style="${imgStyle}" src="/test.png" data-filesize="100" data-src="/test.png" data-doc="파일:테스트" loading="lazy">
<a class="wiki-image-info" href="${globalUtils.doc_action_link('파일:테스트', 'w')}" rel="nofollow noopener"></a>
</span>`.replaceAll('\n', '');
}