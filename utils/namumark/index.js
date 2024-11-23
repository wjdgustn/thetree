const fs = require('fs');

const utils = require('./utils');

const syntaxDefaultValues = {
    openStr: '',
    openOnlyForLineFirst: false,
    closeStr: '',
    closeOnlyForLineLast: false,
    allowMultiline: false
}

const syntaxes = [];
let syntaxesByLongOpenStr = [];
// let syntaxesByLongCloseStr = [];
const syntaxLoader = (subDir = '') => {
    let syntaxFiles = fs.readdirSync(__dirname + '/syntax' + subDir);
    // if(subDir) {
    //     if(syntaxFiles.includes('index.js')) syntaxFiles = ['index.js'];
    //     else syntaxFiles = syntaxFiles.filter(file => file !== 'index.js');
    // }

    for(let file of syntaxFiles) {
        if(!subDir && file === 'index.js') continue;

        if(file.endsWith('.js')) {
            const syntax = require(__dirname + `/syntax${subDir}/` + file);
            for(let [key, value] of Object.entries(syntaxDefaultValues)) {
                if(!syntax[key]) syntax[key] = value;
            }

            syntax.name = file.replace('.js', '');
            if(subDir) syntax.name = subDir.replaceAll('/', '_').slice(1) + '_' + syntax.name;
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
        syntaxesByLongOpenStr = syntaxes.sort((a, b) => b.openStr.length - a.openStr.length || a.allowMultiline - b.allowMultiline);
        // syntaxesByLongCloseStr = syntaxes.sort((a, b) => b.closeStr.length - a.closeStr.length);
    }
}

syntaxLoader();

module.exports = class NamumarkParser {
    constructor(data = {}) {
        if(data.document) this.document = data.document;
        if(data.aclData) this.aclData = data.aclData;
    }

    async parse(input) {
        console.log('parse!');
        console.time();

        let sourceText = utils.escapeHtml(input);

        let text = '';
        const openedSyntaxes = [];
        outer: for(let i = 0; i < sourceText.length; i++) {
            const char = sourceText[i];
            const prevChar = sourceText[i - 1];
            const nextChar = sourceText[i + 1];
            const isLineFirst = prevChar === '\n' || i === 0;

            if(char === '\\') {
                text += sourceText[++i];
                continue;
            }

            const openedSyntaxesByLength = openedSyntaxes
                .sort((a, b) => b.closeStr.length - a.closeStr.length);
            for(let syntaxIndex in openedSyntaxesByLength) {
                syntaxIndex = parseInt(syntaxIndex);
                const syntax = openedSyntaxesByLength[syntaxIndex];
                const currStr = sourceText.slice(i, i + syntax.closeStr.length);

                if(isLineFirst && !syntax.allowMultiline) {
                    openedSyntaxes.splice(syntaxIndex, 1);
                }
                else if(currStr === syntax.closeStr) {
                    const content = text.slice(syntax.index + syntax.openStr.length, text.length);
                    const sourceContent = sourceText.slice(syntax.sourceIndex + syntax.openStr.length, i);
                    console.log(`${syntax.name} at ${syntax.index} content: "${content}"`);
                    const output = await syntax.format(content, sourceContent);
                    if(output) text = text.slice(0, syntax.index) + output;
                    else text = text.slice(0, syntax.index) + syntax.openStr + content + syntax.closeStr;
                    openedSyntaxes.splice(syntaxIndex, 1);
                    i += syntax.closeStr.length - 1;
                    continue outer;
                }
            }

            for(let syntax of syntaxesByLongOpenStr) {
                const currStr = sourceText.slice(i, i + syntax.openStr.length);
                if(currStr === syntax.openStr) {
                    const item = {
                        ...syntax,
                        index: text.length,
                        sourceIndex: i
                    }
                    const sameOpenedSyntaxIndex = openedSyntaxes.findIndex(s => s.name === syntax.name);

                    if(sameOpenedSyntaxIndex !== -1) openedSyntaxes.splice(sameOpenedSyntaxIndex, 0, item);
                    else openedSyntaxes.push(item);
                    console.log(`opened ${syntax.name} at ${text.length}`);
                    i += syntax.openStr.length - 1;
                    text += syntax.openStr;
                    continue outer;
                }
            }

            text += char;
        }

        console.timeEnd();
        // namumark-block은 ---- 줄 문법으로 분리 시 별도 분리됨
        const result = `<div class="namumark-content"><div class="namumark-block">${text.replaceAll('\n', '<br>')}</div></div>`;
        // console.log(result);
        return result;
    }
}