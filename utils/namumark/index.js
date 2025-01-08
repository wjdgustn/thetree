const fs = require('fs');

const mainUtils = require('../../utils');
const utils = require('./utils');
const { Priority } = require('./types');
// const listParser = require('./postProcess/listParser');
// const makeParagraph = require('./makeParagraph');
const postProcess = require('./postProcess');

const syntaxDefaultValues = {
    openStr: '',
    openOnlyForLineFirst: false,
    closeStr: '',
    escapeOpenAndClose: true,
    closeOnlyForLineLast: false,
    allowMultiline: false,
    priority: Priority.Format,
    fullLine: false,
    noEscapeChar: false,
    fullContent: false
}

let syntaxes = [];
let sortedSyntaxes = [];
let lastSyntaxCount = 0;
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
                if(syntax[key] == null) {
                    syntax[key] = value;
                }
            }

            syntax.name = file.replace('.js', '');
            if(subDir) syntax.name = subDir.replaceAll('/', '_').slice(1) + '_' + syntax.name;
            if(syntax.name.endsWith('_index')) syntax.name = syntax.name.replace('_index', '');
            if(syntax.escapeOpenAndClose) {
                syntax.openStr = utils.escapeHtml(syntax.openStr);
                syntax.closeStr = utils.escapeHtml(syntax.closeStr);
            }

            syntaxes.push(syntax);
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
        lastSyntaxCount = sortedSyntaxes.filter(a => a.priority === Priority.Last).length;
        // syntaxesByLongCloseStr = syntaxes.sort((a, b) => b.closeStr.length - a.closeStr.length);
    }
}

syntaxLoader();

