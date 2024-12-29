const { Priority } = require('../types');

// const hrSyntax = require('../syntax/hr');
// const tableSyntax = require('../syntax/table');
// const postProcessNoList = require('./index');

const numberedListTypes = {
    '*': '',
    '1.': '',
    'a.': 'wiki-list-alpha',
    'A.': 'wiki-list-upper-alpha',
    'i.': 'wiki-list-roman',
    'I.': 'wiki-list-upper-roman'
}

module.exports = {
    priority: Priority.ChildParser,
    fullContent: true,
    lineIsList: line => line.startsWith(' ')
        && Object.keys(numberedListTypes).some(a => line.trim().startsWith(a)),
    getListTypeStr: line => Object.keys(numberedListTypes).find(a => line.trimStart().startsWith(a)),
    format: async function(sourceText, namumark) {
        // console.log('=== 리스트 파싱 전 ===');
        // console.log(sourceText);

        // const lines = sourceText.split('<newLine/>');
        const lines = sourceText
            // .replaceAll('<!noParagraph>', '<!noParagraph>' + '<tempNewline/><newLine/>')
            // .replaceAll('<!/noParagraph>', '<!/noParagraph>' + '<tempNewline/><newLine/>')
            .split('<newLine/>');
        const newLines = [];
        let listCloseTags = [];
        let openedListSpaces = [];
        let lastListTypeStr = '';
        let lastListSpace = 0;
        // let dontOpenParagraphOnClose = false;
        let dontCloseNoParagraphOnClose = false;

        // let hardcodedTableOpen = false;
        // let continueOne = false;
        for(let i in lines) {
            // if(continueOne) {
            //     continueOne = false;
            //     continue;
            // }

            i = parseInt(i);
            let line = lines[i];
            // console.log('line:', line);

            let newLine = '';
            let prevLine = '';

            const isList = this.lineIsList(line);
            const prevWasList = listCloseTags.length > 0;

            let listSpace = 0;
            for(let i = 0; i < line.length; i++) {
                const char = line[i];
                if(char !== ' ') break;
                listSpace++;
            }

            // if(prevWasList && lastListSpace && !hardcodedTableOpen) {
            //     const indentTableHardcodeOpen = `<removeNewline/></div>${'<div class="wiki-indent">'.repeat(lastListSpace)}<div class="wiki-table-wrap">`;
            //
            //     if(!hardcodedTableOpen && line.startsWith(indentTableHardcodeOpen)) {
            //         // console.log('hardcoded table open');
            //         // console.log(line);
            //         line = `${' '.repeat(lastListSpace)}<div class="wiki-table-wrap">` + line.slice(indentTableHardcodeOpen.length);
            //         listSpace = lastListSpace;
            //         hardcodedTableOpen = true;
            //     }
            // }
            // else if(hardcodedTableOpen) {
            //     const indentTableHardcodeClose = `</table></div>${'</div>'.repeat(lastListSpace)}<div class="wiki-paragraph"><removeNewlineLater/>`;
            //     // console.log('indentTableHardcodeClose:', indentTableHardcodeClose);
            //
            //     listSpace = lastListSpace;
            //
            //     if(line.endsWith(indentTableHardcodeClose)) {
            //         // console.log('close hardcoded table');
            //         line = line.slice(0, -indentTableHardcodeClose.length) + `</table></div><div class="wiki-paragraph"><removeNewlineLater/>`;
            //         // listSpace = lastListSpace;
            //         hardcodedTableOpen = false;
            //         continueOne = true;
            //     }
            // }
            // console.log('listSpace:', listSpace);


            if(isList) {
                const trimedLine = line.trimStart();
                const listTypeStr = this.getListTypeStr(trimedLine);
                let listContent = trimedLine.slice(listTypeStr.length);
                let noStartNum = false;
                if(listContent.startsWith(' ')) {
                    noStartNum = true;
                    listContent = listContent.slice(1);
                }
                // if(hrSyntax.check(listContent)) listContent = hrSyntax.format(listContent);
                // listContent = tableSyntax.parse(listContent);

                // const removeNewParagraph = listContent.includes('<removeNewParagraph/>');
                // if(removeNewParagraph) listContent = listContent.replaceAll('<removeNewParagraph/>', '');
                const removeNoParagraph = listContent.includes('<removeNoParagraph/>');
                if(removeNoParagraph) listContent = listContent.replaceAll('<removeNoParagraph/>', '');

                const noParagraphOpen = removeNoParagraph ? '' : '<!noParagraph>';
                const noParagraphClose = removeNoParagraph ? '' : '<!/noParagraph>';

                const changeList = listTypeStr !== lastListTypeStr || listSpace !== lastListSpace;
                const isIncreasing = listSpace > lastListSpace;
                let level = listCloseTags.length;
                const levelDiff = changeList
                    ? (isIncreasing ? 1 : (openedListSpaces.findIndex(a => a >= listSpace) + 1) - listCloseTags.length)
                    : 0;
                level += levelDiff;
                const indentCount = listSpace - level;

                // console.log(`\nlistTypeStr: ${listTypeStr} listSpace: ${listSpace} lastListSpace: ${lastListSpace} changeList: ${changeList} listTypeStr ${listTypeStr} indentCount: ${indentCount} listContent: ${listContent}`);
                // console.log(`level: ${level} isIncreasing: ${isIncreasing} levelDiff: ${levelDiff}`);

                if(changeList) {
                    if(levelDiff < 0) for(let i = 0; i < -levelDiff; i++) {
                        openedListSpaces.pop();

                        let tag = listCloseTags.pop();
                        if(i > 0) tag = tag.slice('</li>'.length);
                        prevLine += tag;
                    }

                    const needSameLevelReopen =
                        // 인덴트 레벨이 변한 경우
                        (levelDiff === 0 && listSpace !== lastListSpace)
                        // 세는 리스트 타입이 변한 경우
                        || (levelDiff === 0 && lastListTypeStr && listTypeStr !== lastListTypeStr);
                    if(needSameLevelReopen) prevLine += listCloseTags.pop();

                    const needOpen = levelDiff > 0 || listTypeStr !== lastListTypeStr || needSameLevelReopen;
                    // console.log('needOpen:', needOpen);
                    if(levelDiff < 0 && needOpen) prevLine += listCloseTags.pop().slice('</li>'.length);

                    if(needOpen) {
                        const tagName = listTypeStr === '*' ? 'ul' : 'ol';
                        const listClass = numberedListTypes[listTypeStr];

                        let startNum = '';
                        if(tagName === 'ol' && !noStartNum) {
                            const numbers = [...Array(10).keys()].map(a => a.toString());
                            for(let i = 0; i < listContent.length; i++) {
                                const char = listContent[i];
                                // console.log(i, char);
                                if(!i) {
                                    if(char === '#') continue;
                                    break;
                                } else if(!numbers.includes(char)) break;

                                startNum += char;
                            }
                        }

                        if(startNum) listContent = listContent.slice(startNum.length + 2);

                        if(level === 1) {
                            // if(removeNewParagraph) dontOpenParagraphOnClose = true;
                            // if(removeNoParagraph) dontCloseNoParagraphOnClose = true;
                            // else prevLine += noParagraphOpen;
                            prevLine += noParagraphOpen;
                        }
                        prevLine += `${'<div class="wiki-indent">'.repeat(indentCount)}<${tagName} class="${`wiki-list ${listClass}`.trim()}"${startNum ? ` start="${startNum}"` : ''}>`;
                        // console.log(`open list! prevLine: ${prevLine}`);
                        listCloseTags.push(`</li></${tagName}>${'</div>'.repeat(indentCount)}`);
                        openedListSpaces[level - 1] = listSpace;
                    }
                } else {
                    prevLine = `</li>`;
                    // console.log(`close prev item! prevLine: ${prevLine}`);
                }

                // console.log('listContent:', listContent);
                newLine += `<removeNewline/><li>${(await namumark.parse(listContent, true)).html}`;
                // console.log(`add item! newLine: ${newLine}`);

                lastListSpace = listSpace;
                lastListTypeStr = listTypeStr;
            } else {
                if(prevWasList && lastListSpace <= listSpace) {
                    const indentCount = listSpace - lastListSpace;
                    let trimedLine = line.trimStart();
                    const prevContent = newLines.at(-1);
                    // const closeParagraph = dontCloseNoParagraphOnClose ? '</div>' : '<!noParagraph>';
                    const closeParagraph = '</div>';
                    const prevWithoutCloseParagraph = prevContent.slice(0, -(closeParagraph).length);

                    // if(hrSyntax.check(trimedLine)) trimedLine = hrSyntax.format(trimedLine);
                    // trimedLine = tableSyntax.parse(trimedLine);

                    // TODO: 이전 라인과 문법 한번에 처리
                    newLines[newLines.length - 1] = `${prevWithoutCloseParagraph}<newLine/>${'<div class="wiki-indent">'.repeat(indentCount)}${(await namumark.parse(trimedLine, true, true)).html}${'</div>'.repeat(indentCount)}${closeParagraph}`;
                    newLine = null;
                } else {
                    // console.log('close all lists', line);
                    for(let tag of listCloseTags) {
                        prevLine += tag;
                    }
                    listCloseTags = [];
                    openedListSpaces = [];
                    lastListTypeStr = '';
                    lastListSpace = 0;

                    if(prevWasList) {
                        // console.log('prevWasList:', prevWasList);
                        if(!dontCloseNoParagraphOnClose) {
                            prevLine += '<!/noParagraph>';
                            prevLine += '<removeNewline/>';
                        }
                    }
                    dontCloseNoParagraphOnClose = false;

                    newLine += line;
                }
            }

            // 닫는 paragraph 안 지워진 문제 하드코딩
            // if(isLastLine && newLine.endsWith('</div>')) newLine = newLine.slice(0, -'</div>'.length);

            if(newLines.length) newLines[newLines.length - 1] += prevLine;
            else if(prevLine) newLines.push(prevLine);
            if(newLine != null) newLines.push(newLine);
        }

        for(let tag of listCloseTags) {
            newLines[newLines.length - 1] += tag;
        }

        // console.log(newLines);
        // console.log('=== 리스트 파싱 후 ===');
        // console.log(newLines.join('\n'));
        // console.log(`lines.length: ${lines.length} newLines.length: ${newLines.length}`);
        return newLines.join('<newLine/>')/*.replaceAll('<tempNewline/><newLine/>', '')*/;
    }
}