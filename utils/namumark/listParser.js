const hrSyntax = require('./syntax/hr');

module.exports = sourceText => {
    console.log('=== 리스트 파싱 전 ===');
    console.log(sourceText);
    const numberedListTypes = {
        '*': '',
        '1.': '',
        'a.': 'wiki-list-alpha',
        'A.': 'wiki-list-upper-alpha',
        'i.': 'wiki-list-roman',
        'I.': 'wiki-list-upper-roman'
    }

    const lines = sourceText.split('\n');
    const newLines = [];
    let listCloseTags = [];
    let openedListSpaces = [];
    let lastListTypeStr = '';
    let lastListSpace = 0;
    for(let i in lines) {
        i = parseInt(i);
        const line = lines[i];

        let newLine = '';
        let prevLine = '';

        const isList = line.startsWith(' ')
            && Object.keys(numberedListTypes).some(a => line.trim().startsWith(a));

        let listSpace = 0;
        for(let i = 0; i < line.length; i++) {
            const char = line[i];
            if(char !== ' ') break;
            listSpace++;
        }

        if(isList) {
            const trimedLine = line.trimStart();
            const listTypeStr = Object.keys(numberedListTypes).find(a => trimedLine.startsWith(a));
            let listContent = trimedLine.slice(listTypeStr.length);
            let noStartNum = false;
            if(listContent.startsWith(' ')) {
                noStartNum = true;
                listContent = listContent.slice(1);
            }
            if(hrSyntax.check(listContent)) listContent = hrSyntax.format(listContent);

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

                    if(level === 1) prevLine += '</div>';
                    prevLine += `${'<div class="wiki-indent">'.repeat(indentCount)}<${tagName} class="${`wiki-list ${listClass}`.trim()}"${startNum ? ` start="${startNum}"` : ''}>`;
                    // console.log(`open list! prevLine: ${prevLine}`);
                    listCloseTags.push(`</li></${tagName}>${'</div>'.repeat(indentCount)}`);
                    openedListSpaces[level - 1] = listSpace;
                }
            } else {
                prevLine = `</li>`;
                // console.log(`close prev item! prevLine: ${prevLine}`);
            }

            newLine += `<removeNewline/><li><div class="wiki-paragraph">${listContent}</div>`;
            // console.log(`add item! newLine: ${newLine}`);

            lastListSpace = listSpace;
            lastListTypeStr = listTypeStr;
        } else {
            const prevWasList = listCloseTags.length > 0;

            if(prevWasList && lastListSpace <= listSpace) {
                const indentCount = listSpace - lastListSpace;
                let trimedLine = line.trimStart();
                const prevContent = newLines.at(-1);
                const prevWithoutCloseParagraph = prevContent.slice(0, -'</div>'.length);

                if(hrSyntax.check(trimedLine)) trimedLine = hrSyntax.format(trimedLine);

                newLines[newLines.length - 1] = `${prevWithoutCloseParagraph}\n${'<div class="wiki-indent">'.repeat(indentCount)}${trimedLine}${'</div>'.repeat(indentCount)}</div>`;
                newLine = null;
            } else {
                for(let tag of listCloseTags) {
                    prevLine += tag;
                }
                listCloseTags = [];
                openedListSpaces = [];
                lastListTypeStr = '';
                lastListSpace = 0;

                if(prevWasList) {
                    // console.log('prevWasList:', prevWasList);
                    prevLine += '<removeNewline/><div class="wiki-paragraph">';
                }
                newLine += line;
            }
        }

        // 닫는 paragraph 안 지워진 문제 하드코딩
        // if(isLastLine && newLine.endsWith('</div>')) newLine = newLine.slice(0, -'</div>'.length);

        if(newLines.length) newLines[newLines.length - 1] += prevLine;
        else if(prevLine) newLines.push(prevLine);
        if(newLine != null) newLines.push(newLine);
    }

    // console.log(newLines);
    console.log('=== 리스트 파싱 후 ===');
    console.log(newLines.join('\n'));
    // console.log(`lines.length: ${lines.length} newLines.length: ${newLines.length}`);
    return newLines.join('\n');
}