// const skipNamumarkHtmlTags = [
//     'code'
// ]

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
const RemoveBrTag = '<removebr/>';
const ParagraphOpen = '<div class="wiki-paragraph">';
// const ParagraphOpenStr = ParagraphOpen + RemoveBrTag;
const TempParagraphClose = '<paragraphClose/>';
const ParagraphClose = '</div>';
// const ParagraphCloseStr = RemoveBrTag + ParagraphClose;
const FullParagraphTag = ParagraphOpen + ParagraphClose;
const NoParagraphOpen = '<!noParagraph>';
const NoParagraphClose = '<!/noParagraph>';

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

        if(data.document) {
            if(data.document._id) {
                this.dbDocument = data.document;
                this.document = mainUtils.parseDocumentName(`${data.document.namespace}:${data.document.title}`);
            }
            else
                this.document = data.document;
        }
        if(data.dbDocument) this.dbDocument = data.dbDocument;
        if(data.aclData) this.aclData = data.aclData;
        if(data.req) this.req = data.req;
        if(data.includeData) this.includeData = data.includeData;
        if(data.thread) this.thread = true;
    }

    get NamumarkParser() {
        return module.exports;
    }

    get sortedSyntaxes() {
        return sortedSyntaxes;
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

    get syntaxData() {
        return this.syntaxDataList[this.childDepth];
    }

    async parseEditorComment(input) {
        const lines = input.split('\n');
        const editorLines = lines.filter(l => l.startsWith('##@')).map(l => l.slice(3));
        return await this.parse(editorLines.join('\n'));
    }

    async parse(input, childParse = false, disableNoParagraph = false, cacheOptions = {}) {
        if((debug||true) && !childParse && !this.includeData && !this.thread) console.time(`parse "${this.document.title}"`);

        if(!childParse) {
            this.childDepth = 0;

            this.links = [];
            this.files = [];
            this.includes = [];
            this.redirect = null;

            this.categories = [];

            this.headings = [];
            this.footnoteValues = {};
            this.footnoteList = [];

            this.linkExistsCache = cacheOptions.linkExistsCache ?? [];
            this.fileDocCache = cacheOptions.fileDocCache ?? [];
        }
        else this.childDepth++;

        // if(this.includeData && !childParse) disableNoParagraph = true;

        let sourceText = childParse ? input : utils.escapeHtml(input ?? '');

        if(sourceText.endsWith('\n')) sourceText = sourceText.slice(0, -1);

        sourceText = sourceText.replaceAll('\r', '').replaceAll('\n', NewLineTag);

        // 문법 파싱
        let text = '';
        const openedSyntaxes = [];
        for(let syntaxIndex in sortedSyntaxes) {
            this.syntaxDataList ??= [];
            this.syntaxDataList[this.childDepth] = {};

            syntaxIndex = parseInt(syntaxIndex);
            const syntax = sortedSyntaxes[syntaxIndex];
            const nextSyntax = sortedSyntaxes[syntaxIndex + 1];
            // 각주에 들어가는 이스케이프 문자 제거해야 함, Priority.Last 문법은 이스케이프 문자 영향 안 받음(파싱 중 생성됨)
            const isLastSyntax = syntaxIndex === sortedSyntaxes.length - 1;
            // if(text) {
            //     sourceText = text;
            //     text = '';
            // }

            if(childParse
                && (
                    syntax.priority <= Priority.Footnote
                    || syntax.priority >= Priority.Last
                )) continue;

            if(syntax.fullContent) {
                text = await syntax.format(sourceText, this);
            }
            else if(syntax.fullLine) {
                if(debug && !childParse && !this.includeData && !this.thread) console.time('fullLine ' + syntax.name);
                const lines = sourceText
                    .split(NewLineTag);
                const newLines = [];
                let removeNextNewLine = false;
                for(let i in lines) {
                    i = parseInt(i);
                    const line = lines[i];
                    const isLastLine = i === lines.length - 1;

                    let output = await syntax.format(line, this, lines, isLastLine, i);
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
                        output = output.replaceAll('\n', '');

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
                text = newLines.join(NewLineTag);
                if(debug && !childParse && !this.includeData && !this.thread) console.timeEnd('fullLine ' + syntax.name);
            }
            else {
                // let brIsNewLineMode = false;

                if(debug && !childParse && !this.includeData && !this.thread) console.time('syntax ' + syntax.name);
                outer: for (let i = 0; i < sourceText.length; i++) {
                    const char = sourceText[i];
                    const prevChar = sourceText[i - 1];
                    const nextChar = sourceText[i + 1];
                    const prevIsNewLineTag = sourceText.slice(i - NewLineTag.length, i) === NewLineTag;
                    // const prevIsbr = sourceText.slice(i - 4, i) === '<br>';
                    // const nextChar = sourceText[i + 1];
                    // const isLineFirstByBr = brIsNewLineMode && prevIsbr;
                    const isLineFirst = i === 0 || prevIsNewLineTag;

                    if(isLineFirst) {
                        for(let syntaxIndex in openedSyntaxes) {
                            syntaxIndex = parseInt(syntaxIndex);
                            const syntax = openedSyntaxes[syntaxIndex];

                            if(!syntax.allowMultiline) {
                                openedSyntaxes.splice(syntaxIndex, 1);
                            }
                        }
                    }

                    if((!syntax.noEscapeChar || !openedSyntaxes.length) && char === '\\') {
                        if(!isLastSyntax) text += '\\';
                        text += sourceText[++i] || '';
                        continue;
                    }

                    if(char === '<' && nextChar !== '[') {
                        const closeStr = nextChar === '*' ? '*>' : '>';
                        const closeIndex = sourceText.slice(i).indexOf(closeStr);
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

                            text += sourceText.slice(i, i + closeIndex + closeStr.length);

                            i += closeIndex + closeStr.length - 1;
                            continue;
                        }
                    }

                    // for(let tag of skipNamumarkHtmlTags) {
                    //     const openTag = `<${tag}>`;
                    //     const closeTag = `</${tag}>`;
                    //
                    //     if(sourceText.slice(i).startsWith(openTag)) {
                    //         const codeEndIndex = sourceText.slice(i).indexOf(closeTag);
                    //         if(codeEndIndex !== -1) {
                    //             text += sourceText.slice(i, i + codeEndIndex + closeTag.length);
                    //             i += codeEndIndex + closeTag.length - 1;
                    //             continue outer;
                    //         }
                    //     }
                    // }

                    for(let syntaxIndex in openedSyntaxes) {
                        syntaxIndex = parseInt(syntaxIndex);
                        const syntax = openedSyntaxes[syntaxIndex];
                        const currStr = sourceText.slice(i, i + syntax.closeStr.length);

                        if (currStr === syntax.closeStr) {
                            const content = text.slice(syntax.index + syntax.openStr.length, text.length);
                            const originalContent = sourceText.slice(syntax.sourceIndex + syntax.openStr.length, i);
                            if(content) {
                                let output = await syntax.format(content, this, originalContent, i, sourceText);
                                if(typeof output === 'number') output = output.toString();
                                if(output != null) text = text.slice(0, syntax.index) + output.replaceAll('\n', '');
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
                        i += syntax.openStr.length - 1;
                        text += syntax.openStr;
                        continue;
                    }

                    text += char;
                }
                if(debug && !childParse && !this.includeData && !this.thread) console.timeEnd('syntax ' + syntax.name);
            }

            sourceText = text;
            text = '';

            // Last 직전
            if(!childParse
                && syntax.priority === Priority.Last - 1
                && syntax.priority !== nextSyntax.priority
                && this.footnoteList.length) {
                sourceText += '<!noParagraph><!cursorToEnd/><[footnotePos]><!/noParagraph>';
            }
        }

        // console.log('=== 문법 파싱 후 ===');
        // console.log(sourceText);

        // paragraph 제어문 처리
        // sourceText = ParagraphPosTag + EnterParagraphTag + sourceText;
        // text = '';
        //
        // let insertPos = 0;
        // let nextInsertPos = 0;
        // let sourceTextPos = 0;
        // while(sourceTextPos < sourceText.length) {
        //     const paragraphPosTagPos = sourceText.indexOf(ParagraphPosTag, sourceTextPos);
        //     const enterParagraphTagPos = sourceText.indexOf(EnterParagraphTag, sourceTextPos);
        //     const exitParagraphTagPos = sourceText.indexOf(ExitParagraphTag, sourceTextPos);
        //     const posList = [paragraphPosTagPos, enterParagraphTagPos, exitParagraphTagPos].filter(a => a !== -1);
        //
        //     const fastestPos = posList.length ? Math.min(...posList) : sourceText.length;
        //
        //     if(paragraphPosTagPos === sourceTextPos) {
        //         const WikiParagraphOpen = '<div class="wiki-paragraph"><removeNewline/>\n';
        //         const WikiParagraphTag = WikiParagraphOpen + '\n<removeNewline/></div>';
        //
        //         insertPos += WikiParagraphTag.length;
        //
        //         nextInsertPos = text.length + WikiParagraphOpen.length;
        //         text += WikiParagraphTag;
        //         sourceTextPos += ParagraphPosTag.length;
        //         continue;
        //     }
        //     else if(enterParagraphTagPos === sourceTextPos) {
        //         insertPos = nextInsertPos;
        //         sourceTextPos += EnterParagraphTag.length;
        //         continue;
        //     }
        //     else if(exitParagraphTagPos === sourceTextPos) {
        //         insertPos = text.length;
        //         sourceTextPos += ExitParagraphTag.length;
        //         continue;
        //     }
        //
        //     const newTag = sourceText.slice(sourceTextPos, fastestPos);
        //     text = utils.insertText(text, insertPos, newTag);
        //     insertPos += newTag.length;
        //     sourceTextPos = fastestPos;
        // }

        // console.log('=== paragraph 제어문 처리 후 ===');
        // console.log(text);

        // 리스트
        // text = listParser.parse(sourceText);

        // removeNewline 및 특수기능 제거 처리
        // text = text
            // .replaceAll('<removeNewlineLater/>', '<removeNewline/>')
            // .replaceAll('<newLine/><removeNewline/>', '')
            // .replaceAll('<removeNewline/><newLine/>', '')
            // .replaceAll('<removeNewline/>', '')
            // .replaceAll('<newLine/>', '<br>');

            // .replaceAll(BrIsNewLineStart, '')
            // .replaceAll(BrIsNewLineEnd, '');

        // console.log('=== removeNewline 처리 후 ===');
        // console.log(text);

        // console.log('== 리스트 파싱 후 ==');
        // console.log(text);
        // 인덴트
        if(false){
            sourceText = text;

            const lines = sourceText.split(NewLineTag);
            const newLines = [];
            let prevSpaceCount = 0;
            for(let line of lines) {
                let removeNoParagraph = false;
                if(line.startsWith('<removeNoParagraph/>')) {
                    line = line.slice('<removeNoParagraph/>'.length);
                    removeNoParagraph = true;
                }

                const noParagraphOpen = removeNoParagraph ? '' : '<!noParagraph>';
                const noParagraphClose = removeNoParagraph ? '' : '<!/noParagraph>';

                let spaceCount = 0;
                for(let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if(char === '<') {
                        const closeStr = '>';
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
                    line = noParagraphOpen
                        + '<div class="wiki-indent">'.repeat(spaceCount - prevSpaceCount)
                        + noParagraphClose
                        + line;
                }
                else if(spaceCount < prevSpaceCount) {
                    line = noParagraphOpen
                        + '</div>'.repeat(prevSpaceCount - spaceCount)
                        + noParagraphClose
                        + line;
                }

                if(!newLines.length || spaceCount === prevSpaceCount) newLines.push(line);
                else newLines[newLines.length - 1] += line;

                prevSpaceCount = spaceCount;
            }

            if(prevSpaceCount > 0) {
                newLines[newLines.length - 1] += NoParagraphOpen
                    + '</div>'.repeat(prevSpaceCount)
                    + NoParagraphClose;
            }

            text = newLines.join(NewLineTag);
        }

        // sourceText = text
            // .replaceAll('<newLine/>' + NoParagraphOpen, NoParagraphOpen)
            // .replaceAll(NoParagraphClose + '<newLine/>', NoParagraphClose);
        // text = '';

        // console.log(sourceText);

        text = postProcess(sourceText, this, childParse, disableNoParagraph);

        // console.log(text);

        // removeNewLineAfterIndent 처리
        // text = text
        //     .replaceAll('<removeNewLineAfterIndent/>\n', '')
        //     .replaceAll('\n<removeNewLineAfterIndent/>', '')
        //     .replaceAll('<removeNewLineAfterIndent/>', '');

        // paragraph 다음 줄바꿈 정리
        // text = text.replaceAll(ParagraphOpen + '\n', ParagraphOpen);

        // 빈 paragraph 제거
        // text = text.replaceAll('<div class="wiki-paragraph"></div>', '');
        // if(text.startsWith(FullParagraphTag)) text = text.slice(FullParagraphTag.length);
        // if(text.endsWith(ParagraphOpen)) text = text.slice(0, -ParagraphOpen.length);
        // if(text.endsWith(FullParagraphTag)) text = text.slice(0, -FullParagraphTag.length);

        // indent 전 빈 paragraph 제거
        // text = text.replaceAll(FullParagraphTag + '<div class="wiki-indent">', '<div class="wiki-indent">');

        // 남은 removeNoParagraph 제거
        text = text.replaceAll('<removeNoParagraph/>', '');

        const hasNewline = text.includes(NewLineTag);
        let html = `${(this.includeData || childParse) ? '' : `<div class="wiki-content${this.thread ? ' wiki-thread-content' : ''}">`}${
            text
                .replaceAll(NewLineTag, '<br>')
                .replaceAll('<!s>', ' ')
                // .replaceAll('<br><removebr/>', '')
                // .replaceAll('<removebr/>', '')
        }${(this.includeData || childParse) ? '' : '</div>'}`;

        if((debug||true) && !childParse && !this.includeData && !this.thread) {
            console.timeEnd(`parse "${this.document.title}"`);
            if(debug) console.log();
        }

        this.links = [...new Set(this.links)];
        this.files = [...new Set(this.files)];
        this.includes = [...new Set(this.includes)];

        this.childDepth--;
        return {
            html,
            links: this.links,
            files: this.files,
            includes: this.includes,
            redirect: this.redirect,
            categories: this.categories,
            hasNewline
        }
    }
}