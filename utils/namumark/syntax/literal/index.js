const Format = require('./format');
const ContentChange = require('./contentChange');

const { Priority } = require('../../types');

module.exports = {
    priority: Priority.Literal,
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    format: (content, namumark) => {
        if(Format(content, namumark) !== undefined) return null;
        if(ContentChange(content, namumark) !== undefined) return null;

        if(content.includes('\n'))
            return `<pre><code>${namumark.escape(content)}</code></pre>`;

        return `<code>${namumark.escape(content)}</code>`;
    }
}