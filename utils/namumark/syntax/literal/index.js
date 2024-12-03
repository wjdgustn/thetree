const Format = require('./format');

const { Priority } = require('../../types');
const utils = require('../../utils');
const CSSFilter = require('./cssFilter');
const listParser = require('../../listParser');
const tableSyntax = require('../table');

module.exports = {
    priority: Priority.Literal,
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    format: (content, namumark) => {
        const splittedContent = content.split(' ');
        const firstParam = splittedContent[0];

        if(firstParam.startsWith('#!wiki')) {
            let lines = content.split('\n');
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

            let { text, hasList } = utils.removeNewParagraphHardcode(lines.join('\n'));
            if(text.endsWith('\n')) text = text.slice(0, -1);

            // 리스트 미리 파싱
            if(hasList) text = listParser.parse(text + '\n').slice(0, -1)
                .replaceAll('\n<removeNewline/>', '')
                .replaceAll('<removeNewline/>\n', '')
                .replaceAll('<removeNewline/>', '');

            // 표 미리 파싱
            text = tableSyntax.parse(text, true);

            // text = text.replaceAll('\n', '<newLine/>');

            return `<div${style ? ` style="${style}"` : ''}${darkStyle ? ` data-dark-style="${darkStyle}"` : ''}><removeNewlineAfterFullline/>\n${text}\n<removeNewlineAfterFullline/></div>`;
        }

        if(firstParam.startsWith('#!folding')) {
            const lines = content.split('\n');
            const foldingText = namumark.escape(lines[0].slice('#!folding'.length) || 'More');
            let { text, hasList } = utils.removeNewParagraphHardcode(lines.slice(1).join('\n'));

            // 리스트 미리 파싱
            if(hasList) text = listParser.parse(text + '\n').slice(0, -1)
                .replaceAll('\n<removeNewline/>', '')
                .replaceAll('<removeNewline/>\n', '')
                .replaceAll('<removeNewline/>', '');

            // 표 미리 파싱
            text = tableSyntax.parse(text, true);

            return `<dl class="wiki-folding"><dt>${foldingText}</dt><dd class="wiki-folding-close-anim"><removeNewlineAfterFullline/>\n${text}\n<removeNewlineAfterFullline/></dd></dl>`;
        }

        if(Format(content, namumark) !== undefined) return null;

        if(content.includes('\n'))
            return `<pre><code>${namumark.escape(content)}</code></pre>`;

        return `<code>${namumark.escape(content)}</code>`;
    }
}