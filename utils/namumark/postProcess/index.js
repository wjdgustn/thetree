const makeIndent = require('./makeIndent');
const makeParagraph = require('./makeParagraph');

module.exports = (sourceText, childParse = false, disableNoParagraph = false) => {
    const indentText = makeIndent(sourceText);
    // console.log('== 인덴트 완료 ==');
    // console.log(indentText);
    // require('fs').writeFileSync('indentText.txt', indentText);
    return makeParagraph(indentText, childParse, disableNoParagraph);
}