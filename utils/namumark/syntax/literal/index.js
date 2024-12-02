const Format = require('./format');

const { Priority } = require("../../types");
const CSSFilter = require("./cssFilter");

module.exports = {
    priority: Priority.Literal,
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    format: (content, namumark) => {
        const splittedContent = content.split(' ');
        const firstParam = splittedContent[0];

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

            // wiki 문법 안 인용문 하드코딩
            text = text.split('\n').map(a =>
                a.trimStart().startsWith('&gt;')
                    ? a.replace('&gt;', '&gt;<removeNewParagraph/>')
                    : a
            ).join('\n');

            text = text.replaceAll('\n', '<newLine/>');

            return `<removebr/><div${style ? ` style="${style}"` : ''}${darkStyle ? ` data-dark-style="${darkStyle}"` : ''}><removeNewlineLater/>\n${text}\n<removeNewlineLater/></div>`;
        }

        if(Format(content) !== undefined) return null;

        if(content.includes('\n'))
            return `<pre><code>${namumark.escape(content)}</code></pre>`;

        return `<code>${namumark.escape(content)}</code>`;
    }
}