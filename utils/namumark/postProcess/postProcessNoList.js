const makeIndent = require('./makeIndent');
const makeParagraph = require('./makeParagraph');

module.exports = (sourceText, noTopParagraph = false) => {
    const indentText = makeIndent(sourceText, noTopParagraph);
    // console.log('== 인덴트 완료 ==');
    // console.log(indentText);
    // return indentText;
    return makeParagraph(indentText, noTopParagraph);
}