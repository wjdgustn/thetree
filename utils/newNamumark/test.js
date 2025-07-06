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
// const doc = `[[sans \\#1]]
// `.trimEnd();
const doc = ` * 예시 {{{#!wiki style="display: inline; background: linear-gradient(135deg, #1976D2, #0D47A1); padding: 2px 4px; border-radius: 10px;border: 1px solid #0D47A1;"
{{{-1 {{{#fff 예시}}}}}}}}}
 * 예시 {{{#!wiki style="display: inline; background: linear-gradient(135deg, #1976D2, #0D47A1); padding: 2px 4px; border-radius: 10px;border: 1px solid #0D47A1;"
{{{-1 {{{#fff 예시}}}}}}}}}
`.trimEnd();
// const doc = ` * '''테이블 정렬''': {{{#14F,#4AF (정렬 위치)}}}`;
// const doc = ` *list\n *second\n\ntext\nwow`;
// const doc = ` *asdf\n\nhi`;

const parser = require('./parser');
const { tokens, result, data } = parser(doc);

console.log(data);

fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2));
fs.writeFileSync('./result.json', JSON.stringify(result, null, 2));