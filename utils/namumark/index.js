const fs = require('fs');

const utils = require('./utils');
const { Priority } = require('./types');
const listParser = require('./listParser');

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
const ParagraphOpen = '<div class="wiki-paragraph">';
const ParagraphClose = '</div>';
const FullParagraphTag = ParagraphOpen + ParagraphClose;

const NewLineTag = '<newLine/>';
// const BrIsNewLineStart = '<brIsNewLineStart/>';
// const BrIsNewLineEnd = '<brIsNewLineEnd/>';

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
            const nextSyntax = sortedSyntaxes[syntaxIndex + 1];
            const isLastSyntax = syntaxIndex === sortedSyntaxes.length - 1;
            debugLog(`\nparse syntax: ${syntax.name}`);
            // if(text) {
            //     sourceText = text;
            //     text = '';
            // }

            if(syntax.priority === Priority.FullLine
                && syntax.priority !== nextSyntax.priority) {
                sourceText = sourceText
                    .replaceAll('\n<removeNewlineAfterFullline/>', '')
                    .replaceAll('<removeNewlineAfterFullline/>\n', '')
                    .replaceAll('<removeNewlineAfterFullline/>', '');
            }

            if(syntax.fullLine) {
                const lines = sourceText.split('\n');
                const newLines = [];
                let removeNextNewLine = false;
                for(let i in lines) {
                    i = parseInt(i);
                    const line = lines[i];
                    const isLastLine = i === lines.length - 1;

                    let output = await syntax.format(line, this, lines, isLastLine);
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
            else {
                // let brIsNewLineMode = false;

                outer: for (let i = 0; i < sourceText.length; i++) {
                    const char = sourceText[i];
                    const prevChar = sourceText[i - 1];
                    const prevIsNewLineTag = sourceText.slice(i - NewLineTag.length, i) === NewLineTag;
                    // const prevIsbr = sourceText.slice(i - 4, i) === '<br>';
                    // const nextChar = sourceText[i + 1];
                    // const isLineFirstByBr = brIsNewLineMode && prevIsbr;
                    const isLineFirst = prevChar === '\n' || i === 0 || prevIsNewLineTag;

                    if(isLineFirst) {
                        for(let syntaxIndex in openedSyntaxes) {
                            syntaxIndex = parseInt(syntaxIndex);
                            const syntax = openedSyntaxes[syntaxIndex];

                            if(!syntax.allowMultiline) {
                                openedSyntaxes.splice(syntaxIndex, 1);
                            }
                        }
                    }

                    if(char === '\\') {
                        if(!isLastSyntax) text += '\\';
                        text += sourceText[++i] || '';
                        continue;
                    }

                    if(char === '<') {
                        const closeIndex = sourceText.slice(i).indexOf('>');
                        if(closeIndex !== -1) {
                            // const tagStr = sourceText.slice(i, i + closeIndex + 1);

                            // if(tagStr === BrIsNewLineStart) {
                            //     brIsNewLineMode = true;
                            //     console.log('brIsNewLineMode start!');
                            // }
                            // else if(tagStr === BrIsNewLineEnd) {
                            //     brIsNewLineMode = false;
                            //     console.log('brIsNewLineMode end!');
                            // }

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

                    for(let syntaxIndex in openedSyntaxes) {
                        syntaxIndex = parseInt(syntaxIndex);
                        const syntax = openedSyntaxes[syntaxIndex];
                        const currStr = sourceText.slice(i, i + syntax.closeStr.length);

                        if (currStr === syntax.closeStr) {
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
            }

            sourceText = text;
            text = '';
        }

        // console.log('=== 문법 파싱 후 ===');
        // console.log(sourceText);

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

        // console.log('=== paragraph 제어문 처리 후 ===');
        // console.log(text);

        // 리스트
        text = listParser.parse(text);

        // removeNewline 및 특수기능 제거 처리
        text = text
            .replaceAll('<removeNewlineLater/>', '<removeNewline/>')
            .replaceAll('\n<removeNewline/>', '')
            .replaceAll('<removeNewline/>\n', '')
            .replaceAll('<removeNewline/>', '')
            .replaceAll('<newLine/>', '<br>');

            // .replaceAll(BrIsNewLineStart, '')
            // .replaceAll(BrIsNewLineEnd, '');

        // console.log('=== removeNewline 처리 후 ===');
        // console.log(text);

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

        // removeNewLineAfterIndent 처리
        text = text
            .replaceAll('<removeNewLineAfterIndent/>\n', '')
            .replaceAll('\n<removeNewLineAfterIndent/>', '')
            .replaceAll('<removeNewLineAfterIndent/>', '');

        // paragraph 다음 줄바꿈 정리
        text = text.replaceAll(ParagraphOpen + '\n', ParagraphOpen);

        // 빈 paragraph 제거
        text = text.replaceAll('<div class="wiki-paragraph"></div>', '');
        if(text.startsWith(FullParagraphTag)) text = text.slice(FullParagraphTag.length);
        if(text.endsWith(ParagraphOpen)) text = text.slice(0, -ParagraphOpen.length);
        if(text.endsWith(FullParagraphTag)) text = text.slice(0, -FullParagraphTag.length);

        // indent 전 빈 paragraph 제거
        // text = text.replaceAll(FullParagraphTag + '<div class="wiki-indent">', '<div class="wiki-indent">');

        debugLog(`links: ${this.links}`);
        debugLog(`categories: ${this.categories.map(a => JSON.stringify(a))}`);
        debugLog(`footnotes: ${this.footnotes}`);

        let html = `<div class="wiki-content">${
            text
                .replaceAll('\n', '<br>')
                .replaceAll('<br><removebr/>', '')
                .replaceAll('<removebr/>', '')
        }</div>`;

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