const fs = require('fs');

const utils = require('./utils');
const { Priority } = require('./types');

const hrSyntax = require('./syntax/hr');

const debugLog = debug ? console.log : (_ => {});

const syntaxDefaultValues = {
    openStr: '',
    openOnlyForLineFirst: false,
    closeStr: '',
    closeOnlyForLineLast: false,
    allowMultiline: false,
    priority: Priority.Format,
    fullLine: false
}

let syntaxes = [];
let sortedSyntaxes = [];
// let syntaxesByLongCloseStr = [];
const syntaxLoader = (subDir = '') => {
    if(!subDir) syntaxes = [];

    let syntaxFiles = fs.readdirSync(__dirname + '/syntax' + subDir);
    if(subDir) {
        if(syntaxFiles.includes('index.js')) syntaxFiles = ['index.js'];
        else syntaxFiles = syntaxFiles.filter(file => file !== 'index.js');
    }

    for(let file of syntaxFiles) {
        if(!subDir && file === 'index.js') continue;

        if(file.endsWith('.js')) {
            const syntaxPath = require.resolve(__dirname + `/syntax${subDir}/` + file);
            if(debug) delete require.cache[syntaxPath];
            const syntax = require(syntaxPath);
            for(let [key, value] of Object.entries(syntaxDefaultValues)) {
                if(!syntax[key]) {
                    syntax[key] = value;

                    if(key === 'priority' && syntax.fullLine) syntax[key] = Priority.FullLine;
                }
            }

            syntax.name = file.replace('.js', '');
            if(subDir) syntax.name = subDir.replaceAll('/', '_').slice(1) + '_' + syntax.name;
            if(syntax.name.endsWith('_index')) syntax.name = syntax.name.replace('_index', '');
            syntax.openStr = utils.escapeHtml(syntax.openStr);
            syntax.closeStr = utils.escapeHtml(syntax.closeStr);

            syntaxes.push(syntax);
            debugLog(`loaded syntax: ${syntax.name}`);
        }
        else {
            syntaxLoader(subDir + '/' + file);
        }
    }

    if(!subDir) {
        sortedSyntaxes = syntaxes
            .sort((a, b) =>
                a.priority - b.priority
                || b.openStr.length - a.openStr.length
                || a.allowMultiline - b.allowMultiline);
        // syntaxesByLongCloseStr = syntaxes.sort((a, b) => b.closeStr.length - a.closeStr.length);
    }
}

syntaxLoader();

const skipNamumarkHtmlTags = [
    'code'
]

let escapeTags = [];
for(let syntax of sortedSyntaxes) {
    if(syntax.openStr) {
        escapeTags = escapeTags.filter(t => !t.startsWith(syntax.openStr));
        escapeTags.push(syntax.openStr);
    }

    if(syntax.closeStr) {
        escapeTags = escapeTags.filter(t => !t.endsWith(syntax.closeStr));
        escapeTags.push(syntax.closeStr);
    }
}

const ParagraphPosTag = '<paragraphPos/>';
const EnterParagraphTag = '<enterParagraph/>';
const ExitParagraphTag = '<exitParagraph/>';

const MaximumParagraphTagLength = Math.max(
    ParagraphPosTag.length,
    EnterParagraphTag.length,
    ExitParagraphTag.length
);

