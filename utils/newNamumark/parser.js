const {
    createToken,
    Lexer,
    EmbeddedActionsParser
} = require('chevrotain');
const utils = require('./utils');

// TODO: editor comment

const MAXIMUM_DEPTH = 10;

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

const nestedRegex = (openRegex, closeRegex, allowNewline = false, openCheckRegex = null) => {
    openCheckRegex ??= openRegex;
    openRegex = new RegExp('^' + openRegex.source, 'i');

    return ({
        pattern: (text, startOffset) => {
            // const newlineIndex = text.indexOf('\n', startOffset);
            // const str = text.slice(startOffset, (allowNewline || newlineIndex === -1) ? undefined : newlineIndex);
            // const firstOpen = str.match(openRegex);
            // if(!firstOpen || firstOpen.index) return null;
            //
            // let tokIndex = firstOpen.index + firstOpen[0].length;
            // let openCount = 0;
            // while(true) {
            //     const sliced = str.slice(tokIndex);
            //     const open = sliced.match(openRegex);
            //     const close = sliced.match(closeRegex);
            //     const openIndex = open?.index + tokIndex;
            //     const closeIndex = close?.index + tokIndex;
            //
            //     if(!close) return null;
            //
            //     if(openIndex < closeIndex) openCount++;
            //     else if(openCount) openCount--;
            //
            //     if(!openCount) return [str.slice(firstOpen.index, closeIndex + close[0].length)];
            //
            //     const openEndIndex = openIndex + open?.[0].length;
            //     const closeEndIndex = closeIndex + close[0].length;
            //     if(openEndIndex > closeEndIndex) console.log('openEndIndex is bigger');
            //     tokIndex = openEndIndex ? Math.max(openEndIndex, closeEndIndex) : closeEndIndex;
            //
            //     if(tokIndex > closeIndex) openCount--;
            // }

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
                const closeMatch = sliced.match(closeRegex);
                const closeIndex = closeMatch ? closeMatch.index + tokIndex : -1;
                // if(openIndex < 0) break;
                if(closeIndex < 0) return null;

                if(openIndex >= 0 && openIndex < closeIndex) openCount++;
                else openCount--;

                if(openCount < 0) return [str.slice(0, closeIndex + closeMatch[0].length)];

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
const Comment = createToken({
    name: 'Comment',
    ...fullLineRegex(/^##(.*)/),
    group: Lexer.SKIPPED
});
const Newline = createToken({
    name: 'Newline',
    pattern: /\r?\n/
});
const List = createToken({
    name: 'List',
    pattern: (text, startOffset) => {
        if(startOffset > 0) {
            const prevChar = text[startOffset - 1];
            if(prevChar !== '\r' && prevChar !== '\n')
                return null;
        }
        let str = text.slice(startOffset);

        const listRegex = /^ [1aAiI]\.|^ \*/;
        const listMatch = str.match(listRegex);
        if(!listMatch) return null;

        const listStr = listMatch[0];
        const level = listStr.match(/[^ ]/).index;
        const spaces = ' '.repeat(level);

        const lineRegex = /[^\r\n]*(\r?\n|\r|$)/g;
        const getLine = () => {
            let result = lineRegex.exec(str)[0];
            if(result.endsWith('\n')) result = result.slice(0, -1);
            return result;
        }
        const lines = [getLine()];

        while(true) {
            const line = getLine();
            if(!line || !line.startsWith(spaces) || listRegex.test(line)) break;
            lines.push(line);
        }

        return [lines.join('\n')];
    },
    line_breaks: true
});
const Indent = createToken({
    name: 'Indent',
    ...fullLineRegex(/^ (.*)/)
});
const Text = createToken({
    name: 'Text',
    pattern: /[^\\'\r\n_\[\]~\-^,|]+|['\r\n_\[\]~\-^,|]/
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
    ...fullLineRegex(/^>(.+?)$/m)
});

const TableRowOpen = createToken({
    name: 'TableRowOpen',
    ...fullLineRegex(/^\|\|/, { laterRegex: /\|\|$/m }),
    push_mode: 'tableMode'
});
const TableRowClose = createToken({
    name: 'TableRowClose',
    ...fullLineRegex(/\|\|$/m),
    pop_mode: true
});
const TableSplit = createToken({
    name: 'TableSplit',
    pattern: /\|\|/
});

const Bold = createToken({
    name: 'Bold',
    pattern: /'''([\s\S]+?)'''/,
    line_breaks: true
});
const Italic = createToken({
    name: 'Italic',
    pattern: /''([\s\S]+?)''/,
    line_breaks: true
});
const Strike = createToken({
    name: 'Strike',
    pattern: /(~~|--)([\s\S]+?)\1/,
    line_breaks: true
});
const Underline = createToken({
    name: 'Underline',
    pattern: /__([\s\S]+?)__/,
    line_breaks: true
});
const Sup = createToken({
    name: 'Sup',
    pattern: /\^\^([\s\S]+?)\^\^/,
    line_breaks: true
});
const Sub = createToken({
    name: 'Sub',
    pattern: /,,([\s\S]+?),,/,
    line_breaks: true
});
const ScaleText = createToken({
    name: 'ScaleText',
    ...nestedRegex(/{{{[+-][1-5] /, /}}}/, true, /{{{/)
});
const WikiSyntax = createToken({
    name: 'WikiSyntax',
    ...nestedRegex(/{{{#!wiki(\s)+?/, /}}}/, true, /{{{/)
});
const HtmlSyntax = createToken({
    name: 'HtmlSyntax',
    pattern: /{{{#!html([\s\S]*)}}}/,
    line_breaks: true
});
const Folding = createToken({
    name: 'Folding',
    ...nestedRegex(/{{{#!folding(\s)+?/, /}}}/, true, /{{{/)
});
const IfSyntax = createToken({
    name: 'IfSyntax',
    ...nestedRegex(/{{{#!if(\s)+?/, /}}}/, true, /{{{/)
});
const Literal = createToken({
    name: 'Literal',
    ...nestedRegex(/{{{/, /}}}/, true)
});
const LegacyMath = createToken({
    name: 'LegacyMath',
    pattern: /<math>(.*)<\/math>/
});
const Link = createToken({
    name: 'Link',
    // pattern: /\[\[.+?]]|\[\[.*\|[\s\S]+?]]/,
    // line_breaks: true
    ...nestedRegex(/\[\[/, /]]/, true)
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
    ...nestedRegex(/\[\*/, /]/, true, /\[/)
});
const Macro = createToken({
    name: 'Macro',
    pattern: /\[\S+?]|\[\S+?\([\s\S]*?\)]/,
    line_breaks: true
});

const importantTokens = [
    Escape
]

const inlineTokens = [
    ScaleText,
    WikiSyntax,
    HtmlSyntax,
    Folding,
    IfSyntax,
    Literal,
    Comment,
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
    TableRowOpen,
    TableRowClose,
    TableSplit,
    Hr,
    BlockQuote,

    ...inlineTokens
];

const modeGenerator = tokens => ({
    modes: {
        default: tokens.filter(a => !['TableRowClose', 'TableSplit'].includes(a.name)),
        tableMode: tokens
    },
    defaultMode: 'default'
});

const blockLexer = new Lexer(modeGenerator(allTokens.filter(a => !['Heading'].includes(a.name))));
const lexer = new Lexer(modeGenerator(allTokens));

const instances = [];
let currDepth = 0;

let Store = {
    links: [],
    categories: [],
    includes: [],
    heading: {
        sectionNum: 0,
        lowestLevel: 6,
        list: []
    },
    footnote: {
        index: 0,
        values: {},
        list: []
    }
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
            return result;
        });

        $.RULE('blockDocument', () => {
            const result = [];
            $.AT_LEAST_ONE(() => {
                const tok = $.SUBRULE($.block);
                if(Array.isArray(tok)) result.push(...tok);
                else result.push(tok);
            });
            return result;
        });

        $.RULE('block', () => {
            $.OPTION(() => {
                $.CONSUME(Newline);
            });
            return $.OR([
                { ALT: () => $.SUBRULE($.table) },
                { ALT: () => $.SUBRULE($.hr) },
                { ALT: () => $.SUBRULE($.blockquote) },
                { ALT: () => $.SUBRULE($.list) },
                { ALT: () => $.SUBRULE($.indent) },
                { ALT: () => $.SUBRULE($.paragraph) }
            ]);
        });

        $.RULE('rootBlock', () => {
            $.OPTION(() => {
                $.CONSUME(Newline);
            });
            return $.OR([
                { ALT: () => $.SUBRULE($.heading) },
                { ALT: () => $.SUBRULE($.block) }
            ]);
        });

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
            let sectionNum;
            $.ACTION(() => {
                text = parseInline(text);
                if(level < Store.heading.lowestLevel)
                    Store.heading.lowestLevel = level;
                sectionNum = ++Store.heading.sectionNum;
            });

            const obj = {
                type: 'heading',
                level,
                closed,
                sectionNum,
                numText: null,
                text,
                content
            }
            Store.heading.list.push(obj);
            return obj;
        });

        $.RULE('table', () => {
            const rows = [];
            $.AT_LEAST_ONE(() => {
                const items = [];
                $.CONSUME(TableRowOpen);
                $.AT_LEAST_ONE_SEP({
                    SEP: TableSplit,
                    DEF: () => items.push([$.SUBRULE($.block)])
                });
                $.CONSUME(TableRowClose);
                $.OPTION(() => {
                    $.CONSUME(Newline);
                });
                rows.push(items);
            });
            return {
                type: 'table',
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
                $.OPTION(() => {
                    $.CONSUME(Newline);
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

        $.RULE('list', () => {
            let listType;
            let startNum = 1;
            const items = [];
            $.AT_LEAST_ONE({
                GATE: () => {
                    const next = $.LA(1);
                    if(next.tokenType !== List) return false;
                    return !listType || (next.image[1] === listType && !/#\d+/.test(next.image.slice(3)));
                },
                DEF: () => {
                    const tok = $.CONSUME(List);

                    const isFirst = !listType;
                    let content = tok.image.split('\n').map(a => a.slice(1)).join('\n');
                    listType ??= content[0];
                    content = content.slice(listType.length);

                    if(isFirst) {
                        const match = content.match(/#\d+/);
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
                    $.OPTION(() => {
                        $.CONSUME(Newline);
                    });
                }
            });

            return {
                type: 'list',
                listType,
                startNum,
                items
            }
        });

        $.RULE('indent', () => {
            const lines = [];
            $.AT_LEAST_ONE(() => {
                lines.push($.CONSUME(Indent).image.slice(1));
                $.OPTION(() => {
                    $.CONSUME(Newline);
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

        $.RULE('paragraph', () => {
            const lines = [];
            $.AT_LEAST_ONE(() => {
                lines.push($.SUBRULE($.line));
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

        $.RULE('line', () => {
            const result = $.SUBRULE($.inline);
            $.OPTION(() => {
                $.CONSUME(Newline);
            });
            return result;
        });

        $.RULE('inline', () => {
            const result = [];
            $.AT_LEAST_ONE(() => {
                const tok = $.OR([
                    { ALT: () => $.SUBRULE($.bold) },
                    { ALT: () => $.SUBRULE($.italic) },
                    { ALT: () => $.SUBRULE($.strike) },
                    { ALT: () => $.SUBRULE($.underline) },
                    { ALT: () => $.SUBRULE($.sup) },
                    { ALT: () => $.SUBRULE($.sub) },
                    { ALT: () => $.SUBRULE($.scaleText) },
                    { ALT: () => $.SUBRULE($.wikiSyntax) },
                    { ALT: () => $.SUBRULE($.htmlSyntax) },
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

            const styleCloseStr = '"';

            const darkStyleOpenStr = 'dark-style="';
            const darkStyleIndex = wikiParamsStr.indexOf(darkStyleOpenStr);
            const darkStyleEndIndex = wikiParamsStr.indexOf(styleCloseStr, darkStyleIndex + darkStyleOpenStr.length);
            let darkStyle;
            if(darkStyleIndex >= 0 && darkStyleEndIndex >= 0) {
                darkStyle = utils.cssFilter(wikiParamsStr.slice(darkStyleIndex + darkStyleOpenStr.length, darkStyleEndIndex));
                wikiParamsStr = wikiParamsStr.slice(0, darkStyleIndex) + wikiParamsStr.slice(darkStyleEndIndex + styleCloseStr.length);
            }

            const styleOpenStr = 'style="';
            const styleIndex = wikiParamsStr.indexOf(styleOpenStr);
            const styleEndIndex = wikiParamsStr.indexOf('"', styleIndex + styleOpenStr.length);
            let style;
            if(styleIndex >= 0 && styleEndIndex >= 0) {
                style = utils.cssFilter(wikiParamsStr.slice(styleIndex + styleOpenStr.length, styleEndIndex));
            }

            $.ACTION(() => {
                content = parseBlock(content, true)
            });

            return {
                type: 'wikiSyntax',
                style,
                darkStyle,
                content
            }
        });

        $.RULE('htmlSyntax', () => {
            const tok = $.CONSUME(HtmlSyntax);
            const text = tok.image.slice(9, -3).trim();
            return {
                type: 'htmlSyntax',
                text
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
            if(content.replace(/{{{[\s\S]*}}}/g, '').includes('\n'))
                return {
                    success: false,
                    content: [
                        {
                            type: 'text',
                            text: tok.image.slice(0, sliceStart)
                        },
                        parsedContent,
                        {
                            type: 'text',
                            text: tok.image.slice(sliceEnd)
                        }
                    ]
                }
            return {
                success: true,
                content: parsedContent
            }
        }

        $.RULE('link', () => {
            const tok = $.CONSUME(Link);
            const content = tok.image.slice(2, -2);
            const splitted = content.split(/(?<!\\)\|/).map(a => a.replace(/\\./g, ''));
            let link = splitted[0];
            const origParsedText = splitted.slice(1).join('|');
            let parsedText = origParsedText;

            const text = parsedText || link;
            $.ACTION(() => {
                parsedText &&= parseInline(parsedText);
            });

            if(origParsedText && origParsedText.replace(/{{{[\s\S]*}}}/g, '').includes('\n')) {
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
                let parsedUrl;
                try {
                    parsedUrl = new URL(link);
                } catch (e) {}

                if(!parsedUrl) {
                    if(link.startsWith('분류:') && !Store.thread) {
                        link = link.slice(3);

                        let blur;
                        if(link.endsWith('#blur')) {
                            link = link.slice(0, -'#blur'.length);
                            blur = true;
                        }
                        const newCategory = {
                            document: link,
                            text: origParsedText ? text : undefined,
                            blur
                        }
                        if(!Store.categories.includes(link))
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
                textExists: !!origParsedText,
                parsedText
            }
        });

        $.RULE('footnote', () => {
            const tok = $.CONSUME(Footnote);
            const content = tok.image.slice(2, -1);
            const splitted = content.split(' ');

            const valueInput = splitted.slice(1).join(' ');
            if(valueInput.replace(/{{{[\s\S]*}}}/g, '').includes('\n')) {
                let parsedValue;
                $.ACTION(() => {
                    parsedValue = parseInline(valueInput);
                });
                return [
                    {
                        name: 'text',
                        text: tok.image.slice(0, 2)
                    },
                    parsedValue,
                    {
                        name: 'text',
                        text: tok.image.slice(-1)
                    }
                ]
            }

            $.ACTION(() => {
                Store.footnote.index++;
            });
            const index = Store.footnote.index;
            const name = splitted[0] || index.toString();

            let value = Store.footnote.values[name];
            if(!value) {
                value = valueInput;
                $.ACTION(() => {
                    value = parseInline(value);
                });
            }
            Store.footnote.values[name] ??= value;

            Store.footnote.list.push({
                name,
                index
            });

            return {
                type: 'footnote',
                name,
                value,
                index,
                startOffset: tok.startOffset
            }
        });

        $.RULE('macro', () => {
            const tok = $.CONSUME(Macro);
            const content = tok.image.slice(1, -1);

            const openParamIndex = content.indexOf('(');

            let name;
            let params = '';
            if(openParamIndex === -1) name = content;
            else {
                if(!content.endsWith(')')) {
                    let parsedContent = content;
                    $.ACTION(() => {
                        parsedContent = parseInline(content);
                    });
                    return [
                        {
                            type: 'text',
                            text: tok.image.slice(0, 1)
                        },
                        parsedContent,
                        {
                            type: 'text',
                            text: tok.image.slice(-1)
                        }
                    ]
                }
                name = content.slice(0, openParamIndex);
                params = content.slice(openParamIndex + 1, content.length - 1);
            }

            if(name === 'include') {
                const includeParams = params.split(/(?<!\\),/).map(a => a.replaceAll('\\,', ','));
                Store.includes.push(includeParams[0]);
            }

            return {
                type: 'macro',
                name,
                params,
                startOffset: tok.startOffset
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
        $.RULE('legacyMath', () => inlineHandler('legacyMath', LegacyMath, 6, -7));

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

const parseBlock = (text, noTopParagraph = false) => {
    const lexed = blockLexer.tokenize(text);
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

module.exports = (text, { thread = false, includeParams = {} } = {}) => {
    Store = {
        ...originalStore,
        thread,
        includeParams
    }

    console.time('tokenize');
    const lexed = lexer.tokenize(text);
    console.timeEnd('tokenize');
    parser.input = lexed.tokens;
    console.time('cst');
    const result = parser.document();
    console.timeEnd('cst');

    const headings = [];

    const paragraphNum = [...Array(6 + 1 - Store.heading.lowestLevel)].map(_ => 0);
    for(let heading of Store.heading.list) {
        const paragraphNumTextArr = [];
        for(let i = 0; i <= heading.level - Store.heading.lowestLevel; i++) {
            if(i === heading.level - Store.heading.lowestLevel) paragraphNum[i]++;

            paragraphNumTextArr.push(paragraphNum[i]);
        }
        heading.numText = paragraphNumTextArr.join('.');
    }

    return {
        tokens: lexed.tokens,
        result,
        data: {
            links: Store.links,
            categories: Store.categories,
            includes: Store.includes,
            headings,
            footnoteList: Store.footnote.list
        }
    }
}