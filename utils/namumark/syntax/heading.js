const sanitizeHtml = require('sanitize-html');

const { Priority } = require('../types');

const namumarkUtils = require('../utils');
const globalUtils = require('../../global');

const getLevel = content => {
    if(!content.startsWith('=') || !content.includes(' ')) return;

    let level = 0;
    let defaultClosed = false;
    for(let i = 0; i < content.length; i++) {
        const char = content[i];

        if(char === ' ') break;
        else if(char !== '=') {
            if(char === '#') {
                defaultClosed = true;
                break;
            }
            else return;
        }

        level++;
    }

    const closeStr = ` ${defaultClosed ? '#' : ''}${'='.repeat(level)}`;
    if(level > 6 || !content.endsWith(closeStr)) return;

    return {
        level,
        defaultClosed,
        closeStr
    }
}

const getLowestLevel = lines => {
    let lowestLevel = 6;
    for(let line of lines) {
        const checkLevel = getLevel(line);
        if(!checkLevel) continue;

        const { level, closeStr } = checkLevel;
        if(!line.endsWith(closeStr)) continue;
        if(level < lowestLevel) lowestLevel = level;
    }

    return lowestLevel;
}

module.exports = {
    priority: Priority.Heading,
    fullLine: true,
    getHeadingLines(str) {
        const result = [];
        const lines = str.split('\n');
        for(let i in lines) {
            i = parseInt(i);
            const line = lines[i];

            const checkLevel = getLevel(line);
            if(!checkLevel) continue;

            result.push(i);
        }

        return result;
    },
    async format(content, namumark, lines) {
        const lowestLevel = namumark.syntaxData.lowestLevel ??= getLowestLevel(lines);

        const checkLevel = getLevel(content);
        if(!checkLevel) return;

        const {
            level,
            defaultClosed
        } = checkLevel;

        const text = content.slice(level + 1, content.length - level - 1);

        namumark.syntaxData.sectionNum ??= 0;
        const paragraphNum =
            namumark.syntaxData.paragraphNum ??= [...Array(6 + 1 - lowestLevel)].map(_ => 0);

        for(let i = level - lowestLevel + 1; i < paragraphNum.length; i++) {
            paragraphNum[i] = 0;
        }

        const sectionNum = ++namumark.syntaxData.sectionNum;
        const paragraphNumTextArr = [];
        for(let i = 0; i <= level - lowestLevel; i++) {
            if(i === level - lowestLevel) paragraphNum[i]++;

            paragraphNumTextArr.push(paragraphNum[i]);
        }
        const paragraphNumText = paragraphNumTextArr.join('.');

        // 문단 파서 성능이 !!
        // console.time('문단 텍스트 처리비');
        const { html } = await namumark.parse(text, true, true, {}, {
            removeFootnote: true,
            removeNamumarkEscape: true
        });
        const sanitizedHtml = sanitizeHtml(html, {
            allowedTags: ['a'],
            allowedAttributes: {
                '*': ['style'],
                a: ['href', 'class', 'rel', 'target']
            }
        });
        // console.timeEnd('문단 텍스트 처리비');
        namumark.headings.push({
            num: paragraphNumText,
            text: sanitizedHtml
        });

        const editSection = namumark.thread ? '' : `
<span class="wiki-edit-section">
<a href="${namumarkUtils.escapeHtml(globalUtils.doc_action_link(namumark.document, 'edit', {
            section: sectionNum
        }))}" rel="nofollow">[편집]</a>
</span>`.trim();

        const commentPrefix = namumark.commentId ? `tc${namumark.commentId}-` : '';

        return `
<removeNewlineLater/>
<removeNextNewline/>
<!cursorToEnd/>
<!noParagraph>
<h${level} class="wiki-heading${defaultClosed ? ' wiki-heading-folded' : ''}">
<a id="s-${paragraphNumText}" href="#${commentPrefix}toc">${paragraphNumText}.</a>
 <span id="${globalUtils.removeHtmlTags(text)}">${text}
${editSection}
</span>
</h${level}>
<div class="wiki-heading-content${defaultClosed ? ' wiki-heading-content-folded' : ''}">
<!cursorPos/>
</div>
`.replaceAll('\n', '') + '\n<!goToCursor/><!/noParagraph><removeNewlineLater/><newLine/>';
    }
}