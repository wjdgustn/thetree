const utils = require('./utils');
const globalUtils = require('../global');

const link = require('./syntax/link');
const table = require('./syntax/table');

const toHtml = (doc, { document, thread, commentId } = {}) => {
    if(Array.isArray(doc[0])) {
        const lines = [];
        for(let line of doc) {
            lines.push(toHtml(line));
        }
        return lines.join('<br>');
    }

    let lowestLevel = 6;
    for(let obj of doc) {
        if(obj.type !== 'heading') continue;
        if(obj.level < lowestLevel) lowestLevel = obj.level;
    }
    let sectionNum = 0;
    const paragraphNum = [...Array(6 + 1 - lowestLevel)].map(_ => 0);

    const commentPrefix = commentId ? `tc${commentId}-` : '';

    let result = '';
    for(let obj of doc) {
        switch(obj.type) {
            case 'paragraph': {
                result += `<div class="wiki-paragraph">${toHtml(obj.lines)}</div>`;
                break;
            }

            case 'heading': {
                for(let i = obj.level - lowestLevel + 1; i < paragraphNum.length; i++) {
                    paragraphNum[i] = 0;
                }

                const thisSectionNum = ++sectionNum;
                const paragraphNumTextArr = [];
                for(let i = 0; i <= obj.level - lowestLevel; i++) {
                    if(i === obj.level - lowestLevel) paragraphNum[i]++;

                    paragraphNumTextArr.push(paragraphNum[i]);
                }
                const paragraphNumText = paragraphNumTextArr.join('.');

                const text = toHtml(obj.text);

                result += `<h${obj.level} class="wiki-heading${obj.closed ? ' wiki-heading-folded' : ''}">`;
                result += `<a id="s-${paragraphNumText}" href="#${commentPrefix}toc">${paragraphNumText}.</a>`;
                result += ` <span id="${globalUtils.removeHtmlTags(text)}">${text}`;
                if(!thread) result += `
<span class="wiki-edit-section">
<a href="${utils.escapeHtml(globalUtils.doc_action_link(document, 'edit', {
                    section: thisSectionNum
                }))}" rel="nofollow">[편집]</a>
</span>`.trim();
                result += `</span></h${obj.level}>`;
                result += `<div class="wiki-heading-content${obj.closed ? ' wiki-heading-content-folded' : ''}">`;
                result += toHtml(obj.content);
                result += `</div>`;
                break;
            }

            case 'text':
                result += utils.escapeHtml(obj.text).replaceAll('\n', '<br>');
                break;
            case 'bold':
                result += `<strong>${toHtml(obj.content)}</strong>`;
                break;
            case 'italic':
                result += `<em>${toHtml(obj.content)}</em>`;
                break;
            case 'strike':
                result += `<del>${toHtml(obj.content)}</del>`;
                break;
            case 'underline':
                result += `<u>${toHtml(obj.content)}</u>`;
                break;
            case 'sup':
                result += `<sup>${toHtml(obj.content)}</sup>`;
                break;
            case 'sub':
                result += `<sub>${toHtml(obj.content)}</sub>`;
                break;
            case 'scaleText':
                result += `<span class="wiki-size-${obj.isSizeUp ? 'up' : 'down'}-${obj.size}">${toHtml(obj.content)}</span>`;
                break;
            case 'literal': {
                const hasNewline = obj.text.includes('\n');
                const text = utils.escapeHtml(obj.text).replaceAll('\n', '<br>');
                if(hasNewline) result += '<pre>';
                result += `<code>${text}</code>`;
                if(hasNewline) result += '</pre>';
                break;
            }
            case 'link':
                // result += link(obj, );
                result += `<a href="/">${obj.text}</a>`;
                break;
            case 'footnote': {
                result += `[${obj.name}]`;
                break;
            }
            case 'table':
                result += table(obj, toHtml);
                break;

            default:
                // console.log(obj);
                console.error('missing implementation:', obj.type);
        }
    }

    return result;
}

module.exports = toHtml;