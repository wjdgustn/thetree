const { Priority } = require('../types');

module.exports = {
    priority: Priority.Last,
    openStr: '<[',
    closeStr: ']>',
    escapeOpenAndClose: false,
    format(content, namumark, pos, sourceText) {
        if(content !== 'footnotePos') return;

        const footnoteValues = namumark.footnoteValues;
        const footnoteList = namumark.footnoteList;

        const displayFootnotes = [];
        for(let footnote of [...footnoteList]) {
            const footnoteIndex = sourceText.indexOf(`<span id="rfn-${footnote.index}">`);
            console.log('pos', pos, 'footnoteIndex', footnoteIndex, 'footnote.index', footnote.index);
            if(footnoteIndex > pos) break;

            displayFootnotes.push(footnoteList.shift());
        }
        console.log(displayFootnotes);

        if(!displayFootnotes.length) return '';

        let html = `<div class="wiki-macro-footnote">`;

        const processedNames = [];
        for(let footnote of displayFootnotes) {
            if(processedNames.includes(footnote.name)) continue;
            processedNames.push(footnote.name);

            html += `<span class="footnote-list"><span id="fn-${footnote.name}"></span>`;

            const sameFootnotes = displayFootnotes.filter(a => a.name === footnote.name && a.index !== footnote.index);
            if(sameFootnotes.length) {
                html += `[${footnote.name}] `;

                const targetFootnotes = [footnote, ...sameFootnotes];
                for(let i in targetFootnotes) {
                    i = parseInt(i);
                    const sameFootnote = targetFootnotes[i];
                    html += `${i > 0 ? ' ' : ''}<a href="#rfn-${sameFootnote.index}"><sup>${footnote.index}.${i + 1}</sup></a>`;
                }
            }
            else {
                html += `<a href="#rfn-${footnote.index}">[${footnote.name}]</a>`;
            }

            html += ' ' + (footnoteValues[footnote.name] ?? '') + '</span>';
            delete footnoteValues[footnote.name];
        }
        html += '</div>';

        return html;
    }
}