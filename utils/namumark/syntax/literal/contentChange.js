const utils = require('../../utils');
const CSSFilter = require('./cssFilter');
// const removeNoParagraph = require('../../removeNoParagraph');

module.exports = async (content, namumark) => {
    const splittedContent = content.split(' ');
    const firstParam = splittedContent[0];

    if(firstParam.startsWith('#!wiki')) {
        content = utils.parseIncludeParams(content, namumark.includeData);

        let lines = content.split('<newLine/>');
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

        lines = lines.slice(1);

        let text = lines.join('<newLine/>');
        if(text.endsWith('<newLine/>')) text = text.slice(0, -'<newLine/>'.length);

        // 리스트 미리 파싱
        // if(hasList) text = listParser.parse(text + '\n').slice(0, -1)
        //     .replaceAll('\n<removeNewline/>', '')
        //     .replaceAll('<removeNewline/>\n', '')
        //     .replaceAll('<removeNewline/>', '');

        // 표 미리 파싱
        // text = tableSyntax.parse(text, true);

        // text = text.replaceAll('\n', '<newLine/>');

        return `<div${style ? ` style="${style}"` : ''}${darkStyle ? ` data-dark-style="${darkStyle}"` : ''}>${(await namumark.parse(text, true, true)).html}</div>`;
    }

    if(firstParam.startsWith('#!folding')) {
        const lines = content.split('<newLine/>');
        const foldingText = namumark.escape(lines[0].slice('#!folding'.length) || 'More');
        // let { text, hasList } = removeNewParagraph(lines.slice(1).join('\n'));
        let text = lines.slice(1).join('<newLine/>');

        // 리스트 미리 파싱
        // if(hasList) text = listParser.parse(text + '\n').slice(0, -1)
        //     .replaceAll('\n<removeNewline/>', '')
        //     .replaceAll('<removeNewline/>\n', '')
        //     .replaceAll('<removeNewline/>', '');

        // 표 미리 파싱
        // text = tableSyntax.parse(text, true);

        return `<dl class="wiki-folding"><dt>${foldingText}</dt><dd class="wiki-folding-close-anim">${(await namumark.parse(text, true, true)).html}</dd></dl>`;
    }
}