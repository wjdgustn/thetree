const utils = require('../utils');
const { SelfClosingTags } = require('../types');

const NoParagraphOpen = '<!noParagraph>';
const NoParagraphClose = '<!/noParagraph>';
const ParagraphOpen = '<div class="wiki-paragraph">';
const TempParagraphClose = '<paragraphClose/>';
const ParagraphClose = '</div>';

module.exports = (sourceText, namumark, childParse = false, disableNoParagraph = false, options) => {
    if(!childParse && namumark.includeData && !sourceText.includes(NoParagraphOpen))
        disableNoParagraph = true;

    let text = '';

    let paragraphOpened = false;
    let sourceTextPos = 0;
    let cursorPos = 0;
    let nextCursorPos = 0;
    let htmlLevel = 0;
    // const noParagraphLevels = [];
    let noParagraph = false;
    while(sourceTextPos < sourceText.length) {
        // console.log('sourceTextPos:', sourceTextPos, 'sourceText.length:', sourceText.length);
        let newText = '';

        const noParagraphPos = sourceText.indexOf(NoParagraphOpen, sourceTextPos);
        const noParagraphClosePos = sourceText.indexOf(NoParagraphClose, sourceTextPos);
        // const closeParagraphPos = sourceText.indexOf('<closeParagraph/>', sourceTextPos);
        const cursorPosPos = sourceText.indexOf('<!cursorPos/>', sourceTextPos);
        const goToCursorPos = sourceText.indexOf('<!goToCursor/>', sourceTextPos);
        const cursorToEndPos = sourceText.indexOf('<!cursorToEnd/>', sourceTextPos);
        // const posList = [
        //     noParagraphPos,
        //     noParagraphClosePos,
        //     // closeParagraphPos,
        //     cursorPosPos,
        //     goToCursorPos,
        //     cursorToEndPos
        // ].filter(a => a !== -1);

        // const fastestPos = posList.length ? Math.min(...posList) : sourceText.length;

        // if(closeParagraphPos === sourceTextPos) {
        //     if(!paragraphOpened) continue;
        //
        //     text = utils.insertText(text, cursorPos, ParagraphClose);
        //     paragraphOpened = false;
        //     cursorPos += ParagraphClose.length;
        //     sourceTextPos += '<closeParagraph/>'.length;
        //     continue;
        // }
        if(noParagraphPos === sourceTextPos) {
            if(paragraphOpened) {
                text = utils.insertText(text, cursorPos, TempParagraphClose);
                paragraphOpened = false;
                cursorPos += TempParagraphClose.length;
            }
            sourceTextPos += NoParagraphOpen.length;
            // noParagraphLevels.push(htmlLevel);
            noParagraph = true;
            continue;
        }
        else if(noParagraphClosePos === sourceTextPos) {
            // noParagraphLevels.splice(noParagraphLevels.indexOf(htmlLevel), 1);
            noParagraph = false;
            sourceTextPos += NoParagraphClose.length;
            continue;
        }
        else if(cursorPosPos === sourceTextPos) {
            nextCursorPos = text.length;
            sourceTextPos += '<!cursorPos/>'.length;
            continue;
        }
        else if(goToCursorPos === sourceTextPos) {
            cursorPos = nextCursorPos;
            sourceTextPos += '<!goToCursor/>'.length;
            continue;
        }
        else if(cursorToEndPos === sourceTextPos) {
            cursorPos = text.length;
            sourceTextPos += '<!cursorToEnd/>'.length;
            continue;
        }

        // let isHtmlTag = false;
        // let isPlainTextHtmlTag = false;
        if(sourceText[sourceTextPos] === '<') {
            const closePos = sourceText.indexOf('>', sourceTextPos);
            if(closePos !== -1) {
                // isHtmlTag = true;
                const tagStr = sourceText.slice(sourceTextPos + 1, closePos);
                const isSelfClosingTag = tagStr.endsWith('/') || SelfClosingTags.includes(tagStr);
                if(!isSelfClosingTag) {
                    const isCloseTag = tagStr.startsWith('/');
                    htmlLevel += isCloseTag ? -1 : 1;
                    // console.log('tagStr:', tagStr, 'htmlLevel:', htmlLevel);
                    // if(!isSelfClosingTag) {
                    //     const closeTagPos = sourceText.indexOf(`</${tagStr}>`, closePos);
                    //     if(closeTagPos !== -1) {
                    //         const content = sourceText.slice(closePos + 1, closeTagPos);
                    //         isPlainTextHtmlTag = utils.isPlainHtmlTag(content);
                    //     }
                    // }
                }
            }
        }

        if(!paragraphOpened && !noParagraph && !disableNoParagraph) {
            // console.log('open paragraph, noParagraph:', noParagraph, 'htmlLevel:', htmlLevel);
            newText += ParagraphOpen;
            paragraphOpened = true;
        }

        let nextTagPos = sourceText.indexOf('<!', sourceTextPos + 1);
        if(nextTagPos < 0) nextTagPos = sourceText.length;

        newText += sourceText.slice(sourceTextPos, nextTagPos);
        text = utils.insertText(text, cursorPos, newText);
        cursorPos += newText.length;
        sourceTextPos = nextTagPos;
    }
    if(paragraphOpened) text += TempParagraphClose;

    text = text
        .replaceAll(ParagraphOpen + '<newLine/>', ParagraphOpen)
        .replaceAll( '<newLine/>' + TempParagraphClose, TempParagraphClose)

        .replaceAll('<newLine/>' + TempParagraphClose, '</div>')
        .replaceAll(TempParagraphClose, '</div>')

        .replaceAll('<removeNewlineLater/>', '<removeNewline/>')
        .replaceAll('<newLine/><removeNewline/>', '')
        .replaceAll('<removeNewline/><newLine/>', '')
        .replaceAll('<removeNewline/>', '');

    if(!childParse || options.removeNamumarkEscape) text = text
        .replaceAll('<*', '')
        .replaceAll('*>', '')
        .replaceAll('<removeEscape/>\\', '');

    const emptyTempParagraph = ParagraphOpen + ParagraphClose;
    if(text.startsWith(emptyTempParagraph)) text = text.slice(emptyTempParagraph.length);
    if(text.endsWith(emptyTempParagraph)) text = text.slice(0, -emptyTempParagraph.length);

    return text;
}