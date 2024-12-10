const listParser = require('./postProcess/listParser');

module.exports = text => {
    let lines = text
        .replaceAll('<noParagraph>', '<noParagraph>' + '<tempNewline/><newLine/>')
        .replaceAll('</noParagraph>', '</noParagraph>' + '<tempNewline/><newLine/>')
        .split('<newLine/>');

    // wiki 문법 안 인용문 하드코딩
    lines = lines.map(a =>
        a.trimStart().startsWith('&gt;')
            ? a.replace('&gt;', '&gt;<removeNoParagraph/>')
            : a
    );

    // wiki 문법 안 리스트 하드코딩
    let hasList = false;
    const listLines = [];
    lines = lines.map((a, i) => {
        let listTypeStr;
        const result = (listTypeStr = listParser.getListTypeStr(a))
            ? a.replace(listTypeStr, `${listTypeStr}<removeNoParagraph/>`)
            : a;
        if(listTypeStr) {
            hasList = true;
            listLines.push(i);
        }
        return result;
    });

    // 인덴트 하드코딩
    // lines = lines.map((a, i) => {
    //     if(listLines.includes(i) || !a.startsWith(' ')) return a;
    //     return '<removeNoParagraph/>' + a;
    // });

    // include 매크로 하드코딩
    let newText = lines.join('<newLine/>')
        .replaceAll('<tempNewline/><newLine/>', '')
        .replaceAll('<tempNewline/>', '');
    newText = newText.replaceAll('[include(', '[include(<removeNoParagraph/>');

    return {
        text: newText,
        hasList
    }
}