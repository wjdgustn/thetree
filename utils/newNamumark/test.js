const fs = require('fs');

// const doc = `
// || [[link|[[file1]][[file2]]]] ||
// [[link]]
// `.trim();
// const doc = `
// {{{+5 {{{+5 large text}}}}}}
// `.trim();
const doc = `
{{{#!wiki style="word-break: keep-all;"
|| {{{'''굵게'''}}} || '''굵게 ''' ||{{{#!wiki style="min-width:300px"
작은따옴표(')를 세 번 입력한 상태입니다.}}}||
|| {{{''기울임''}}} || ''기울임'' ||작은따옴표(')를 두 번 입력한 상태입니다.||}}}
||<-6><bgcolor=#00a495><color=#fff> 응용 ||
||<-3> {{{{{{+5 {{{+5 +10단계}}}}}}}}} ||<-3> {{{+5 {{{+5 +10단계}}}}}} ||
`.trim();

const parser = require('./parser');
const { tokens, result, data } = parser(doc);

console.log(data);

fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2));
fs.writeFileSync('./result.json', JSON.stringify(result, null, 2));