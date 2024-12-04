module.exports = {
    aliases: ['목차'],
    format(_, namumark) {
        if(!namumark.tocHtml) {
            namumark.tocHtml = '<div class="wiki-macro-toc">';

            let indentLevel = 0;
            for(let heading of namumark.headings) {
                const prevIndentLevel = indentLevel;
                indentLevel = heading.num.split('.').length;

                const indentDiff = Math.abs(indentLevel - prevIndentLevel);

                if(indentLevel > prevIndentLevel) {
                    for(let i = 0; i < indentDiff; i++)
                        namumark.tocHtml += '<div class="toc-indent">';
                }
                else if(indentLevel < prevIndentLevel) {
                    for(let i = 0; i < indentDiff; i++)
                        namumark.tocHtml += '</div>';
                }

                namumark.tocHtml += `<span class="toc-item"><a href="#s-${heading.num}">${heading.num}</a>. ${heading.text}</span>`;
            }

            for(let i = 0; i < indentLevel + 1; i++)
                namumark.tocHtml += '</div>';
        }

        console.log(namumark.tocHtml);

        return namumark.tocHtml;
    }
}