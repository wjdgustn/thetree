const fs = require('fs');

const doc = `
|| [[link|[[file1]][[file2]]]] ||
[[link]]
`.trim();
// const doc = `
// {{{+5 {{{+5 large text}}}}}}
// `.trim();

const parser = require('./parser');
const { tokens, result } = parser(doc);

fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2));
fs.writeFileSync('./result.json', JSON.stringify(result, null, 2));