module.exports = class NamumarkParser {
    constructor(data = {}) {
        if(debug) syntaxLoader();

        if(data.document) this.document = data.document;
        if(data.aclData) this.aclData = data.aclData;
        if(data.req) this.req = data.req;
    }

    static escape(str) {
        for(let tag of escapeTags) {
            str = str.replaceAll(tag, `\\${tag}`);
        }

        return str;
    }

    escape(str) {
        return NamumarkParser.escape(str);
    }

    async parseEditorComment(input) {
        const lines = input.split('\n');
        const editorLines = lines.filter(l => l.startsWith('##@ ')).map(l => l.slice(4));
        return await this.parse(editorLines.join('\n'));
    }

    async parse(input) {
        debugLog('parse!');
        if(debug) console.time();

        this.links = [];
        this.files = [];
        this.includes = [];

        this.categories = [];

        this.categoryHtmls = [];
        this.footnotes = [];

        let sourceText = utils.escapeHtml(input);

        if(sourceText.endsWith('\n')) sourceText = sourceText.slice(0, -1);

        // 문법 파싱
        let text = '';
        const openedSyntaxes = [];
        for(let syntaxIndex in sortedSyntaxes) {
            this.syntaxData = {};

            syntaxIndex = parseInt(syntaxIndex);
            const syntax = sortedSyntaxes[syntaxIndex];
            const isLastSyntax = syntaxIndex === sortedSyntaxes.length - 1;
            debugLog(`parse syntax: ${syntax.name}`);
            // if(text) {
            //     sourceText = text;
            //     text = '';
            // }

            if(syntax.fullLine) {
                const lines = sourceText.split('\n');
                const newLines = [];
                let removeNextNewLine = false;
                for(let line of lines) {
                    let output = await syntax.format(line, this, lines);
                    if(output === '') continue;

                    const pushLine = text => {
                        if(removeNextNewLine) {
                            if(!newLines.length) newLines.push(text);
                            else newLines[newLines.length - 1] += text;
                            removeNextNewLine = false;
                        }
                        else newLines.push(text);
                    }

                    let setRemoveNextNewLine = false;
                    if(output != null) {
                        if(output.includes('<removeNextNewline/>')) {
                            output = output.replace('<removeNextNewline/>', '');
                            setRemoveNextNewLine = true;
                        }

                        if(output.includes('<removeNewline/>')) {
                            output = output.replace('<removeNewline/>', '');
                            if(!newLines.length) pushLine(output);
                            else newLines[newLines.length - 1] += output;
                        }
                        else pushLine(output);
                    }
                    else pushLine(line);

                    if(setRemoveNextNewLine) removeNextNewLine = true;
                }
                text = newLines.join('\n');
            }
            else outer: for (let i = 0; i < sourceText.length; i++) {
                const char = sourceText[i];
                const prevChar = sourceText[i - 1];
                // const nextChar = sourceText[i + 1];
                const isLineFirst = prevChar === '\n' || i === 0;

                if (char === '\\') {
                    if(!isLastSyntax) text += '\\';
                    text += sourceText[++i] || '';
                    continue;
                }

                if(char === '<') {
                    const closeIndex = sourceText.slice(i).indexOf('>');
                    if(closeIndex !== -1) {
                        text += sourceText.slice(i, i + closeIndex + 1);
                        i += closeIndex;
                        continue;
                    }
                }

                for(let tag of skipNamumarkHtmlTags) {
                    const openTag = `<${tag}>`;
                    const closeTag = `</${tag}>`;

                    if(sourceText.slice(i).startsWith(openTag)) {
                        const codeEndIndex = sourceText.slice(i).indexOf(closeTag);
                        if(codeEndIndex !== -1) {
                            text += sourceText.slice(i, i + codeEndIndex + closeTag.length);
                            i += codeEndIndex + closeTag.length - 1;
                            continue outer;
                        }
                    }
                }

                for (let syntaxIndex in openedSyntaxes) {
                    syntaxIndex = parseInt(syntaxIndex);
                    const syntax = openedSyntaxes[syntaxIndex];
                    const currStr = sourceText.slice(i, i + syntax.closeStr.length);

                    if (isLineFirst && !syntax.allowMultiline) {
                        openedSyntaxes.splice(syntaxIndex, 1);
                    } else if (currStr === syntax.closeStr) {
                        const content = text.slice(syntax.index + syntax.openStr.length, text.length);
                        debugLog(`${syntax.name} at ${syntax.index} content: "${content}"`);
                        if(content) {
                            const output = await syntax.format(content, this);
                            if(output != null) text = text.slice(0, syntax.index) + output;
                            else text = text.slice(0, syntax.index) + syntax.openStr + content + syntax.closeStr;
                            openedSyntaxes.splice(syntaxIndex, 1);
                        }
                        else {
                            text = text.slice(0, syntax.index) + syntax.openStr + syntax.closeStr;
                            syntax.index = i;
                        }
                        i += syntax.closeStr.length - 1;
                        continue outer;
                    }
                }

                const currStr = sourceText.slice(i, i + syntax.openStr.length);
                if (currStr === syntax.openStr) {
                    const item = {
                        ...syntax,
                        index: text.length,
                        sourceIndex: i
                    }

                    openedSyntaxes.unshift(item);
                    debugLog(`opened ${syntax.name} at ${text.length}`);
                    i += syntax.openStr.length - 1;
                    text += syntax.openStr;
                    continue;
                }

                text += char;
            }

            sourceText = text;
            text = '';
        }

        console.log('=== 문법 파싱 후 ===');
        console.log(sourceText);

        // paragraph 제어문 처리
        sourceText = ParagraphPosTag + EnterParagraphTag + sourceText;
        text = '';

        let insertPos = 0;
        let nextInsertPos = 0;
        for(let i = 0; i < sourceText.length; i++) {
            const char = sourceText[i];
            const frontStrSample = sourceText.slice(i, i + MaximumParagraphTagLength);

            if(frontStrSample.startsWith(ParagraphPosTag)) {
                const WikiParagraphOpen = '<div class="wiki-paragraph"><removeNewline/>\n';
                const WikiParagraphTag = WikiParagraphOpen + '\n<removeNewline/></div>';

                insertPos += WikiParagraphTag.length;

                nextInsertPos = text.length + WikiParagraphOpen.length;
                text += WikiParagraphTag;
                i += ParagraphPosTag.length - 1;
                continue;
            }

            if(frontStrSample.startsWith(EnterParagraphTag)) {
                insertPos = nextInsertPos;
                i += EnterParagraphTag.length - 1;
                continue;
            }

            if(frontStrSample.startsWith(ExitParagraphTag)) {
                insertPos = text.length;
                i += ExitParagraphTag.length - 1;
                continue;
            }

            text = utils.insertText(text, insertPos, char);
            insertPos++;
        }

        console.log('=== paragraph 제어문 처리 후 ===');
        console.log(text);

        // 리스트
        {
            sourceText = text;

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

                    console.log(`\nlistTypeStr: ${listTypeStr} listSpace: ${listSpace} lastListSpace: ${lastListSpace} changeList: ${changeList} listTypeStr ${listTypeStr} indentCount: ${indentCount} listContent: ${listContent}`);
                    console.log(`level: ${level} isIncreasing: ${isIncreasing} levelDiff: ${levelDiff}`);

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
                        console.log('needOpen:', needOpen);
                        if(levelDiff < 0 && needOpen) prevLine += listCloseTags.pop().slice('</li>'.length);

                        if(needOpen) {
                            const tagName = listTypeStr === '*' ? 'ul' : 'ol';
                            const listClass = numberedListTypes[listTypeStr];

                            let startNum = '';
                            if(tagName === 'ol' && !noStartNum) {
                                const numbers = [...Array(10).keys()].map(a => a.toString());
                                for(let i = 0; i < listContent.length; i++) {
                                    const char = listContent[i];
                                    console.log(i, char);
                                    if(!i) {
                                        if(char === '#') continue;
                                        break;
                                    }
                                    else if(!numbers.includes(char)) break;

                                    startNum += char;
                                }
                            }

                            if(startNum) listContent = listContent.slice(startNum.length + 2);

                            if(level === 1) prevLine += '</div>';
                            prevLine += `${'<div class="wiki-indent">'.repeat(indentCount)}<${tagName} class="${`wiki-list ${listClass}`.trim()}"${startNum ? ` start="${startNum}"` : ''}>`;
                            console.log(`open list! prevLine: ${prevLine}`);
                            listCloseTags.push(`</li></${tagName}>${'</div>'.repeat(indentCount)}`);
                            openedListSpaces[level - 1] = listSpace;
                        }
                    }
                    else {
                        prevLine = `</li>`;
                        console.log(`close prev item! prevLine: ${prevLine}`);
                    }

                    newLine += `<removeNewline/><li><div class="wiki-paragraph">${listContent}</div>`;
                    console.log(`add item! newLine: ${newLine}`);

                    lastListSpace = listSpace;
                    lastListTypeStr = listTypeStr;
                }
                else {
                    const prevWasList = listCloseTags.length > 0;

                    if(prevWasList && lastListSpace <= listSpace) {
                        const indentCount = listSpace - lastListSpace;
                        let trimedLine = line.trimStart();
                        const prevContent = newLines.at(-1);
                        const prevWithoutCloseParagraph = prevContent.slice(0, -'</div>'.length);

                        if(hrSyntax.check(trimedLine)) trimedLine = hrSyntax.format(trimedLine);

                        newLines[newLines.length - 1] = `${prevWithoutCloseParagraph}\n${'<div class="wiki-indent">'.repeat(indentCount)}${trimedLine}${'</div>'.repeat(indentCount)}</div>`;
                        newLine = null;
                    }
                    else {
                        for(let tag of listCloseTags) {
                            prevLine += tag;
                        }
                        listCloseTags = [];
                        openedListSpaces = [];
                        lastListTypeStr = '';
                        lastListSpace = 0;

                        if(prevWasList) {
                            console.log('prevWasList:', prevWasList);
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

            console.log(newLines);
            text = newLines.join('\n');
            console.log('=== 리스트 파싱 후 ===');
            console.log(text);
            console.log(`lines.length: ${lines.length} newLines.length: ${newLines.length}`);
        }

        // removeNewline 처리
        text = text
            .replaceAll('<removeNewlineLater/>', '<removeNewline/>')
            .replaceAll('\n<removeNewline/>', '')
            .replaceAll('<removeNewline/>\n', '')
            .replaceAll('<removeNewline/>', '');

        console.log('=== removeNewline 처리 후 ===');
        console.log(text);

        // 인덴트
        {
            sourceText = text;

            const lines = sourceText.split('\n');
            const newLines = [];
            let prevSpaceCount = 0;
            for(let line of lines) {
                let spaceCount = 0;
                for(let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if(char === '<') {
                        const closeStr = '/>';
                        const closeIndex = line.slice(i).indexOf(closeStr);
                        if(closeIndex !== -1) {
                            i += closeIndex + closeStr.length - 1;
                            continue;
                        }
                    }
                    if(char !== ' ') break;
                    spaceCount++;
                }

                line = line.trimStart();

                if(spaceCount > prevSpaceCount) {
                    line = '</div><div class="wiki-indent"><div class="wiki-paragraph">' + line;
                }
                else if(spaceCount < prevSpaceCount) {
                    line = '</div></div><div class="wiki-paragraph">' + line;
                }

                if(!newLines.length || spaceCount === prevSpaceCount) newLines.push(line);
                else newLines[newLines.length - 1] += line;

                prevSpaceCount = spaceCount;
            }

            for(let i = prevSpaceCount; i > 0; i--) {
                newLines[newLines.length - 1] += '</div></div><div class="wiki-paragraph">';
            }

            text = newLines.join('\n');
        }

        // paragraph 다음 줄바꿈 정리
        text = text.replaceAll('<div class="wiki-paragraph">\n', '<div class="wiki-paragraph">');

        // 빈 paragraph 제거
        text = text.replaceAll('<div class="wiki-paragraph"></div>', '');
        if(text.endsWith('<div class="wiki-paragraph">')) text = text.slice(0, -'<div class="wiki-paragraph">'.length);

        debugLog(`links: ${this.links}`);
        debugLog(`categories: ${this.categories.map(a => JSON.stringify(a))}`);
        debugLog(`footnotes: ${this.footnotes}`);

        let html = `<div class="wiki-content">${text.replaceAll('\n', '<br>')}</div>`;

        if(this.req?.query.from) html = `
<div class="thetree-alert thetree-alert-primary">
<div class="thetree-alert-content">
<a href="/w/${encodeURIComponent(this.req.query.from)}" rel="nofollow" title="${this.req.query.from}">${utils.escapeHtml(this.req.query.from)}</a>에서 넘어옴
</div>
</div>
        `.replaceAll('\n', '').trim() + html;

        if(debug) console.timeEnd();

        // debugLog(html);
        return {
            html,
            links: this.links,
            categories: this.categories,
            footnotes: this.footnotes
        }
    }
}