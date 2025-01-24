const { highlight } = require('highlight.js');

const Format = require('./format');
const ContentChange = require('./contentChange');
const utils = require('../../utils');

const { Priority, AllowedLanguages } = require('../../types');

// const escape = str => str.replaceAll('||', '\\||');

module.exports = {
    priority: Priority.Literal,
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    noEscapeChar: true,
    format: async (content, namumark, originalContent) => {
        if(Format(content, namumark, true) !== undefined) return null;
        if(await ContentChange(content, namumark, true) !== undefined) return null;

        if(content.includes('<newLine/>')) {
            let result = originalContent;

            const firstLine = content.split('<newLine/>')[0];
            if(firstLine.startsWith('#!syntax ')) {
                const param = firstLine.slice('#!syntax '.length);
                const language = AllowedLanguages.find(a => param.startsWith(a));
                if(language) {
                    let codeStr = utils.unescapeHtml(originalContent.slice('#!syntax '.length + language.length))
                        .replaceAll('<newLine/>', '\n');
                    if(codeStr.startsWith('\n')) codeStr = codeStr.slice(1);
                    result = highlight(codeStr, { language }).value.replaceAll('\n', '<br>');
                }
            }

            return `<*<pre><code>${result.replaceAll('<newLine/>', '<br>')}</code></pre>*>`;
        }

        return `<code><*${originalContent}*></code>`;
    }
}