module.exports = {
    aliases: ['각주'],
    allowThread: true,
    async format(params, options) {
        const { commentPrefix, toHtml, Store } = options;

        const footnoteValues = [...Store.footnote.values];
        const footnoteList = [...Store.footnote.list];
        Store.footnote.values.length = 0;
        Store.footnote.list.length = 0;

        if(!footnoteValues.length) return '';

        let html = `<div class="wiki-macro-footnote">`;
        for(let { name, content } of footnoteValues) {
            html += `<span class="footnote-list"><span id="${commentPrefix}fn-${name}"></span>`;

            const sameFootnotes = footnoteList.filter(a => a.name === name);
            const footnote = sameFootnotes[0];
            if(sameFootnotes.length > 1) {
                html += `[${name}]`;
                for(let i in sameFootnotes) {
                    i = parseInt(i);
                    const sameFootnote = sameFootnotes[i];
                    html += ` <a href="#${commentPrefix}rfn-${sameFootnote.index}"><sup>${footnote.index}.${i + 1}</sup></a>`;
                }
            }
            else {
                html += `<a href="#${commentPrefix}rfn-${footnote.index}">[${name}]</a>`;
            }
            html += ' ' + (await toHtml(content ?? '')) + '</span>';
        }
        html += '</div>';

        return html;
    }
}