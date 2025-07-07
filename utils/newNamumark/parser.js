const {
    createToken,
    Lexer,
    EmbeddedActionsParser
} = require('chevrotain');
const {
    validateHTMLColorHex
} = require('validate-color');

const utils = require('./utils');

const MAXIMUM_DEPTH = 10;

let noCheckStartAtFirst = false;
const fullLineRegex = (regex, { laterRegex } = {}) => {
    const regexStr = regex.toString();
    const checkStart = regexStr[1] === '^';
    const checkEnd = regexStr.includes('$/');

    return ({
        pattern: (text, startOffset) => {
            if(checkStart && startOffset > 0) {
                const prevChar = text[startOffset - 1];
                if(prevChar !== '\r' && prevChar !== '\n')
                    return null;
            }
            else if(checkStart && !startOffset && noCheckStartAtFirst)
                return null;

            const str = text.slice(startOffset);
            const result = str.match(regex);
            if(!result || result.index) return null;

            const nextChar = text.charAt(startOffset + result[0].length);
            if(checkEnd && nextChar && nextChar !== '\r' && nextChar !== '\n')
                return null;

            if(laterRegex && !str.slice(result[0].length).match(laterRegex))
                return null;

            return result;
        },
        line_breaks: checkStart && checkEnd
    });
}

const nestedRegex = (openRegex, closeRegex, allowNewline = false, openCheckRegex = null, closeCheckRegex = null) => {
    openCheckRegex ??= openRegex;
    closeCheckRegex ??= closeRegex;
    openRegex = new RegExp('^' + openRegex.source, 'i');
    closeRegex = new RegExp('(?<!\\\\)(?:\\\\\\\\)*' + closeRegex.source, 'i');

    return ({
        pattern: (text, startOffset) => {
            const str = text.slice(startOffset);
            const openMatch = str.match(openRegex);
            if(!openMatch) return null;

            let tokIndex = openMatch[0].length;
            let openCount = 0;
            while(true) {
                // const openIndex = str.indexOf('[', tokIndex);
                const sliced = str.slice(tokIndex);
                const openMatch = sliced.match(openCheckRegex);
                const openIndex = openMatch ? openMatch.index + tokIndex : -1;
                // const closeIndex = str.indexOf(']', tokIndex);
                const closeMatch = sliced.match(openCount > 0 ? closeCheckRegex : closeRegex);
                const closeIndex = closeMatch ? closeMatch.index + tokIndex : -1;
                // if(openIndex < 0) break;
                if(closeIndex < 0) return null;

                if(openIndex >= 0 && openIndex < closeIndex) openCount++;
                else openCount--;

                if(openCount < 0) {
                    const content = str.slice(0, closeIndex + closeMatch[0].length);
                    if(!allowNewline && content.replace(LiteralRegex, '').includes('\n'))
                        return null;
                    return [content];
                }

                tokIndex = (
                    openIndex >= 0
                        ? Math.min(openIndex + openMatch[0].length, closeIndex + closeMatch[0].length)
                        : closeIndex + closeMatch[0].length
                );
            }
        },
        line_breaks: true
    });
}

