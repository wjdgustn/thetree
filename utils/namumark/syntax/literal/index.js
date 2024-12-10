const { highlight } = require('highlight.js');

const Format = require('./format');
const ContentChange = require('./contentChange');
const utils = require('../../utils');

const { Priority, AllowedLanguages } = require('../../types');

module.exports = {
    priority: Priority.Literal,
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    noEscapeChar: true,
    format: (content, namumark, originalContent) => {
        if(Format(content, namumark) !== undefined) return null;
        if(ContentChange(content, namumark) !== undefined) return null;

        originalContent = originalContent.replaceAll('\\', '\\\\');

        if(content.includes('<newLine/>')) {
            let result = namumark.escape(originalContent);

            const firstLine = content.split('<newLine/>')[0];
            if(firstLine.startsWith('#!syntax ')) {
                const param = firstLine.slice('#!syntax '.length);
                const language = AllowedLanguages.find(a => param.startsWith(a));
                if(language) {
                    let codeStr = utils.unescapeHtml(originalContent.slice('#!syntax '.length + language.length));
                    if(codeStr.startsWith('<newLine/>')) codeStr = codeStr.slice(1);
                    result = highlight(codeStr, { language }).value.replaceAll('<newLine/>', '<br>');
                    console.log(result);
                }
            }

            return `<pre><code>${result}</code></pre>`;
        }

        return `<code>${namumark.escape(originalContent)}</code>`;
    }
}