const utils = require('../utils');

const makeIndent = require('./makeIndent');
const makeParagraph = require('./makeParagraph');

module.exports = (sourceText, namumark, childParse = false, disableNoParagraph = false, options) => {
    sourceText = utils.parseIncludeParams(sourceText, namumark.includeData);

    const indentText = makeIndent(sourceText);
    // console.log('== 인덴트 완료 ==');
    // console.log(indentText);
    // require('fs').writeFileSync('indentText.txt', indentText);
    return makeParagraph(indentText, namumark, childParse, disableNoParagraph, options);
}