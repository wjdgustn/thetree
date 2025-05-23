const {
    validateHTMLColorHex,
    validateHTMLColorName
} = require('validate-color');
const katex = require('katex');
const jsep = require('jsep');
const CSSFilter = require('cssfilter');
const mongoose = require('mongoose');

const mainUtils = require('../..');

const allowedNames = require('./allowedNames.json');

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

module.exports = {
    escapeHtml: text => (text ?? '')
        .replaceAll('&', "&amp;")
        .replaceAll('<', "&lt;")
        .replaceAll('>', "&gt;")
        .replaceAll(`"`, "&quot;")
        .replaceAll(`'`, "&#039;"),
    unescapeHtml: text => (text ?? '')
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
        return color === 'transparent' || validateHTMLColorHex(color) || validateHTMLColorName(color);
    },
    parseIncludeParams(text, includeData = {}) {
        let newText = '';
        let textPos = 0;
        while(true) {
            const startPos = text.indexOf('@', textPos);
            if(startPos === -1) break;
            const endPos = text.indexOf('@', startPos + 1);
            if(endPos === -1) break;

            const htmlTagStartPos = text.indexOf('<', textPos);
            if(htmlTagStartPos !== -1 && htmlTagStartPos < endPos) {
                const htmlTagEndPos = text.indexOf('>', htmlTagStartPos);
                if(htmlTagEndPos !== -1) {
                    newText += text.slice(textPos, htmlTagEndPos + 1);
                    textPos = htmlTagEndPos + 1;
                    continue;
                }
            }

            const newLinePos = text.indexOf('<newLine/>', startPos);
            if(newLinePos !== -1 && newLinePos < endPos) {
                newText += text.slice(textPos, newLinePos + '<newLine/>'.length);
                textPos = newLinePos + '<newLine/>'.length;
                continue;
            }

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

            let finalText = includeData[key] ?? value;
            if(finalText.startsWith(' ')) finalText = '<!s>' + finalText.slice(1);
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
    bulkFindDocuments: async docNames => {
        const parsedDocs = docNames.map(a => mainUtils.parseDocumentName(a));
        const namespaces = [...new Set(parsedDocs.map(a => a.namespace))];

        const query = { $or: [] };
        for(let namespace of namespaces) {
            query.$or.push({
                namespace,
                title: {
                    $in: parsedDocs.filter(a => a.namespace === namespace).map(a => a.title)
                }
            });
        }
        if(!query.$or.length) return [];

        const result = await mongoose.Models.Document.find(query);
        return [
            ...result,
            ...parsedDocs
                .map(a => !result.some(b => a.namespace === b.namespace && a.title === b.title) ? {
                    ...a,
                    contentExists: false
                } : null)
                .filter(a => a)
        ]
    }
}