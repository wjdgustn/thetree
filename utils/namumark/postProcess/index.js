const listParser = require('./listParser');
const postProcessNoList = require('./postProcessNoList');

module.exports = (sourceText, noTopParagraph = false) => {
    console.log('postProcess! noTopParagraph:', noTopParagraph, 'sourceText:', sourceText);
    const listText = listParser.parse(sourceText);
    return postProcessNoList(listText, noTopParagraph);
}