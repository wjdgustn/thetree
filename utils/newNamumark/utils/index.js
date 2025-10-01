const {
    validateHTMLColorHex,
    validateHTMLColorName
} = require('validate-color');
const katex = require('katex');
const jsep = require('jsep');
const CSSFilter = require('cssfilter');
const sanitizeHtml = require('sanitize-html');
const fs = require('fs');
const path = require('path');

const allowedNames = require('./allowedNames.json');

const baseSanitizeHtmlOptions = {
    allowedTags: sanitizeHtml.defaults.allowedTags.filter(a => ![
        'code'
    ].includes(a)),
    allowedAttributes: {
        '*': ['style'],
        a: ['href', 'class', 'rel', 'target']
    },
    allowedSchemes: ['http', 'https', 'ftp'],
    transformTags: {
        '*': (tagName, attribs) => {
            if(!attribs.style) return { tagName, attribs };

            const style = module.exports.cssFilter(attribs.style);

            return {
                tagName,
                attribs: { ...attribs, style }
            }
        }
    }
}
const sanitizeHtmlOptions = {
    ...baseSanitizeHtmlOptions,
    transformTags: {
        ...baseSanitizeHtmlOptions.transformTags,
        a: sanitizeHtml.simpleTransform('a', {
            class: 'wiki-link-external',
            rel: 'nofollow noopener ugc',
            target: '_blank'
        })
    }
}

const filter = new CSSFilter.FilterCSS({
    whiteList: {
        ...Object.assign({}, ...allowedNames.map(a => ({[a]: true}))),
        display: v => [
            'block',
            'flex',
            'inline',
            'inline-block',
            'inline-flex',
            'inline-table',
            'list-item',
            'none',
            'table',
            'table-caption',
            'table-cell',
            'table-column',
            'table-column-group',
            'table-footer-group',
            'table-header-group',
            'table-row-group'
        ].includes(v),
        'text-align': v => [
            'left',
            'right',
            'center'
        ].includes(v)
    },
    onAttr: (name, value, options) => {
        if(value.startsWith('url(')) return '';
    }
});

function parsedToTextObj(content) {
    const result = [];
    if(!Array.isArray(content)) content = [content];
    for(let item of content) {
        if(!item) continue;
        if(item.type === 'text')
            result.push(item);
        else {
            const value = Array.isArray(item)
                ? item
                : item.lines ?? item.parsedText ?? item.items ?? item.content;
            if(value) result.push(...parsedToTextObj(value));
        }
    }
    return result;
}

