module.exports = {
    aliases: ['목차'],
    allowThread: true,
    async format(params, options) {
        const { commentPrefix, toHtml } = options;

        let html = '<div class="wiki-macro-toc">';
        let indentLevel = 0;
        for(let heading of options.headings) {
            const prevIndentLevel = indentLevel;
            indentLevel = heading.actualLevel;

            const indentDiff = Math.abs(indentLevel - prevIndentLevel);

            if(indentLevel !== prevIndentLevel)
                for(let i = 0; i < indentDiff; i++)
                    html += indentLevel > prevIndentLevel ? '<div class="toc-indent">' : '</div>';

            html += `<span class="toc-item"><a href="#${commentPrefix}s-${heading.numText}">${heading.numText}</a>. ${await toHtml(heading.text)}</span>`;
        }
        for(let i = 0; i < indentLevel + 1; i++)
            html += '</div>';
        return html;
    }
}