const listParser = require('./listParser');

module.exports = text => {
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