module.exports = {
    escapeHtml: text => (text?.toString() ?? '')
        .replaceAll('&', "&amp;")
        .replaceAll('<', "&lt;")
        .replaceAll('>', "&gt;")
        .replaceAll(`"`, "&quot;")
        .replaceAll(`'`, "&#039;"),
    unescapeHtml: text => (text?.toString() ?? '')
        .replaceAll("&amp;", '&')
        .replaceAll("&lt;", '<')
        .replaceAll("&gt;", '>')
        .replaceAll("&quot;", `"`)
        .replaceAll("&#039;", `'`),
    parseSize(text) {
        let value = Number(text);
        let unit = 'px';

        if(isNaN(value)) {
            if(text.endsWith('%')) {
                value = parseFloat(text.slice(0, -1));
                unit = '%';
            }
            else if(text.endsWith('px')) {
                value = parseFloat(text.slice(0, -2));
            }
        }
        if(isNaN(value)) return;
        if(value < 0) return;

        return { value, unit };
    },
    validateColor(color) {
        return this.validateHTMLColorName(color) || validateHTMLColorHex(color);
    },
    validateHTMLColorName(color) {
        return color === 'transparent' || validateHTMLColorName(color);
    },
    parseIncludeParams(text, includeData = {}) {
        if(!text) return text;

        includeData ??= {};

        let newText = '';
        let textPos = 0;
        while(true) {
            const startPos = text.indexOf('@', textPos);
            if(startPos === -1) break;
            const endPos = text.indexOf('@', startPos + 1);
            if(endPos === -1) break;

            newText += text.slice(textPos, startPos);
            textPos = endPos + 1;

            const content = text.slice(startPos + 1, endPos);
            const splittedContent = content.split('=');
            const key = splittedContent[0];
            const value = splittedContent.slice(1).join('=');

            if(splittedContent.length > 1 && !value) {
                newText += `@${content}@`;
                continue;
            }

            const finalText = includeData[key] ?? value;
            newText += finalText;
        }

        newText += text.slice(textPos);

        return newText;
    },
    katex: text => katex.renderToString(text, {
        throwOnError: false
    }),
    parseExpression: (expression, data = {}) => {
        let parsed;
        try {
            parsed = jsep(expression);
        } catch (e) {}

        const bool = value => !!value || Number.isNaN(value);

        const parseNode = node => {
            switch(node.type) {
                case 'Literal':
                    return node.value;
                case 'Identifier':
                    switch(node.name) {
                        case 'NaN':
                            return NaN;
                        default:
                            return data[node.name] ?? null;
                    }
                case 'BinaryExpression':
                case 'UnaryExpression': {
                    let left;
                    let right;
                    if(node.type === 'BinaryExpression') {
                        left = parseNode(node.left);
                        right = parseNode(node.right);
                    }
                    else {
                        left = 0;
                        right = parseNode(node.argument);
                    }

                    const bothNum = !isNaN(left) && !isNaN(right);
                    const bothInt = bothNum && !node.left?.raw?.includes('.') && !node.right?.raw?.includes('.');

                    switch(node.operator) {
                        case '==':
                            return left === right;
                        case '!=':
                            return left !== right;
                        case '>':
                            return left > right;
                        case '>=':
                            return left >= right;
                        case '<':
                            return left < right;
                        case '<=':
                            return left <= right;

                        case '&&':
                            return left && right;
                        case '||':
                            return left || right;
                        case '!':
                            return !right;

                        case '+':
                            return Number(left) + Number(right);
                        case '-':
                            return left - right;
                        case '*':
                            return left * right;
                        case '/':
                            if(bothInt)
                                return Math.trunc(left / right);
                            else
                                return left / right;
                        case '%':
                            return left % right;
                        case '**':
                            return left ** right;

                        case '~':
                            return ~right;
                        case '<<':
                            return left << right;
                        case '>>':
                            return left >> right;
                        case '&':
                            if(bothNum) return left & right;
                            return bool(left) && bool(right);
                        case '|':
                            if(bothNum) return left | right;
                            return bool(left) || bool(right);
                        case '^':
                            return left ^ right;
                    }
                }
            }
        }

        const result = parsed ? parseNode(parsed) : null;
        return {
            result,
            bool: bool(result)
        }
    },
    cssFilter: css => filter.process(css),
    parsedToText(content, putSpace = false) {
        const obj = parsedToTextObj(content);
        return obj.map(a => a.text).join(putSpace ? ' ' : '');
    },
    AllowedLanguages: [
        'basic',
        'cpp',
        'csharp',
        'css',
        'erlang',
        'go',
        'html',
        'java',
        'javascript',
        'json',
        'kotlin',
        'lisp',
        'lua',
        'markdown',
        'objectivec',
        'perl',
        'php',
        'powershell',
        'python',
        'ruby',
        'rust',
        'sh',
        'sql',
        'swift',
        'typescript',
        'xml'
    ].sort((a, b) => b.length - a.length),
    baseSanitizeHtml: text => sanitizeHtml(text, baseSanitizeHtmlOptions),
    sanitizeHtml: text => sanitizeHtml(text, sanitizeHtmlOptions),
    loadMacros(macroPluginPaths) {
        macroPluginPaths ??= (global.plugins.macro ?? []).map(a => a.path);

        const macros = {};
        const threadMacros = [];

        const macroDir = '../syntax/macro';
        const files = fs.readdirSync(path.resolve(__dirname, macroDir));
        for(let file of files) {
            if(file === 'index.js') continue;

            const macroName = file.replace('.js', '').toLowerCase();

            const macroPath = require.resolve(path.resolve(__dirname, macroDir,  `./${file}`));
            // if(debug) delete require.cache[macroPath];
            const macro = require(macroPath);
            macros[macroName] = macro.format ?? macro;

            if(macro.aliases)
                for(let alias of macro.aliases)
                    macros[alias] = macro.format;

            if(macro.allowThread)
                threadMacros.push(macroName, ...(macro.aliases ?? []));
        }

        for(let macroPath of macroPluginPaths) {
            const macro = require(macroPath);
            macros[macro.name] = macro.format;
            if(macro.aliases)
                for(let alias of macro.aliases)
                    macros[alias] = macro.format;

            if(macro.allowThread)
                threadMacros.push(plugin.name, ...(macro.aliases ?? []));
        }

        if(global.__THETREE__)
            global.__THETREE__.macros = Object.keys(macros);

        return {
            macros,
            threadMacros
        }
    }
}