const {
    validateHTMLColorHex,
    validateHTMLColorName
} = require('validate-color');
const katex = require('katex');
const jsep = require('jsep');

const { SelfClosingTags } = require('./types');

module.exports = {
    escapeHtml: text => (text ?? '')
        .replaceAll('&', "&amp;")
        .replaceAll('<', "&lt;")
        .replaceAll('>', "&gt;")
        .replaceAll(`"`, "&quot;")
        .replaceAll(`'`, "&#039;"),
    unescapeHtml: text => (text ?? '')
        .replaceAll("&amp;", '&')
        .replaceAll("&lt;", '<')
        .replaceAll("&gt;", '>')
        .replaceAll("&quot;", `"`)
        .replaceAll("&#039;", `'`),
    removeEscapedChar: text => {
        let newText = '';
        for(let i = 0; i < text.length; i++) {
            if(text[i] === '\\') {
                i++;
                continue;
            }
            newText += text[i];
        }
        return newText;
    },
    insertText: (text, index, insertText) => {
        return text.slice(0, index) + insertText + text.slice(index);
    },
    parseSize(text) {
        let value = Number(text);
        let unit = 'px';

        if(isNaN(value)) {
            if(text.endsWith('%')) {
                value = parseFloat(text.slice(0, -1));
                unit = '%';
            }
            else if(text.endsWith('px')) {
                value = parseFloat(text.slice(0, -2));
            }
        }
        if(isNaN(value)) return;
        if(value < 0) return;

        return { value, unit };
    },
    validateColor(color) {
        return validateHTMLColorHex(color) || validateHTMLColorName(color);
    },
    parseIncludeParams(text, includeData = {}) {
        let newText = '';
        let textPos = 0;
        while(true) {
            const startPos = text.indexOf('@', textPos);
            if(startPos === -1) break;
            const endPos = text.indexOf('@', startPos + 1);
            if(endPos === -1) break;

            const htmlTagStartPos = text.indexOf('<', textPos);
            if(htmlTagStartPos !== -1 && htmlTagStartPos < endPos) {
                const htmlTagEndPos = text.indexOf('>', htmlTagStartPos);
                if(htmlTagEndPos !== -1) {
                    newText += text.slice(textPos, htmlTagEndPos + 1);
                    textPos = htmlTagEndPos + 1;
                    continue;
                }
            }

            const newLinePos = text.indexOf('<newLine/>', startPos);
            if(newLinePos !== -1 && newLinePos < endPos) {
                newText += text.slice(textPos, newLinePos + '<newLine/>'.length);
                textPos = newLinePos + '<newLine/>'.length;
                continue;
            }

            newText += text.slice(textPos, startPos);
            textPos = endPos + 1;

            const content = text.slice(startPos + 1, endPos);
            const splittedContent = content.split('=');
            const key = splittedContent[0];
            const value = splittedContent.slice(1).join('=');

            if(splittedContent.length > 1 && !value) {
                newText += `@${content}@`;
                continue;
            }

            let finalText = includeData[key] ?? value;
            if(finalText.startsWith(' ')) finalText = '<!s>' + finalText.slice(1);
            newText += finalText;
        }

        newText += text.slice(textPos);

        return newText;
    },
    isPlainHtmlTag(text) {
        // console.log('isPlainHtmlTag text:', text);
        // console.time('isPlainHtmlTag');
        // const $ = cheerio.load(text);
        // let childs = $('body').children();
        // while(childs.length > 0) {
        //     if(childs.length > 1) {
        //         console.timeEnd('isPlainHtmlTag');
        //         return false;
        //     }
        //     childs = childs.children();
        // }
        // console.timeEnd('isPlainHtmlTag');
        // return true;

        console.log('isPlainHtmlTag text:', text);
        console.time('isPlainHtmlTag');
        const tagStack = [];
        let textPos = 0;
        while(true) {
            const startPos = text.indexOf('<', textPos);
            if(startPos === -1) break;
            const endPos = text.indexOf('>', startPos + 1);
            if(endPos === -1) break;

            const tag = text.slice(startPos + 1, endPos);
            if(tag.startsWith('/')) {
                const lastTag = tagStack.pop();
                if(!lastTag || lastTag !== tag.slice(1)) {
                    console.timeEnd('isPlainHtmlTag');
                    return false;
                }
            }
            else if(SelfClosingTags.includes(tag)) {
                continue;
            }
            else {
                tagStack.push(tag);
            }

            textPos = endPos + 1;
        }
        console.timeEnd('isPlainHtmlTag');
        return true;
    },
    removeBackslash: text => {
        let newText = '';
        for(let i = 0; i < text.length; i++) {
            const char = text[i];
            if(char === '\\') {
                newText += text[++i] || '';
                continue;
            }

            newText += char;
        }
        return newText;
    },
    katex: text => katex.renderToString(text, {
        throwOnError: false
    }),
    parseExpression: (expression, data = {}) => {
        let parsed;
        try {
            parsed = jsep(expression);
        } catch (e) {}

        const bool = value => !!value || Number.isNaN(value);

        const parseNode = node => {
            switch(node.type) {
                case 'Literal':
                    return node.value;
                case 'Identifier':
                    switch(node.name) {
                        case 'NaN':
                            return NaN;
                        default:
                            return data[node.name] ?? null;
                    }
                case 'BinaryExpression':
                case 'UnaryExpression': {
                    let left;
                    let right;
                    if(node.type === 'BinaryExpression') {
                        left = parseNode(node.left);
                        right = parseNode(node.right);
                    }
                    else {
                        left = 0;
                        right = parseNode(node.argument);
                    }

                    const bothNum = !isNaN(left) && !isNaN(right);
                    const bothInt = bothNum && !node.left?.raw?.includes('.') && !node.right?.raw?.includes('.');

                    switch(node.operator) {
                        case '==':
                            return left === right;
                        case '!=':
                            return left !== right;
                        case '>':
                            return left > right;
                        case '>=':
                            return left >= right;
                        case '<':
                            return left < right;
                        case '<=':
                            return left <= right;

                        case '&&':
                            return left && right;
                        case '||':
                            return left || right;
                        case '!':
                            return !right;

                        case '+':
                            return Number(left) + Number(right);
                        case '-':
                            return left - right;
                        case '*':
                            return left * right;
                        case '/':
                            if(bothInt)
                                return Math.trunc(left / right);
                            else
                                return left / right;
                        case '%':
                            return left % right;
                        case '**':
                            return left ** right;

                        case '~':
                            return ~right;
                        case '<<':
                            return left << right;
                        case '>>':
                            return left >> right;
                        case '&':
                            if(bothNum) return left & right;
                            return bool(left) && bool(right);
                        case '|':
                            if(bothNum) return left | right;
                            return bool(left) || bool(right);
                        case '^':
                            return left ^ right;
                    }
                }
            }
        }

        const result = parsed ? parseNode(parsed) : null;
        return {
            result,
            bool: bool(result)
        }
    }
}