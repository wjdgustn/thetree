const fs = require('fs');

// const doc = `
// || [[link|[[file1]][[file2]]]] ||
// [[link]]
// `.trim();
// const doc = `
// {{{+5 {{{+5 large text}}}}}}
// // `.trim();
// const doc = `
// ||table
// >asdf
// ||
// `.trim();
const doc = `>asdf\n\n\n`;
// const doc = ` *list\n *second\n\ntext\nwow`;
// const doc = `sans\n`;

const parser = require('./parser');
const { tokens, result, data } = parser(doc);

console.log(data);

fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2));
fs.writeFileSync('./result.json', JSON.stringify(result, null, 2));