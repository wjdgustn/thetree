const listParser = require('./listParser');

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
    removeNewParagraphHardcode(text) {
        let lines = text.split('\n');

        // wiki 문법 안 인용문 하드코딩
        lines = lines.map(a =>
            a.trimStart().startsWith('&gt;')
                ? a.replace('&gt;', '&gt;<removeNewParagraph/>')
                : a
        );

        // wiki 문법 안 리스트 하드코딩
        let hasList = false;
        lines = lines.map(a => {
            let listTypeStr;
            const result = (listTypeStr = listParser.getListTypeStr(a))
                ? a.replace(listTypeStr, `${listTypeStr}<removeNewParagraph/>`)
                : a;
            if(listTypeStr) hasList = true;
            return result;
        });

        return {
            text: lines.join('\n'),
            hasList
        }
    }
}