const fs = require('fs');

// const doc = `
// || [[link|[[file1]][[file2]]]] ||
// [[link]]
// `.trim();
// const doc = `
// {{{+5 {{{+5 large text}}}}}}
// `.trim();
// TODO: 이거 안 됨, 처음 lexer에서 bold 처리돼서 안 되는 듯?
const doc = `
|| {{{'''굵게'''}}}||
`.trim();
// const doc = `
// [[https://github.com|[[파일:GitHub.png]][[파일:GitHubDark.png]]]]
// {{{#!wiki
// {{{리터럴}}}
// }}}
// `.trim();

const parser = require('./parser');
const { tokens, result, data } = parser(doc);

console.log(data);

fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2));
fs.writeFileSync('./result.json', JSON.stringify(result, null, 2));