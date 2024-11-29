const hrSyntax = require('../syntax/hr');

module.exports = {
    fullLine: true,
    format(content, namumark, lines, isLastLine) {
        const quoteLines = namumark.syntaxData.quoteLines ??= [];
        const lastLineSpaces = namumark.syntaxData.lastLineSpaces;

        let lineSpaces = 0;
        for(let i = 0; i < content.length; i++) {
            if(content[i] !== ' ') break;
            lineSpaces++;
        }
        const slicedContent = content.slice(lineSpaces);
        const isQuote = slicedContent.startsWith('&gt;');
        const shouldMakeNewQuote = !!quoteLines.length && (!isQuote || lineSpaces !== lastLineSpaces || isLastLine);

        let output;
        const makeNewQuote = () => {
            console.log('makeNewQuote! quoteLines', quoteLines);
            const indentCount = isLastLine ? lineSpaces : lastLineSpaces;
            const text = quoteLines.join('<br>');

            quoteLines.length = 0;
            namumark.syntaxData.lastLineSpaces = null;
            namumark.syntaxData.lastQuoteLevel = null;

            output = `
<removeNewlineLater/>
</div>
${'<div class="wiki-indent">'.repeat(indentCount)}
<blockquote class="wiki-quote">
<div class="wiki-paragraph">
${text}
</div>
</blockquote>
${'</div>'.repeat(indentCount)}
<div class="wiki-paragraph">
${content.startsWith(' ') ? '<removeNewLineAfterIndent/>' : '<removeNewlineLater/>'}
`
                    .replaceAll('\n', '')
                    .replaceAll('<br><removeNewlineLater/>', '')
                    .replaceAll('<removeNewlineLater/><br>', '')
                + (isQuote ? '' : (content.startsWith(' ') ? '\n' : '') + content + '\n');
        }

        if(shouldMakeNewQuote && !isLastLine) makeNewQuote();

        if(isQuote) {
            let text = slicedContent.slice('&gt;'.length).trimStart();
            let quoteLevel = 1;
            while(text.startsWith('&gt;')) {
                text = text.slice('&gt;'.length).trimStart();
                quoteLevel++;
            }
            if(quoteLevel > 8) quoteLevel = 8;
            const lastQuoteLevel = namumark.syntaxData.lastQuoteLevel;
            console.log('quoteLevel', quoteLevel, 'lastQuoteLevel', lastQuoteLevel, 'text', text);

            if(hrSyntax.check(text)) text = hrSyntax.format(text);

            const childQuoteCloseStr = '</div></blockquote><div class="wiki-paragraph"><removeNewlineLater/>';

            if(lastQuoteLevel && quoteLevel !== 1 && lastQuoteLevel !== 1) {
                const sliceCount = quoteLevel < lastQuoteLevel
                    ? quoteLevel - 1
                    : lastQuoteLevel - 1;
                const lastQuoteLine = quoteLines.at(-1);
                if(sliceCount > 0) quoteLines[quoteLines.length - 1] = lastQuoteLine.slice(0, -childQuoteCloseStr.length * sliceCount);
            }

            const repeatCount = Math.max(0, quoteLevel - (lastQuoteLevel ?? 1));
            quoteLines.push(
                '</div><blockquote class="wiki-quote"><div class="wiki-paragraph">'.repeat(repeatCount)
                + text
                + childQuoteCloseStr.repeat(quoteLevel - 1)
            );
            namumark.syntaxData.lastLineSpaces = lineSpaces;
            namumark.syntaxData.lastQuoteLevel = quoteLevel;

            if(!shouldMakeNewQuote) output = '';
        }

        if(shouldMakeNewQuote && isLastLine) makeNewQuote();

        return output;
    }
}