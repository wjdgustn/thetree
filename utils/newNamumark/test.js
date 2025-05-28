const fs = require('fs');

// const doc = `
// || [[link|[[file1]][[file2]]]] ||
// [[link]]
// `.trim();
// const doc = `
// {{{+5 {{{+5 large text}}}}}}
// `.trim();
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