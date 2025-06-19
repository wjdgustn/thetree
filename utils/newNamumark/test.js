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
const doc = `[[sans \\#1]]
`.trimEnd();
// const doc = `[목차]
// == '''[[1]]2'''3 ==
// [[link]]
// [[파일:홈페이지 아이콘.svg]]
// [include(include)]
// [[분류:테스트#blur]]
// `.trimEnd();
// const doc = ` * '''테이블 정렬''': {{{#14F,#4AF (정렬 위치)}}}`;
// const doc = ` *list\n *second\n\ntext\nwow`;
// const doc = ` *asdf\n\nhi`;

const parser = require('./parser');
const { tokens, result, data } = parser(doc);

console.log(data);

fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2));
fs.writeFileSync('./result.json', JSON.stringify(result, null, 2));