const Escape = createToken({
    name: 'Escape',
    pattern: /\\./
});
// const Comment = createToken({
//     name: 'Comment',
//     ...fullLineRegex(/^##(.*)/),
//     group: Lexer.SKIPPED
// });
const Newline = createToken({
    name: 'Newline',
    pattern: /\r?\n/
});
const ListRegex = /^ [1aAiI]\.|^ \*/;
const LineRegex = /[^\r\n]*(\r?\n|\r|$)/g;
const OpenOrClosesRegex = /(?<!\\)(?:\\\\)*{{{|}}}/g;
const List = createToken({
    name: 'List',
    pattern: (text, startOffset) => {
        if(startOffset > 0) {
            const prevChar = text[startOffset - 1];
            if(prevChar !== '\r' && prevChar !== '\n')
                return null;
        }
        const str = text.slice(startOffset);

        const listMatch = str.match(ListRegex);
        if(!listMatch) return null;

        const listStr = listMatch[0];
        const level = listStr.match(/[^ ]/).index;
        const spaces = ' '.repeat(level);

        LineRegex.lastIndex = 0;
        let openCount = 0;
        const getLine = () => {
            const asdf = LineRegex.exec(str);
            let result = asdf[0];
            let newOpenCount = openCount;
            if(result.endsWith('\n')) result = result.slice(0, -1);
            else if(!result) result = null;
            if(result != null) {
                const openOrCloses = (result.match(OpenOrClosesRegex) || []);
                for(let match of openOrCloses) {
                    if(match.endsWith('{'))
                        newOpenCount++;
                    else if(newOpenCount)
                        newOpenCount--;
                }
            }
            return { result, newOpenCount };
        }
        const firstLine = getLine();
        const lines = [firstLine.result];
        const slicedLines = [firstLine.result.slice(1)];
        openCount = firstLine.newOpenCount;

        while(true) {
            const { result, newOpenCount } = getLine();
            const inLiteral = !!openCount;
            if(result == null || (!inLiteral && (!result.startsWith(spaces) || ListRegex.test(result)))) break;
            openCount = newOpenCount;
            lines.push(result);
            slicedLines.push(result.slice(inLiteral ? 0 : 1));
        }

        const result = [lines.join('\n')];
        result.payload = { slicedResult: slicedLines.join('\n') };
        return result;
    },
    line_breaks: true
});
const Indent = createToken({
    name: 'Indent',
    // ...fullLineRegex(/^ (.*)/),
    pattern: (text, startOffset) => {
        if(startOffset > 0) {
            const prevChar = text[startOffset - 1];
            if(prevChar !== '\r' && prevChar !== '\n')
                return null;
        }
        else if(noCheckStartAtFirst) return null;
        const str = text.slice(startOffset);

        if(!str.startsWith(' ')) return null;

        LineRegex.lastIndex = 0;
        let openCount = 0;
        const getLine = () => {
            let result = LineRegex.exec(str)[0];
            if(result.endsWith('\n')) result = result.slice(0, -1);
            else if(!result) result = null;
            let newOpenCount = openCount;
            if(result != null) {
                const openOrCloses = (result.match(OpenOrClosesRegex) || []);
                for(let match of openOrCloses) {
                    if(match.endsWith('{'))
                        newOpenCount++;
                    else if(newOpenCount)
                        newOpenCount--;
                }
            }
            return { result, newOpenCount };
        }
        const firstLine = getLine();
        const lines = [firstLine.result];
        openCount = firstLine.newOpenCount;

        while(true) {
            const { result, newOpenCount } = getLine();
            const inLiteral = !!openCount;
            if(result == null || !inLiteral) break;
            openCount = newOpenCount;
            lines.push(result);
        }

        return [lines.join('\n')];
    },
    line_breaks: true
});
const Text = createToken({
    name: 'Text',
    pattern: /[^\\'\r\n_\[\]~\-^,|{#]+|['\r\n_\[\]~\-^,|{#]/
});

const Heading = createToken({
    name: 'Heading',
    ...fullLineRegex(/^(={1,6})(#)? +(.+?) +\2\1$/m)
});
const Hr = createToken({
    name: 'Hr',
    ...fullLineRegex(/^-{4,9}$/m)
});
const BlockQuote = createToken({
    name: 'BlockQuote',
    ...fullLineRegex(/^>(({{{[\s\S]*?}}}|.)*?)$/m)
});

// const TableRowOpen = createToken({
//     name: 'TableRowOpen',
//     ...fullLineRegex(/^\|\|/, { laterRegex: /\|\|$/m, isTable: true }),
//     push_mode: 'tableMode'
// });
// const TableRowClose = createToken({
//     name: 'TableRowClose',
//     ...fullLineRegex(/\|\|$/m, { isTable: true }),
//     pop_mode: true
// });
const TableSplit = createToken({
    name: 'TableSplit',
    pattern: /\|\|/
});
// {{{}}} 안 * 뒤에 ? 있었음, 넓게 잡으려고 빼 둠
const CaptionRegex = /^\|[\s\S]*?\|/;
const TableRow = createToken({
    name: 'TableRow',
    // ...fullLineRegex(/^\|\|({{{[\s\S]*}}}|[\s\S])*?\|\|$/m)
    pattern: (text, startOffset) => {
        if(startOffset > 0) {
            const prevChar = text[startOffset - 1];
            if(prevChar !== '\r' && prevChar !== '\n')
                return null;
        }

        const str = text.slice(startOffset);
        const captionMatch = str.match(CaptionRegex);
        if(!captionMatch) return null;

        LineRegex.lastIndex = 0;
        let openCount = 0;
        const getLine = () => {
            let result = LineRegex.exec(str)[0];
            if(result.endsWith('\n')) result = result.slice(0, -1);
            else if(!result) result = null;
            if(result != null) {
                const openOrCloses = (result.match(OpenOrClosesRegex) || []);
                for(let match of openOrCloses) {
                    if(match.endsWith('{'))
                        openCount++;
                    else if(openCount)
                        openCount--;
                }
            }
            return result;
        }
        const result = [];
        let breaked = false;
        while(true) {
            const item = getLine();
            if(item == null) break;

            result.push(item);
            if(!openCount
                && item.endsWith('||')
                && !item.endsWith('\\||')
                && (result.length > 1 || item.length > 2)) {
                breaked = true;
                break;
            }
        }
        if(!breaked) return null;

        const arr = [result.join('\n')];
        arr.payload = {
            caption: captionMatch[0].slice(1, -1)
        }
        return arr;
    },
    line_breaks: true,
    start_chars_hint: ['|']
});

const LiteralRegex = /(?<!\\)(?:\\\\)*{{{[\s\S]*}}}/g;
const inlineRegex = (openRegex, closeRegex = null, keepOriginal = false) => {
    let openCloseSame = false;
    if(!closeRegex) {
        openCloseSame = true;
        closeRegex = openRegex;
    }
    openRegex = new RegExp((keepOriginal || (openRegex.source.startsWith('^')) ? '' : '^') + openRegex.source, 'i');
    closeRegex = new RegExp((keepOriginal ? '' : '(?<!\\\\)(?:\\\\\\\\)*') + closeRegex.source, 'i');

    return ({
        pattern: (text, startOffset) => {
            const str = text.slice(startOffset);
            const openMatch = str.match(openRegex);
            if(!openMatch) return null;

            const closeMatch = str.slice(openMatch[0].length).match(closeRegex);
            if(!closeMatch || (openCloseSame && openMatch[0] !== closeMatch[0]))
                return null;

            const content = str.slice(openMatch[0].length, closeMatch.index + openMatch[0].length);
            if(!content || content.replace(LiteralRegex, '').includes('\n'))
                return null;

            const fullMatch = openMatch[0] + content + closeMatch[0];
            return [fullMatch];
        },
        line_breaks: true
    })
}

const Bold = createToken({
    name: 'Bold',
    // pattern: /'''([\s\S]+?)'''/,
    // line_breaks: true
    ...inlineRegex(/'''/),
    start_chars_hint: [`'`]
});
const Italic = createToken({
    name: 'Italic',
    // pattern: /''([\s\S]+?)''/,
    // line_breaks: true
    ...inlineRegex(/''/),
    start_chars_hint: [`'`]
});
const Strike = createToken({
    name: 'Strike',
    // pattern: (text, startOffset) => {
    //     const str = text.slice(startOffset);
    //     const match = str.match(/(~~|--)([\s\S]+?)\1/);
    //     if(!match || match.index > 0) return null;
    //     if(match?.[0][0] === '-') {
    //         const content = match[0].slice(2, -2);
    //         if(!content.replaceAll('-', '').trim()) return null;
    //     }
    //     return match;
    // },
    // line_breaks: true
    ...inlineRegex(/^~~|^--/, /(?<!\\)(?:\\\\)*~~|(?<!\\)(?:\\\\)*--/, true),
    start_chars_hint: ['-', '~']
});
const Underline = createToken({
    name: 'Underline',
    // pattern: /__([\s\S]+?)__/,
    // line_breaks: true
    ...inlineRegex(/__/),
    start_chars_hint: ['_']
});
const Sup = createToken({
    name: 'Sup',
    // pattern: /\^\^([\s\S]+?)\^\^/,
    // line_breaks: true
    ...inlineRegex(/\^\^/),
    start_chars_hint: ['^']
});
const Sub = createToken({
    name: 'Sub',
    // pattern: /,,([\s\S]+?),,/,
    // line_breaks: true
    ...inlineRegex(/,,/),
    start_chars_hint: [',']
});
const ScaleText = createToken({
    name: 'ScaleText',
    ...nestedRegex(/{{{[+-][1-5] /, /}}}/, true, /{{{/),
    start_chars_hint: ['{']
});
const WikiSyntax = createToken({
    name: 'WikiSyntax',
    ...nestedRegex(/{{{#!wiki(\s)+?/, /}}}/, true, /{{{/),
    start_chars_hint: ['{']
});
const SyntaxSyntax = createToken({
    name: 'SyntaxSyntax',
    ...nestedRegex(new RegExp(`{{{#!syntax (${utils.AllowedLanguages.join('|')})`), /}}}/, true, /{{{/),
    start_chars_hint: ['{']
});
const HtmlRegex = /{{{#!html([\s\S]*?)}}}/y;
const HtmlSyntax = createToken({
    name: 'HtmlSyntax',
    pattern: (text, startOffset) => {
        if(Store.thread) return null;
        HtmlRegex.lastIndex = startOffset;
        return HtmlRegex.exec(text);
    },
    start_chars_hint: ['{'],
    line_breaks: true
});
const CommentNumberRegex = /(?<!\S)#\d+/y;
const CommentNumber = createToken({
    name: 'CommentNumber',
    pattern: (text, startOffset) => {
        if(!Store.thread) return null;

        CommentNumberRegex.lastIndex = startOffset;
        return CommentNumberRegex.exec(text);
    },
    start_chars_hint: ['#'],
    line_breaks: false
});
const Folding = createToken({
    name: 'Folding',
    ...nestedRegex(/{{{#!folding(\s)+?/, /}}}/, true, /{{{/),
    start_chars_hint: ['{']
});
const IfSyntax = createToken({
    name: 'IfSyntax',
    ...nestedRegex(/{{{#!if(\s)+?/, /}}}/, true, /{{{/),
    start_chars_hint: ['{']
});
const Literal = createToken({
    name: 'Literal',
    ...nestedRegex(/{{{/, /}}}/, true),
    start_chars_hint: ['{']
});
const LegacyMath = createToken({
    name: 'LegacyMath',
    pattern: /<math>(.*)<\/math>/
});
const Link = createToken({
    name: 'Link',
    // pattern: /\[\[.+?]]|\[\[.*\|[\s\S]+?]]/,
    // line_breaks: true
    ...nestedRegex(/\[\[/, /]]/, true, /\[/, /\]/),
    start_chars_hint: ['[']
});
const Footnote = createToken({
    name: 'Footnote',
    // pattern: /\[\*[\s\S]+?]/,
    // line_breaks: true
    // pattern: (text, startOffset) => {
    //     const str = text.slice(startOffset);
    //     if(!str.startsWith('[*')) return null;
    //
    //     let tokIndex = 2;
    //     let openCount = 0;
    //     while(true) {
    //         const openIndex = str.indexOf('[', tokIndex);
    //         const closeIndex = str.indexOf(']', tokIndex);
    //         // if(openIndex < 0) break;
    //         if(closeIndex < 0) return null;
    //
    //         if(openIndex >= 0 && openIndex < closeIndex) openCount++;
    //         else openCount--;
    //
    //         if(openCount < 0) return [str.slice(0, closeIndex + 1)];
    //
    //         tokIndex = (openIndex >= 0 ? Math.min(openIndex, closeIndex) : closeIndex) + 1;
    //     }
    // },
    // line_breaks: true
    ...nestedRegex(/\[\*/, /]/, false, /\[/),
    start_chars_hint: ['[']
});
const MacroRegex = /\[[^\]]+?\([\s\S]*?\)]|\[\S+?]/y;
const ParamSplitRegex = /(?<!\\),/;
const Macro = createToken({
    name: 'Macro',
    // pattern: /\[\S+?]|\[\S+?\([\s\S]*?\)]/,
    pattern: (text, startOffset) => {
        MacroRegex.lastIndex = startOffset;
        const execResult = MacroRegex.exec(text);
        if(execResult != null) {
            const content = execResult[0].slice(1, -1);

            const openParamIndex = content.indexOf('(');

            let name;
            let params = '';
            let splittedParams = [];
            if(openParamIndex === -1) name = content;
            else {
                if(!content.endsWith(')'))
                    return null;
                name = content.slice(0, openParamIndex);
                params = content.slice(openParamIndex + 1, content.length - 1);
                splittedParams = params.split(ParamSplitRegex).map(a => a.replaceAll(/\\(.)/g, '$1').trim());
            }
            name = name.toLowerCase();
            execResult.payload = {
                name,
                params,
                splittedParams
            }
        }
        if(execResult
            && global.__THETREE__?.macros
            && !global.__THETREE__.macros.includes(execResult.payload.name))
            return null;
        return execResult;
    },
    line_breaks: true,
    start_chars_hint: ['[']
});

const importantTokens = [
    Escape
];

const inlineTokens = [
    ScaleText,
    WikiSyntax,
    SyntaxSyntax,
    HtmlSyntax,
    CommentNumber,
    Folding,
    IfSyntax,
    Literal,
    // Comment,
    Bold,
    Italic,
    Strike,
    Underline,
    Sup,
    Sub,
    Link,
    Footnote,
    Macro,
    LegacyMath,

    Text
];
const inlineLexer = new Lexer([...importantTokens, ...inlineTokens]);

const allTokens = [
    ...importantTokens,

    Newline,
    List,
    Indent,

    Heading,
    // TableRowOpen,
    // TableRowClose,
    // TableSplit,
    TableRow,
    Hr,
    BlockQuote,

    ...inlineTokens
];

const modeGenerator = tokens => ({
    modes: {
        default: tokens
        // default: tokens.filter(a => !['TableRowClose', 'TableSplit'].includes(a.name)),
        // tableMode: tokens.filter(a => !['TableRowOpen'].includes(a.name))
    },
    defaultMode: 'default'
});

const blockLexer = new Lexer(modeGenerator(allTokens.filter(a => !['Heading'].includes(a.name))));
const lexer = new Lexer(modeGenerator(allTokens));

const tableRowLexer = new Lexer([
    ...importantTokens,
    Newline,
    TableSplit,
    ...inlineTokens
]);

const instances = [];
let currDepth = 0;

let Store = {
    links: [],
    categories: [],
    includes: [],
    includeParams: {},
    heading: {
        sectionNum: 0,
        lowestLevel: 6,
        list: [],
        prevLineAdd: 0
    },
    footnote: {
        index: 0,
        values: [],
        list: []
    },
    commentLines: []
}
const originalStore = { ...Store };

class NamumarkParser extends EmbeddedActionsParser {
    constructor() {
        super(allTokens);
        const $ = this;

        this.noTopParagraph = false;

        $.RULE('document', () => {
            const result = [];
            $.AT_LEAST_ONE(() => {
                result.push($.SUBRULE($.rootBlock));
            });

            if(Object.keys(Store.footnote.values).length)
                result.push({
                    type: 'macro',
                    name: 'footnote',
                    footnoteValues: [...Store.footnote.values],
                    footnoteList: [...Store.footnote.list]
                });

            return result;
        });

        $.RULE('blockDocument', () => {
            const result = [];
            let lastIsBr = false;
            $.AT_LEAST_ONE(() => {
                const tok = $.SUBRULE($.block);
                if(Array.isArray(tok)) result.push(...tok);
                else result.push(tok);

                if(this.noTopParagraph && tok.type && tok.type !== 'text') {
                    result.push({
                        type: 'text',
                        text: '\n'
                    });
                    lastIsBr = true;
                }
                else lastIsBr = false;
            });
            if(lastIsBr) result.pop();
            return result;
        });

        $.RULE('block', () => {
            // $.OPTION(() => {
            //     $.CONSUME(Newline);
            // });
            return $.OR([
                { ALT: () => $.SUBRULE($.table) },
                { ALT: () => $.SUBRULE($.hr) },
                { ALT: () => $.SUBRULE($.blockquote) },
                { ALT: () => $.SUBRULE($.list) },
                { ALT: () => $.SUBRULE($.indent) },
                {
                    GATE: () => {
                        const tok = $.LA(1);
                        return tok.tokenType === Macro && tok.payload?.name === 'include';
                    },
                    ALT: () => $.SUBRULE($.include)
                },
                { ALT: () => $.SUBRULE($.paragraph) }
            ]);
        });

        $.RULE('rootBlock', () => {
            // $.OPTION(() => {
            //     $.CONSUME(Newline);
            // });
            return $.OR([
                { ALT: () => $.SUBRULE($.heading) },
                { ALT: () => $.SUBRULE($.block) }
            ]);
        });

        const filterInline = (content, allowLink = false) => {
            const result = [];
            if(!Array.isArray(content)) content = [content];
            for(let item of content) {
                if(item.type === 'text' || (allowLink && item.type === 'link'))
                    result.push(item);
                else {
                    const value = item.parsedText ?? item.content;
                    if(value) result.push(...filterInline(value, allowLink));
                }
            }
            return result;
        }
        const getOriginalLine = (removedLines, newLine) => {
            let left = 0;
            let right = removedLines.length;
            while(left < right) {
                const mid = Math.floor((left + right) / 2);
                if (removedLines[mid] - mid <= newLine) {
                    left = mid + 1;
                } else {
                    right = mid;
                }
            }
            return newLine + left;
        }
        $.RULE('heading', () => {
            const result = $.CONSUME(Heading);
            let str = result.image;
            let level = 0;
            let closed = false;
            while(str.startsWith('=')) {
                level++;
                str = str.slice(1);
            }
            if(str.startsWith('#')) {
                closed = true;
                str = str.slice(1);
            }
            const content = [];
            $.OPTION({
                GATE: () => $.LA(2).tokenType !== Heading,
                DEF: () => $.MANY(() => {
                    content.push($.SUBRULE($.block));
                })
            });

            let text = str.slice(1, -(level + 1 + (closed ? 1 : 0)));
            let linkText;
            let pureText;
            let sectionNum;
            $.ACTION(() => {
                text = parseInline(text);
                linkText = filterInline(text, true);
                pureText = filterInline(text, false);
                if(level < Store.heading.lowestLevel)
                    Store.heading.lowestLevel = level;
                sectionNum = ++Store.heading.sectionNum;
            });

            const obj = {
                type: 'heading',
                line: getOriginalLine(Store.commentLines, result.startLine - 1) + 1,
                level,
                closed,
                sectionNum,
                numText: null,
                text,
                linkText,
                pureText,
                content
            }
            $.ACTION(() => {
                Store.heading.list.push(obj);
            });
            return obj;
        });

        $.RULE('table', () => {
            const rows = [];
            // $.AT_LEAST_ONE(() => {
            //     const items = [];
            //     $.CONSUME(TableRowOpen);
            //     const noTopParagraphBak = this.noTopParagraph;
            //     this.noTopParagraph = false;
            //     $.AT_LEAST_ONE_SEP({
            //         SEP: TableSplit,
            //         DEF: () => items.push([$.SUBRULE($.block)])
            //     });
            //     this.noTopParagraph = noTopParagraphBak;
            //     $.CONSUME(TableRowClose);
            //     $.OPTION(() => {
            //         $.CONSUME(Newline);
            //     });
            //     rows.push(items);
            // });
            let caption = '';
            $.AT_LEAST_ONE({
                GATE: () => !rows.length || !$.LA(1).payload?.caption,
                DEF: () => {
                    const tok = $.CONSUME(TableRow);
                    const captionStr = tok.payload?.caption;
                    const sliced = tok.image.slice(captionStr?.length + 2);
                    if(captionStr) caption = captionStr;

                    const { tokens } = tableRowLexer.tokenize(sliced);
                    const items = [];
                    $.ACTION(() => {
                        let lastIdx = 0;
                        for(let t of tokens) {
                            if(t.tokenType !== TableSplit) continue;

                            const str = sliced.slice(lastIdx, t.startOffset);
                            const testStr = str.replace(/^(<(.*?)>)*/, '');
                            let align;
                            const startsWithSpace = testStr.startsWith(' ');
                            const endsWithSpace = testStr.endsWith(' ');

                            if(startsWithSpace && endsWithSpace) {
                                align ??= 'center';
                                // str = str.slice(1);
                                // str = str.slice(0, -1);
                            } else if(startsWithSpace) {
                                align ??= 'right';
                                // str = str.slice(1);
                            } else if(endsWithSpace) {
                                align ??= 'left';
                                // str = str.slice(0, -1);
                            }

                            items.push({
                                align,
                                value: parseBlock(str, false, true)
                            });
                            lastIdx = t.endOffset + 1;
                        }
                    });
                    rows.push(items);
                    $.OPTION({
                        GATE: () => {
                            const tok = $.LA(2);
                            return tok.tokenType === TableRow;
                        },
                        DEF: () => $.CONSUME(Newline)
                    });
                }
            });
            $.ACTION(() => {
                caption = parseInline(caption);
            });
            return {
                type: 'table',
                caption,
                rows
            }
        });

        $.RULE('hr', () => {
            $.CONSUME(Hr);
            return {
                type: 'hr'
            }
        });

        $.RULE('blockquote', () => {
            const lines = [];
            $.AT_LEAST_ONE(() => {
                lines.push($.CONSUME(BlockQuote).image.slice(1));
                $.OPTION({
                    GATE: () => $.LA(2).tokenType === BlockQuote,
                    DEF: () => $.CONSUME(Newline)
                });
            });
            let content;
            $.ACTION(() => {
                content = parseBlock(lines.join('\n'));
            });
            return {
                type: 'blockquote',
                content
            }
        });

        const ListNumRegex = /^#\d+/;
        $.RULE('list', () => {
            let listType;
            let startNum = 1;
            const items = [];
            const checkNext = (howMuch = 1) => () => {
                const next = $.LA(howMuch);
                if(next.tokenType !== List) return false;
                return !listType || (next.image[1] === listType && !/^#\d+/.test(next.image.slice(3)));
            }
            $.AT_LEAST_ONE({
                GATE: checkNext,
                DEF: () => {
                    const tok = $.CONSUME(List);

                    const isFirst = !listType;
                    let content = tok.payload?.slicedResult ?? tok.image;
                    listType ??= content[0];
                    content = content.slice(listType === '*' ? 1 : 2);

                    if(isFirst) {
                        const match = content.match(ListNumRegex);
                        if(match) {
                            startNum = parseInt(match[0].slice(1));
                            content = content.slice(match[0].length);
                        }
                    }

                    if(content.startsWith(' ')) content = content.slice(1);

                    $.ACTION(() => {
                        content = parseBlock(content);
                    });
                    items.push(content);
                    $.OPTION({
                        GATE: checkNext(2),
                        DEF: () => $.CONSUME(Newline)
                    });
                }
            });

            return {
                type: 'list',
                listType,
                ...(listType === '*' ? {} : { startNum }),
                items
            }
        });

        $.RULE('indent', () => {
            const lines = [];
            $.AT_LEAST_ONE(() => {
                lines.push($.CONSUME(Indent).image.slice(1));
                $.OPTION({
                    GATE: () => $.LA(2).tokenType === Indent,
                    DEF: () => $.CONSUME(Newline)
                });
            });
            let content;
            $.ACTION(() => {
                content = parseBlock(lines.join('\n'));
            });
            return {
                type: 'indent',
                content
            }
        });

        const ParagraphGate = () => {
            const lastTok = $.LA(0);
            const tok = $.LA(1);

            const isInclude = tok.tokenType === Macro && tok.payload.name === 'include';
            return !isInclude || (lastTok.tokenType !== Newline);
        }
        $.RULE('paragraph', () => {
            const lines = [];
            $.AT_LEAST_ONE({
                GATE: ParagraphGate,
                DEF: () => {
                    lines.push($.SUBRULE($.inline));
                }
            });

            const firstText = lines[0][0];
            if(firstText?.type === 'text' && firstText.text.startsWith('\n'))
                firstText.text = firstText.text.slice(1);

            const lastText = lines.at(-1).at?.(-1);
            if(lastText?.type === 'text' && lastText.text.endsWith('\n'))
                lastText.text = lastText.text.slice(0, -1);

            return this.noTopParagraph ? lines : {
                type: 'paragraph',
                lines
            }
        });

        // $.RULE('line', () => {
        //     const result = $.SUBRULE($.inline);
        //     // $.OPTION(() => {
        //     //     $.CONSUME(Newline);
        //     // });
        //     return result;
        // });

        $.RULE('inline', () => {
            const result = [];
            $.AT_LEAST_ONE({
                GATE: ParagraphGate,
                DEF: () => {
                    const tok = $.OR([
                        { ALT: () => $.SUBRULE($.bold) },
                        { ALT: () => $.SUBRULE($.italic) },
                        { ALT: () => $.SUBRULE($.strike) },
                        { ALT: () => $.SUBRULE($.underline) },
                        { ALT: () => $.SUBRULE($.sup) },
                        { ALT: () => $.SUBRULE($.sub) },
                        { ALT: () => $.SUBRULE($.scaleText) },
                        { ALT: () => $.SUBRULE($.wikiSyntax) },
                        { ALT: () => $.SUBRULE($.syntaxSyntax) },
                        { ALT: () => $.SUBRULE($.htmlSyntax) },
                        { ALT: () => $.SUBRULE($.commentNumber) },
                        { ALT: () => $.SUBRULE($.folding) },
                        { ALT: () => $.SUBRULE($.ifSyntax) },
                        { ALT: () => $.SUBRULE($.literal) },
                        { ALT: () => $.SUBRULE($.link) },
                        { ALT: () => $.SUBRULE($.footnote) },
                        { ALT: () => $.SUBRULE($.macro) },
                        { ALT: () => $.SUBRULE($.legacyMath) },
                        { ALT: () => $.SUBRULE($.escape) },
                        { ALT: () => $.SUBRULE($.text) }
                    ]);
                    if(result.at(-1)?.type === 'text' && tok.type === 'text') {
                        result.at(-1).text += tok.text;
                        return;
                    }
                    result.push(tok);
                }
            });
            return result;
        });

        $.RULE('text', () => {
            const tok = $.OR([
                { ALT: () => $.CONSUME(Text) },
                { ALT: () => $.CONSUME(Newline) }
            ]);
            return {
                type: 'text',
                text: tok.image
            }
        });

        $.RULE('escape', () => {
            const tok = $.CONSUME(Escape);
            return {
                type: 'text',
                text: tok.image.slice(1)
            }
        });

        $.RULE('scaleText', () => {
            const tok = $.CONSUME(ScaleText);
            const isSizeUp = tok.image[3] === '+';
            const size = parseInt(tok.image[4]);

            let content = tok.image.slice(6, -3);
            $.ACTION(() => {
                content = parseBlock(content, true);
            });

            return {
                type: 'scaleText',
                isSizeUp,
                size,
                content
            }
        });

        $.RULE('wikiSyntax', () => {
            const tok = $.CONSUME(WikiSyntax);
            const text = tok.image.slice(9, -3);

            const lines = text.split('\n');
            let wikiParamsStr = lines[0].slice(1);
            let content = lines.slice(1).join('\n');

            $.ACTION(() => {
                content = parseBlock(content, true);
            });

            return {
                type: 'wikiSyntax',
                // style,
                // darkStyle,
                wikiParamsStr,
                content
            }
        });

        $.RULE('syntaxSyntax', () => {
            const tok = $.CONSUME(SyntaxSyntax);
            const text = tok.image.slice(12, -3).trim();
            const newLinePos = text.indexOf('\n');

            const lang = text.slice(0, newLinePos);
            const content = text.slice(newLinePos + 1);

            return {
                type: 'syntaxSyntax',
                lang,
                content
            }
        });

        $.RULE('htmlSyntax', () => {
            const tok = $.CONSUME(HtmlSyntax);
            const text = tok.image.slice(9, -3).trim();
            // const safeHtml = utils.sanitizeHtml(text);
            return {
                type: 'htmlSyntax',
                text,
                // safeHtml
            }
        });

        $.RULE('commentNumber', () => {
            const tok = $.CONSUME(CommentNumber);
            const num = parseInt(tok.image.slice(1));
            return {
                type: 'commentNumber',
                num
            }
        });

        $.RULE('folding', () => {
            const tok = $.CONSUME(Folding);
            const fullText = tok.image.slice(12, -3);

            const lines = fullText.split('\n');
            const text = lines[0].slice(1);
            let content = lines.slice(1).join('\n');

            $.ACTION(() => {
                content = parseBlock(content, true);
            });

            return {
                type: 'folding',
                text: text || 'More',
                content
            }
        });

        $.RULE('ifSyntax', () => {
            const tok = $.CONSUME(IfSyntax);
            const text = tok.image.slice(7, -3);

            const lines = text.split('\n');
            const expression = lines[0].slice(1);
            let content = lines.slice(1).join('\n');

            $.ACTION(() => {
                content = parseBlock(content, true);
            });

            return {
                type: 'ifSyntax',
                expression,
                content
            }
        });

        $.RULE('literal', () => {
            const tok = $.CONSUME(Literal);
            const text = tok.image.slice(3, -3);

            const splittedText = text.split(' ');
            if(text.startsWith('#') && splittedText.length > 1) {
                const colorParams = splittedText[0].split(',');

                let color;
                let darkColor;

                if(validateHTMLColorHex(colorParams[0]))
                    color = colorParams[0];
                else if(utils.validateHTMLColorName(colorParams[0].slice(1)))
                    color = colorParams[0].slice(1);
                if(color && (!colorParams[1] || colorParams[1].startsWith('#'))) {
                    if(colorParams[1]) {
                        if(validateHTMLColorHex(colorParams[1]))
                            darkColor = colorParams[1];
                        else if(utils.validateHTMLColorName(colorParams[1].slice(1)))
                            darkColor = colorParams[1].slice(1);
                    }

                    if(!colorParams[1] || darkColor) {
                        let content = splittedText.slice(1).join(' ');
                        $.ACTION(() => {
                            content = parseBlock(content, true);
                        });

                        return {
                            type: 'colorText',
                            color,
                            darkColor,
                            content
                        }
                    }
                }
            }

            return {
                type: 'literal',
                text
            }
        });

        const checkInline = (token, sliceStart, sliceEnd) => {
            const tok = $.CONSUME(token);
            const content = tok.image.slice(sliceStart, sliceEnd);
            let parsedContent;
            $.ACTION(() => {
                parsedContent = parseInline(content);
            });
            return {
                success: true,
                content: parsedContent
            }
        }

        const LinkSplitRegex = /(?<!\\)\|/;
        $.RULE('link', () => {
            const tok = $.CONSUME(Link);
            const content = tok.image.slice(2, -2);
            const splitted = content.split(LinkSplitRegex).map(a => a.replaceAll('\\|', '|'));
            let link = splitted[0].replaceAll('\\]', ']');
            const origParsedText = splitted.slice(1).join('|');
            let parsedText = origParsedText;
            let hash;

            let parsedUrl;
            $.ACTION(() => {
                try {
                    parsedUrl = new URL(link);
                } catch (e) {}
                if(parsedUrl) {
                    if(![
                        'http',
                        'https',
                        'ftp'
                    ].includes(parsedUrl.protocol.slice(0, -1))) parsedUrl = null;
                }
            });

            let newLink = null;
            if(/(?<!\\)#/.test(link)) {
                const arr = link.split(/(?<!\\)#/);
                hash = arr.pop();

                const hashRemoved = arr.join('#').trim();
                if(parsedUrl) newLink = hashRemoved;
                else link = hashRemoved;
            }
            link = link.replaceAll('\\#', '#');

            const text = parsedText || newLink || link;
            $.ACTION(() => {
                parsedText &&= parseInline(parsedText);
            });

            if(origParsedText && origParsedText.replace(LiteralRegex, '').includes('\n')) {
                return [
                    {
                        type: 'text',
                        text: tok.image.slice(0, 2)
                    },
                    parsedText,
                    {
                        type: 'text',
                        text: tok.image.slice(-2)
                    }
                ]
            }

            parsedText ||= [{
                type: 'text',
                text
            }];

            let isCategory = false;
            $.ACTION(() => {
                if(!parsedUrl) {
                    if(link.startsWith('분류:') && !Store.thread) {
                        link = link.slice(3);

                        let blur;
                        if(hash === 'blur') {
                            // link = link.slice(0, -'#blur'.length);
                            blur = true;
                        }
                        else hash = undefined;
                        const newCategory = {
                            document: link,
                            text: origParsedText ? text : undefined,
                            blur
                        }
                        if(!Store.categories.some(a => a.document === link))
                            Store.categories.push(newCategory);
                        isCategory = true;
                    }
                    else {
                        if(!Store.links.includes(link))
                            Store.links.push(link);
                    }
                }
            });
            if(isCategory) return {
                type: 'text',
                text: ''
            }

            return {
                type: 'link',
                content,
                link,
                text,
                hash,
                textExists: !!origParsedText,
                parsedText
            }
        });

        $.RULE('footnote', () => {
            const tok = $.CONSUME(Footnote);
            const content = tok.image.slice(2, -1);
            const splitted = content.split(' ');

            const valueInput = splitted.slice(1).join(' ');

            $.ACTION(() => {
                Store.footnote.index++;
            });
            const index = Store.footnote.index;
            const name = splitted[0] || index.toString();

            let value = Store.footnote.values.find(a => a.name === name)?.content;
            if(value == null) {
                value = valueInput;
                $.ACTION(() => {
                    value = parseInline(value);
                    Store.footnote.values.push({
                        name,
                        content: value
                    });
                });
            }

            $.ACTION(() => {
                Store.footnote.list.push({
                    name,
                    index
                });
            });

            return {
                type: 'footnote',
                name,
                value,
                index
            }
        });

        const parseIncludeParams = splittedParams => {
            const newIncludeData = {};
            for(let param of splittedParams.slice(1)) {
                const splittedParam = param.split('=');
                if(splittedParam.length < 2) continue;

                const key = splittedParam[0].replaceAll(' ', '');
                newIncludeData[key] = splittedParam.slice(1).join('=');
            }
            return newIncludeData;
        }
        $.RULE('macro', () => {
            const tok = $.CONSUME(Macro);
            const { name, splittedParams } = tok.payload || {};

            const data = {};
            $.ACTION(() => {
                if(name === 'include') {
                    const docName = splittedParams[0];
                    Store.includes.push(docName);
                    data.topParagraph = false;
                    data.includeData = parseIncludeParams(splittedParams);
                    const arr = Store.includeParams[docName] ??= [];
                    arr.push(data.includeData);
                }
                else if(name === 'footnote' || name === '각주') {
                    data.footnoteValues = [...Store.footnote.values];
                    data.footnoteList = [...Store.footnote.list];
                    Store.footnote.values.length = 0;
                    Store.footnote.list.length = 0;
                }
                else if(name === 'vote') {
                    data.parsedSplittedParams = splittedParams.map(a => parseInline(a));
                }
            });

            return {
                type: 'macro',
                ...tok.payload,
                image: tok.image,
                ...data
            }
        });

        $.RULE('include', () => {
            const tok = $.CONSUME(Macro);

            let includeData;
            $.ACTION(() => {
                const docName = tok.payload.splittedParams[0];
                Store.includes.push(docName);
                includeData = parseIncludeParams(tok.payload.splittedParams);
                const arr = Store.includeParams[docName] ??= [];
                arr.push(includeData);
            });

            return {
                type: 'macro',
                ...tok.payload,
                image: tok.image,
                topParagraph: true,
                includeData
            }
        });

        const inlineHandler = (name, token, sliceStart, sliceEnd) => {
            const { success, content } = checkInline(token, sliceStart, sliceEnd);
            if(!success) return content;
            return {
                type: name,
                content
            }
        }

        $.RULE('bold', () => inlineHandler('bold', Bold, 3, -3));
        $.RULE('italic', () => inlineHandler('italic', Italic, 2, -2));
        $.RULE('strike', () => inlineHandler('strike', Strike, 2, -2));
        $.RULE('underline', () => inlineHandler('underline', Underline, 2, -2));
        $.RULE('sup', () => inlineHandler('sup', Sup, 2, -2));
        $.RULE('sub', () => inlineHandler('sub', Sub, 2, -2));
        $.RULE('legacyMath', () => {
            const tok = $.CONSUME(LegacyMath);
            const content = tok.image.slice(6, -7);
            return {
                type: 'legacyMath',
                content
            }
        });

        this.performSelfAnalysis();
    }
}

for(let i = 0; i < MAXIMUM_DEPTH; i++)
    instances.push(new NamumarkParser());

const getParser = () => (currDepth >= MAXIMUM_DEPTH - 1) ? null : instances[currDepth++];

const parseInline = text => {
    const lexed = inlineLexer.tokenize(text);
    const inlineParser = getParser();
    if(!inlineParser) return text.split('\n').map(text => [{
        type: 'text',
        text
    }]);
    inlineParser.noTopParagraph = false;
    inlineParser.input = lexed.tokens;
    const result = inlineParser.inline();
    currDepth--;
    // console.log(`"${text}"`);
    // console.log(lexed.tokens);
    // console.log(result);
    return result;
}

const parseBlock = (text, noTopParagraph = false, noLineStart = false) => {
    noCheckStartAtFirst = noLineStart;
    const lexed = blockLexer.tokenize(text);
    noCheckStartAtFirst = false;
    const blockParser = getParser();
    if(!blockParser) {
        const lines = text.split('\n').map(text => [{
            type: 'text',
            text
        }]);
        if(noTopParagraph) return lines;
        else return [{
            type: 'paragraph',
            lines
        }]
    }
    blockParser.noTopParagraph = noTopParagraph;
    blockParser.input = lexed.tokens;
    const result = blockParser.blockDocument();
    currDepth--;
    // console.log(`"${text}"`);
    // console.log(lexed.tokens);
    // console.log(result);
    return result;
}

const parser = new NamumarkParser();

module.exports = (text, { tokens = null, editorComment = false, thread = false, noTopParagraph = false } = {}) => {
    text = text?.replaceAll('\r', '');

    Store = {
        ...structuredClone(originalStore),
        thread
    }

    if(!tokens && text) {
        if(global.debug) console.time('tokenize');
        const preLexed = editorComment ? null : inlineLexer.tokenize(text);
        const lines = text.split('\n');
        const newLines = [];
        for(let i in lines) {
            i = parseInt(i);
            const line = lines[i];
            if(editorComment) {
                if(line.startsWith('##@')) newLines.push(line.slice(3));
                continue;
            }

            if(!line.startsWith('##')) {
                newLines.push(line);
                continue;
            }
            const tok = preLexed.tokens.find(a => a.startLine <= i + 1 && a.endLine >= i + 1);
            if(tok?.tokenType.name === 'Literal')
                newLines.push(line);
            else
                Store.commentLines.push(i);
        }
        text = newLines.join('\n');

        const lexed = lexer.tokenize(text);
        tokens = lexed.tokens;

        if(global.debug) console.timeEnd('tokenize');
    }
    parser.noTopParagraph = noTopParagraph;
    parser.input = tokens ?? [];
    if(global.debug) console.time('cst');
    const result = parser.input.length ? parser.document() : [];
    if(global.debug) console.timeEnd('cst');

    const paragraphNum = [...Array(6 + 1 - Store.heading.lowestLevel)].map(_ => 0);
    for(let heading of Store.heading.list) {
        const paragraphNumTextArr = [];
        for(let i = paragraphNum.length - 1; i > heading.level - Store.heading.lowestLevel; i--) {
            paragraphNum[i] = 0;
        }
        for(let i = 0; i <= heading.level - Store.heading.lowestLevel; i++) {
            if(i === heading.level - Store.heading.lowestLevel) paragraphNum[i]++;

            paragraphNumTextArr.push(paragraphNum[i]);
        }
        heading.numText = paragraphNumTextArr.join('.');
        heading.actualLevel = heading.level - Store.heading.lowestLevel + 1;
    }

    return {
        tokens,
        result,
        data: {
            links: Store.links,
            categories: Store.categories,
            includes: Store.includes,
            includeParams: Store.includeParams,
            headings: Store.heading.list
        }
    }
}