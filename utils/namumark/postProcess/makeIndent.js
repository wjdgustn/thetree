module.exports = (sourceText, noTopParagraph = false) => {
    let text = '';

    const lines = sourceText
        // .replaceAll(NoParagraphOpen, '<tempNewline/><newLine/>' + NoParagraphOpen)
        // .replaceAll(NoParagraphClose, NoParagraphClose + '<tempNewline/><newLine/>')
        .split('<newLine/>');
    const pendingLines = [];
    // const newLines = [];

    let prevSpaceCount = 0;
    for(let line of lines) {
        let removeNoParagraph = false;
        // if(line.startsWith('<removeNoParagraph/>')) {
        //     line = line.slice('<removeNoParagraph/>'.length);
        //     removeNoParagraph = true;
        // }

        const noParagraphOpen = removeNoParagraph ? '' : '<noParagraph>';
        const noParagraphClose = removeNoParagraph ? '' : '</noParagraph>';

        let spaceCount = 0;
        for(let i = 0; i < line.length; i++) {
            const char = line[i];
            // if(char === '<') {
            //     const closeStr = '>';
            //     const closeIndex = line.slice(i).indexOf(closeStr);
            //     if(closeIndex !== -1) {
            //         i += closeIndex + closeStr.length - 1;
            //         continue;
            //     }
            // }
            if(char !== ' ') break;
            spaceCount++;
        }

        line = line.trimStart();
        console.log('spaceCount:', spaceCount, 'prevSpaceCount:', prevSpaceCount, 'removeNoParagraph',  removeNoParagraph, 'line:', line);

        if(spaceCount !== prevSpaceCount) {
            console.log('different spaceCount! clear pendingLines');
            // newLines.push(pendingLines.join('<newLine/>'));
            // if(removeNoParagraph) text += makeParagraph(pendingLines.join('<newLine/>'));
            // else text += pendingLines.join('<newLine/>');
            text += pendingLines.join('<newLine/>');
            pendingLines.length = 0;

            let newTag = '';
            if(spaceCount > prevSpaceCount) {
                newTag = noParagraphOpen
                    + '<div class="wiki-indent">'.repeat(spaceCount - prevSpaceCount)
                    + noParagraphClose;
            }
            else {
                newTag = noParagraphOpen
                    + '</div>'.repeat(prevSpaceCount - spaceCount)
                    + noParagraphClose;
            }

            if(noTopParagraph && spaceCount === 0) newTag += '<newLine/>';

            // if(newLines.length) newLines[newLines.length - 1] += newTag;
            // else newLines.push(newTag);
            text += newTag;
        }
        pendingLines.push(line);

        prevSpaceCount = spaceCount;
    }
    // if(pendingLines.length) newLines.push(pendingLines.join('<newLine/>'));
    // if(prevSpaceCount) newLines.push('</div>'.repeat(prevSpaceCount));
    if(pendingLines.length) text += pendingLines.join('<newLine/>');
    if(prevSpaceCount) text += '</div>'.repeat(prevSpaceCount) + (noTopParagraph ? '<newLine/>' : '');

    // return newLines.join('<newLine/>');
    return text
    // .replaceAll('<tempNewline/><newLine/>', '')
    // .replaceAll('<tempNewline/>', '');
}