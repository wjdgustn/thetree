const Format = require('./format');

const { Priority } = require("../../types");

module.exports = {
    priority: Priority.Literal,
    openStr: `{{{`,
    closeStr: `}}}`,
    allowMultiline: true,
    format: (content, namumark) => {
        if(Format(content)) return null;

        if(content.includes('\n'))
            return `<pre><code>${namumark.escape(content)}</code></pre>`;

        return `<code>${namumark.escape(content)}</code>`;
    }
}