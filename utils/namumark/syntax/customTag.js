const { Priority } = require('../types');

module.exports = {
    priority: Priority.Last,
    openStr: '<[',
    closeStr: ']>',
    escapeOpenAndClose: false,
    format(content, namumark, _, pos, sourceText) {
        const commentPrefix = namumark.commentId ? `tc${namumark.commentId}-` : '';

        if(content === 'tocPos') {
            if(!namumark.tocHtml) {
                namumark.tocHtml = '<div class="wiki-macro-toc">';

                namumark.tocContentHtml = '';
                let indentLevel = 0;
                for(let heading of namumark.headings) {
                    const prevIndentLevel = indentLevel;
                    indentLevel = heading.num.split('.').length;

                    const indentDiff = Math.abs(indentLevel - prevIndentLevel);

                    if(indentLevel > prevIndentLevel) {
                        for(let i = 0; i < indentDiff; i++)
                            namumark.tocContentHtml += '<div class="toc-indent">';
                    }
                    else if(indentLevel < prevIndentLevel) {
                        for(let i = 0; i < indentDiff; i++)
                            namumark.tocContentHtml += '</div>';
                    }

                    namumark.tocContentHtml += `<span class="toc-item"><a href="#${commentPrefix}s-${heading.num}">${heading.num}</a>. ${heading.text}</span>`;
                }

                namumark.tocHtml += namumark.tocContentHtml;

                for(let i = 0; i < indentLevel + 1; i++)
                    namumark.tocHtml += '</div>';
            }

            return namumark.tocHtml;
        }

        if(content === 'footnotePos') {
            const footnoteValues = namumark.footnoteValues;
            const footnoteList = namumark.footnoteList;

            const displayFootnotes = [];
            for(let footnote of [...footnoteList]) {
                const footnoteIndex = sourceText.indexOf(`<span id="${commentPrefix}rfn-${footnote.index}">`);
                if(footnoteIndex > pos) break;

                displayFootnotes.push(footnoteList.shift());
            }

            if(!displayFootnotes.length) return '';

            let html = `<div class="wiki-macro-footnote">`;

            const processedNames = [];
            for(let footnote of displayFootnotes) {
                if(processedNames.includes(footnote.name)) continue;
                processedNames.push(footnote.name);

                html += `<span class="footnote-list"><span id="${commentPrefix}fn-${footnote.name}"></span>`;

                const sameFootnotes = displayFootnotes.filter(a => a.name === footnote.name && a.index !== footnote.index);
                if(sameFootnotes.length) {
                    html += `[${footnote.name}] `;

                    const targetFootnotes = [footnote, ...sameFootnotes];
                    for(let i in targetFootnotes) {
                        i = parseInt(i);
                        const sameFootnote = targetFootnotes[i];
                        html += `${i > 0 ? ' ' : ''}<a href="#${commentPrefix}rfn-${sameFootnote.index}"><sup>${footnote.index}.${i + 1}</sup></a>`;
                    }
                }
                else {
                    html += `<a href="#${commentPrefix}rfn-${footnote.index}">[${footnote.name}]</a>`;
                }

                html += ' ' + (footnoteValues[footnote.name] ?? '') + '</span>';
                delete footnoteValues[footnote.name];
            }
            html += '</div>';

            return html;
        }
    }
}