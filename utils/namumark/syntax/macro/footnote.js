const utils = require('../../utils');

module.exports = {
    aliases: ['각주'],
    allowThread: true,
    async format(params, options) {
        const { commentPrefix, Store } = options;

        const footnoteValues = [...Store.footnote.values];
        const footnoteList = [...Store.footnote.list];
        Store.footnote.values.length = 0;
        Store.footnote.list.length = 0;

        if(!footnoteValues.length) return '';

        let result = `<div class="wiki-macro-footnote">`;
        for(let { name, html } of footnoteValues) {
            result += `<span class="footnote-list"><span id="${commentPrefix}fn-${name}"></span>`;

            const sameFootnotes = footnoteList.filter(a => a.name === name);
            const footnote = sameFootnotes[0];
            if(sameFootnotes.length > 1) {
                result += `[${utils.escapeHtml(name)}]`;
                for(let i in sameFootnotes) {
                    i = parseInt(i);
                    const sameFootnote = sameFootnotes[i];
                    result += ` <a href="#${commentPrefix}rfn-${sameFootnote.index}"><sup>${footnote.index}.${i + 1}</sup></a>`;
                }
            }
            else {
                result += `<a href="#${commentPrefix}rfn-${footnote.index}">[${utils.escapeHtml(name)}]</a>`;
            }
            result += ' ' + html + '</span>';
        }
        result += '</div>';

        return result;
    }
}