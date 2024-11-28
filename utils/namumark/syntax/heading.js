const globalUtils = require('../../../utils/global');

const getLevel = content => {
    if(!content.startsWith('=') || !content.includes(' ')) return;

    let level = 0;
    let defaultClosed = false;
    for(let i = 0; i < content.length; i++) {
        const char = content[i];

        if(char === ' ') break;
        else if(char !== '=') {
            if(char === '#') defaultClosed = true;
            else return;
        }

        level++;
    }

    return {
        level,
        defaultClosed,
        closeStr: ` ${defaultClosed ? '#' : ''}${'='.repeat(level)}`
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
    fullLine: true,
    format(content, namumark, lines) {
        const lowestLevel = namumark.syntaxData.lowestLevel ??= getLowestLevel(lines);

        const checkLevel = getLevel(content);
        if(!checkLevel) return;

        const {
            level,
            defaultClosed,
            closeStr
        } = checkLevel;

        if(level > 6) return;

        if(!content.endsWith(closeStr)) return;

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

        return `
<removeNewline/>
<removeNextNewline/>
<exitParagraph/>
<removeNewlineLater/><h${level} class="wiki-heading${defaultClosed ? ' wiki-heading-folded' : ''}">
<a id="s-${paragraphNumText}" href="#toc">${paragraphNumText}.</a>
 <span :id="$el.innerText">${text}
<span class="wiki-edit-section">
<a href="${globalUtils.doc_action_link(namumark.document, 'edit', {
    section: sectionNum
})}" rel="nofollow">[편집]</a>
</span>
</span>
</h${level}>
<div class="wiki-heading-content${defaultClosed ? ' wiki-heading-folded' : ''}">
<paragraphPos/>
</div>
<removeNewlineLater/>
`.replaceAll('\n', '') + '\n<enterParagraph/>';
    }
}