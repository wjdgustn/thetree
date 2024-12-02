const {
    validateHTMLColorHex,
    validateHTMLColorName
} = require('validate-color');

const { Priority } = require('../types');
const listParser = require('../listParser');

module.exports = {
    fullLine: true,
    priority: Priority.Table,
    openStr: '||',
    makeTable(content, namumark, fromLastLine = false) {
        const rows = namumark.syntaxData.rows ??= [];
        if(!rows.length) return null;

        console.log('=== make table! ===');
        console.log(rows);

        let tableAlign;
        let tableStyle = '';

        const htmlRows = [];
        for(let row of rows) {
            const htmlValues = [];
            let colspan = 1;
            for(let value of row) {
                if(!value) {
                    colspan++;
                    continue;
                }

                const tdClassList = [];
                let tdStyle = '';
                let align;
                let colspanAssigned = false;

                let paramStr = value;
                const prevParamStrLength = paramStr.length;
                while(paramStr.startsWith('&lt;')) {
                    const closeIndex = paramStr.indexOf('&gt;');
                    if(closeIndex === -1) break;

                    const tagStr = paramStr.slice('&lt;'.length, closeIndex);
                    console.log('tagStr', tagStr);

                    if(tagStr.startsWith('table')) {
                        const splittedTagStr = tagStr.slice('table'.length).trimStart().split('=');
                        if(splittedTagStr.length !== 2) break;

                        console.log('splittedTagStr', splittedTagStr);

                        const name = splittedTagStr[0];
                        const value = splittedTagStr[1];

                        if(name === 'align') {
                            if(tableAlign) break;

                            if(value === 'left') tableAlign = 'left';
                            else if(value === 'center') tableAlign = 'center';
                            else if(value === 'right') tableAlign = 'right';
                            else break;
                        }
                        else if(name === 'bordercolor') {
                            if(!validateHTMLColorHex(value)
                                && !validateHTMLColorName(value)) break;

                            tableStyle += `border:2px solid ${value};`;
                        }
                        else break;
                    }
                    else if(tagStr.startsWith('-')) {
                        if(colspanAssigned) break;

                        const num = parseInt(tagStr.slice(1));
                        if(isNaN(num) || num < 0) break;

                        colspan = num;
                        colspanAssigned = true;
                    }
                    else if(['(', ':', ')'].includes(tagStr)) {
                        if(align) break;

                        if(tagStr === '(') align = 'left';
                        else if(tagStr === ':') align = 'center';
                        else if(tagStr === ')') align = 'right';
                    }
                    else if(tagStr.startsWith('width=')) {
                        if(tdStyle.includes('width')) break;

                        const width = tagStr.slice('width='.length);

                        let value = Number(width);
                        let unit = 'px';

                        if(isNaN(value)) {
                            if(width.endsWith('%')) {
                                value = parseFloat(width.slice(0, -1));
                                unit = '%';
                            }
                            else if(width.endsWith('px')) {
                                value = parseFloat(width.slice(0, -2));
                            }
                        }
                        if(isNaN(value)) break;
                        if(value < 0) break;

                        tdStyle += `width:${value}${unit};`;
                    }
                    else if(tagStr === 'nopad') {
                        if(tdClassList.includes('wiki-table-nopadding')) break;

                        tdClassList.push('wiki-table-nopadding');
                    }
                    else break;

                    paramStr = paramStr.slice(closeIndex + '&gt;'.length);
                }

                value = value.slice(prevParamStrLength - paramStr.length);

                const startsWithSpace = value.startsWith(' ');
                const endsWithSpace = value.endsWith(' ');

                if(!align) {
                    if(startsWithSpace && endsWithSpace) {
                        align = 'center';
                        value = value.slice(1, -1);
                    } else if(startsWithSpace) {
                        align = 'right';
                        value = value.slice(1);
                    } else if(endsWithSpace) {
                        align = 'left';
                        value = value.slice(0, -1);
                    }
                }
                if(align) tdStyle += `text-align:${align};`;

                htmlValues.push(`
<td${tdStyle ? ` style="${tdStyle}"` : ''}${colspan > 1 ? ` colspan="${colspan}"` : ''}${tdClassList ? `class="${tdClassList.join(' ')}"` : ''}><div class="wiki-paragraph"><removeNewlineLater/>
${value}
<removeNewlineLater/></div></td>
`.trim());

                colspan = 1;
            }

            htmlRows.push(`<tr>${htmlValues.join('')}</tr>`);
        }

        rows.length = 0;

        const tableWrapperClassList = ['wiki-table-wrap'];

        if(tableAlign) tableWrapperClassList.push(`table-${tableAlign}`);

        // TODO: 임시 [br] 매크로 제거
        const table = `<removeNewline/></div><div class="${tableWrapperClassList.join(' ')}"><table class="wiki-table"${tableStyle ? ` style="${tableStyle}"` : ''}><tbody>${htmlRows.join('')}</tbody></table></div><div class="wiki-paragraph"><removeNewlineAfterFullline/>`.trim().replaceAll('[br]', '<br>');

        return table + '\n' + (fromLastLine ? '' : content);
    },
    format(content, namumark, _, isLastLine) {
        const rows = namumark.syntaxData.rows ??= [];
        const rowText = namumark.syntaxData.rowText ??= '';

        const makeTable = (fromLastLine = false) => this.makeTable(content, namumark, fromLastLine);

        const trimedContent = content.trim();
        if(!trimedContent.startsWith('||') && !rowText) {
            return makeTable();
        }

        const newRowText = namumark.syntaxData.rowText += (rowText ? '\n' : '') + content;

        if(newRowText.length > 2 && newRowText.endsWith('||')) {
            rows.push(newRowText.split('||').slice(1, -1));
            namumark.syntaxData.rowText = '';
        }

        if(isLastLine) return makeTable(true);

        return '';
    }
}