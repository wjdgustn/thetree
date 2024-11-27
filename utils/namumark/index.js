const fs = require('fs');

const utils = require('./utils');
const { Priority } = require('./types');

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

const syntaxes = [];
let sortedSyntaxes = [];
// let syntaxesByLongCloseStr = [];
const syntaxLoader = (subDir = '') => {
    let syntaxFiles = fs.readdirSync(__dirname + '/syntax' + subDir);
    if(subDir) {
        if(syntaxFiles.includes('index.js')) syntaxFiles = ['index.js'];
        else syntaxFiles = syntaxFiles.filter(file => file !== 'index.js');
    }

    for(let file of syntaxFiles) {
        if(!subDir && file === 'index.js') continue;

        if(file.endsWith('.js')) {
            const syntax = require(__dirname + `/syntax${subDir}/` + file);
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
                        if(output.includes('<removeNextNewLine/>')) {
                            output = output.replace('<removeNextNewLine/>', '');
                            setRemoveNextNewLine = true;
                        }

                        if(output.includes('<removeNewLine/>')) {
                            output = output.replace('<removeNewLine/>', '');
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
                        const output = await syntax.format(content, this);
                        if (output != null) text = text.slice(0, syntax.index) + output;
                        else text = text.slice(0, syntax.index) + syntax.openStr + content + syntax.closeStr;
                        openedSyntaxes.splice(syntaxIndex, 1);
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

        sourceText = ParagraphPosTag + EnterParagraphTag + sourceText;

        let insertPos = 0;
        let nextInsertPos = 0;
        for(let i = 0; i < sourceText.length; i++) {
            const char = sourceText[i];
            const frontStrSample = sourceText.slice(i, i + MaximumParagraphTagLength);

            if(frontStrSample.startsWith(ParagraphPosTag)) {
                const WikiParagraphOpen = '<div class="wiki-paragraph">';
                const WikiParagraphTag = WikiParagraphOpen + '</div>';

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

        text = text.replaceAll('<div class="wiki-paragraph"></div>', '');

        debugLog(`links: ${this.links}`);
        debugLog(`categories: ${this.categories.map(a => JSON.stringify(a))}`);
        debugLog(`footnotes: ${this.footnotes}`);

        // wiki-paragraph은 ---- 줄 문법으로 분리 시 별도 분리됨
        let html = `<div class="wiki-content">${text.replaceAll('\n', '<br>')}</div>`;
        // html = html
        //     .replaceAll('<paragraphPos/>', '[paragraphPos]')
        //     .replaceAll('<exitParagraph/>', '[exitParagraph]');

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