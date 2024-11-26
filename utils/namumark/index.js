const fs = require('fs');

const utils = require('./utils');
const { Priority } = require('./types');

const syntaxDefaultValues = {
    openStr: '',
    openOnlyForLineFirst: false,
    closeStr: '',
    closeOnlyForLineLast: false,
    allowMultiline: false,
    priority: Priority.Format
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
                if(!syntax[key]) syntax[key] = value;
            }

            syntax.name = file.replace('.js', '');
            if(subDir) syntax.name = subDir.replaceAll('/', '_').slice(1) + '_' + syntax.name;
            if(syntax.name.endsWith('_index')) syntax.name = syntax.name.replace('_index', '');
            syntax.openStr = utils.escapeHtml(syntax.openStr);
            syntax.closeStr = utils.escapeHtml(syntax.closeStr);

            syntaxes.push(syntax);
            console.log(`loaded syntax: ${syntax.name}`);
        }
        else {
            syntaxLoader(subDir + '/' + file);
        }
    }

    if(!subDir) {
        sortedSyntaxes = syntaxes
            .sort((a, b) => b.openStr.length - a.openStr.length || a.allowMultiline - b.allowMultiline)
            .sort((a, b) => b.priority - a.priority);
        // syntaxesByLongCloseStr = syntaxes.sort((a, b) => b.closeStr.length - a.closeStr.length);
    }
}

syntaxLoader();

const skipNamumarkHtmlTags = [
    'code'
]

module.exports = class NamumarkParser {
    constructor(data = {}) {
        if(data.document) this.document = data.document;
        if(data.aclData) this.aclData = data.aclData;
        if(data.req) this.req = data.req;
    }

    async parse(input) {
        console.log('parse!');
        console.time();

        this.links = [];
        this.files = [];
        this.includes = [];

        this.categories = [];

        this.categoryHtmls = [];
        this.footnotes = [];

        let sourceText = utils.escapeHtml(input);

        let text = '';
        const openedSyntaxes = [];
        for(let syntax of sortedSyntaxes) {
            if(text) {
                sourceText = text;
                text = '';
            }

            outer: for (let i = 0; i < sourceText.length; i++) {
                const char = sourceText[i];
                const prevChar = sourceText[i - 1];
                const nextChar = sourceText[i + 1];
                const isLineFirst = prevChar === '\n' || i === 0;

                if (char === '\\') {
                    text += sourceText[++i] || '';
                    continue;
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

                // const openedSyntaxesByLength = openedSyntaxes
                //     .sort((a, b) => b.closeStr.length - a.closeStr.length);
                for (let syntaxIndex in openedSyntaxes) {
                    syntaxIndex = parseInt(syntaxIndex);
                    const syntax = openedSyntaxes[syntaxIndex];
                    const currStr = sourceText.slice(i, i + syntax.closeStr.length);

                    if (isLineFirst && !syntax.allowMultiline) {
                        openedSyntaxes.splice(syntaxIndex, 1);
                    } else if (currStr === syntax.closeStr) {
                        const content = text.slice(syntax.index + syntax.openStr.length, text.length);
                        const sourceContent = sourceText.slice(syntax.sourceIndex + syntax.openStr.length, i);
                        console.log(`${syntax.name} at ${syntax.index} content: "${content}"`);
                        const output = await syntax.format(content, sourceContent, this);
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
                    // const sameOpenedSyntaxIndex = openedSyntaxes.findIndex(s => s.name === syntax.name);

                    openedSyntaxes.unshift(item);
                    console.log(`opened ${syntax.name} at ${text.length}`);
                    i += syntax.openStr.length - 1;
                    text += syntax.openStr;
                    continue;
                }

                text += char;
            }
        }

        console.log(`links: ${this.links}`);
        console.log(`categories: ${this.categories.map(a => JSON.stringify(a))}`);
        console.log(`footnotes: ${this.footnotes}`);

        console.timeEnd();
        // wiki-paragraph은 ---- 줄 문법으로 분리 시 별도 분리됨
        let html = `<div class="wiki-content"><div class="wiki-paragraph">${text.replaceAll('\n', '<br>')}</div></div>`;

        if(this.req?.query.from) html = `
<div class="thetree-alert thetree-alert-primary">
<div class="thetree-alert-content">
<a href="/w/${encodeURIComponent(this.req.query.from)}" rel="nofollow" title="${this.req.query.from}">${utils.escapeHtml(this.req.query.from)}</a>에서 넘어옴
</div>
</div>
        `.replaceAll('\n', '').trim() + html;

        // console.log(html);
        return {
            html,
            links: this.links,
            categories: this.categories,
            footnotes: this.footnotes
        }
    }
}