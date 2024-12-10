const {
    validateHTMLColorHex,
    validateHTMLColorName
} = require('validate-color');
// const cheerio = require('cheerio');

const { SelfClosingTags } = require('./types');

module.exports = {
    escapeHtml: text => text
        .replaceAll('&', "&amp;")
        .replaceAll('<', "&lt;")
        .replaceAll('>', "&gt;")
        .replaceAll(`"`, "&quot;")
        .replaceAll(`'`, "&#039;"),
    unescapeHtml: text => text
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
    removeHtmlTags: text => text
        .replaceAll(/<[^>]+>/g, ''),
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

            newText += includeData[key] ?? value;
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
    }
}