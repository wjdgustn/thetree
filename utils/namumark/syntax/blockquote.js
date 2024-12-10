const hrSyntax = require('../syntax/hr');
// const makeParagraph = require('../makeParagraph');
const postProcess = require('../postProcess');
const listParser = require('../postProcess/listParser');

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
        const getShouldMakeNewQuote = () => !!quoteLines.length && (!isQuote || lineSpaces !== lastLineSpaces || isLastLine);
        const shouldMakeNewQuote = getShouldMakeNewQuote();

        console.log('lineSpaces:', lineSpaces, 'lastLineSpaces:', lastLineSpaces, ' content:', content);

        let output;
        const makeNewQuote = () => {
            const indentCount = (isQuote && isLastLine) ? lineSpaces : lastLineSpaces;
            let text = quoteLines.join('<newLine/>');

            quoteLines.length = 0;
            namumark.syntaxData.lastLineSpaces = null;
            namumark.syntaxData.lastQuoteLevel = null;

            // wiki 문법 안 인용문 하드코딩
            // const removeNewParagraph = text.includes('<removeNewParagraph/>');
            const removeNoParagraph = text.includes('<removeNoParagraph/>');
            // const needNewline = content.startsWith(' ') || removeNewParagraph;

            // if(removeNewParagraph) text = text.replaceAll('<removeNewParagraph/>', '');
            if(removeNoParagraph) text = text.replaceAll('<removeNoParagraph/>', '');

            const noParagraphOpen = removeNoParagraph ? '' : '<noParagraph>';
            const noParagraphClose = removeNoParagraph ? '' : '</noParagraph>';

            console.log('makeNewQuote! indentCount:', indentCount, 'text:', text);
            output = `
${noParagraphOpen}
${'<div class="wiki-indent">'.repeat(indentCount)}
<blockquote class="wiki-quote">
${noParagraphClose}
${removeNoParagraph ? postProcess(text) : text}
${noParagraphOpen}
</blockquote>
${'</div>'.repeat(indentCount)}
${noParagraphClose}
`
                    // .replaceAll('\n', '')
                    // .replaceAll('<br><removeNewlineLater/>', '')
                    // .replaceAll('<removeNewlineLater/><br>', '')
                + (isQuote ? '' : '<newLine/>' + content + '<newLine/>');
        }

        if(shouldMakeNewQuote && !isLastLine) makeNewQuote();

        if(isQuote) {
            let text = slicedContent.slice('&gt;'.length);
            // const prevLength = text.length;
            text = text.trimStart();
            let quoteLevel = 1;
            // let spaceCount = prevLength - text.length;
            while(text.startsWith('&gt;')) {
                // const prevLength = text.length;
                text = text.slice('&gt;'.length).trimStart();
                // spaceCount = prevLength - text.length;
                quoteLevel++;
            }
            // text = ' '.repeat(spaceCount) + text;
            if(quoteLevel > 8) quoteLevel = 8;
            const lastQuoteLevel = namumark.syntaxData.lastQuoteLevel;

            if(hrSyntax.check(text)) text = hrSyntax.format(text);

            const childQuoteCloseStr = '<noParagraph></blockquote></noParagraph>';

            if(lastQuoteLevel && quoteLevel !== 1 && lastQuoteLevel !== 1) {
                const sliceCount = quoteLevel < lastQuoteLevel
                    ? quoteLevel - 1
                    : lastQuoteLevel - 1;
                const lastQuoteLine = quoteLines.at(-1);
                if(sliceCount > 0) quoteLines[quoteLines.length - 1] = lastQuoteLine.slice(0, -childQuoteCloseStr.length * sliceCount);
            }

            const repeatCount = Math.max(0, quoteLevel - (lastQuoteLevel ?? 1));
            quoteLines.push(
                '<noParagraph>'
                + '<blockquote class="wiki-quote">'.repeat(repeatCount)
                + '</noParagraph>'
                + text
                + childQuoteCloseStr.repeat(quoteLevel - 1)
            );
            namumark.syntaxData.lastLineSpaces = lineSpaces;
            namumark.syntaxData.lastQuoteLevel = quoteLevel;

            if(!shouldMakeNewQuote) output = '';
        }

        if(getShouldMakeNewQuote() && isLastLine) makeNewQuote();

        return output;
    }
}