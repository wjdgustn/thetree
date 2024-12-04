const utils = require('../utils');
const { Priority } = require('../types');

const parseSize = text => {
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
}

module.exports = {
    fullLine: true,
    priority: Priority.Table,
    openStr: '||',
    makeTable(content, namumark, fromLastLine = false, removeNewParagraph = false) {
        const rows = namumark.syntaxData.rows ??= [];
        if(!rows.length) return null;

        console.log('=== make table! ===');
        console.log(rows);

        let tableAlign;
        const colBgColors = [];
        const colDarkBgColors = [];
        const colColors = [];
        const colDarkColors = [];
        const colKeepAll = [];

        const trClassList = [];

        let tableWrapStyle = '';
        let tableStyle = '';
        let tableDarkStyle = '';

        const htmlRows = [];
        for(let colIndex in rows) {
            colIndex = parseInt(colIndex);
            const row = rows[colIndex];
            const htmlValues = [];

            let colspan = 1;

            let trStyle = '';
            let trDarkStyle = '';

            for(let rowIndex in row) {
                rowIndex = parseInt(rowIndex);
                let value = row[rowIndex];
                if(!value) {
                    colspan++;
                    continue;
                }

                const tdClassList = [];
                let tdStyle = '';
                let tdDarkStyle = '';
                let align;
                let rowspan;
                let colspanAssigned = false;
                let colBgColorAssigned = false;
                let colColorAssigned = false;

                let paramStr = value;
                const prevParamStrLength = paramStr.length;
                while(paramStr.startsWith('&lt;')) {
                    const closeIndex = paramStr.indexOf('&gt;');
                    if(closeIndex === -1) break;

                    const tagStr = paramStr.slice('&lt;'.length, closeIndex);
                    console.log('tagStr', tagStr);

                    const splittedTagStr = tagStr.split('=');
                    const [name, value] = splittedTagStr;

                    const splittedValue = value?.split(',') ?? [];
                    const [light, dark] = splittedValue;

                    if(!tagStr.startsWith('table')
                        && name.includes('color')) {
                        if(splittedValue.length > 2) break;
                        if(splittedValue
                            .some(v => !utils.validateColor(v))) break;
                    }

                    if(tagStr.startsWith('table')) {
                        const splittedTableStr = tagStr.slice('table'.length).trimStart().split('=');
                        if(splittedTableStr.length !== 2) break;

                        const [name, value] = splittedTableStr;
                        const splittedValue = value.split(',');

                        const [light, dark] = splittedValue;

                        if(name.includes('color')) {
                            if(splittedValue.length > 2) break;
                            if(splittedValue
                                .some(v => !utils.validateColor(v))) break;
                        }

                        if(name === 'align') {
                            if(tableAlign) break;

                            if(value === 'left') tableAlign = 'left';
                            else if(value === 'center') tableAlign = 'center';
                            else if(value === 'right') tableAlign = 'right';
                            else break;
                        }
                        else if(name === 'color') {
                            if(tableStyle.includes('color:')) break;

                            tableStyle += `color:${light};`;
                            if(dark) tableDarkStyle += `color:${dark};`;
                        }
                        else if(name === 'bgcolor') {
                            if(tableStyle.includes('background-color:')) break;

                            tableStyle += `background-color:${light};`;
                            if(dark) tableDarkStyle += `background-color:${dark};`;
                        }
                        else if(name === 'bordercolor') {
                            if(tableStyle.includes('border:')) break;

                            tableStyle += `border:2px solid ${light};`;
                            if(dark) tableDarkStyle += `border:2px solid ${dark};`;
                        }
                        else if(name === 'width') {
                            if(tableWrapStyle.includes('width:')) break;

                            const size = utils.parseSize(value);
                            if(!size) return;

                            tableWrapStyle += `width:${size.value}${size.unit};`;
                            tableStyle += `width:100%;`;
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
                    else if(tagStr.startsWith('|') || tagStr.slice(1).startsWith('|')) {
                        if(rowspan) break;

                        let newStyle = '';
                        if(!tagStr.startsWith('|')) {
                            if(tagStr[0] === '^') newStyle += 'vertical-align:top;';
                            else if(tagStr[0] === 'v') newStyle += 'vertical-align:bottom;';
                            else break;
                        }

                        const num = parseInt(tagStr.slice(newStyle ? 2 : 1));
                        if(isNaN(num) || num < 0) break;

                        rowspan = num;
                        tdStyle += newStyle;
                    }
                    else if(['(', ':', ')'].includes(tagStr)) {
                        if(align) break;

                        if(tagStr === '(') align = 'left';
                        else if(tagStr === ':') align = 'center';
                        else if(tagStr === ')') align = 'right';
                    }
                    else if(name === 'width') {
                        if(tdStyle.includes('width:')) break;

                        const size = utils.parseSize(value);
                        if(!size) return;

                        tdStyle += `width:${size.value}${size.unit};`;
                    }
                    else if(name === 'height') {
                        if(tdStyle.includes('height:')) break;

                        const size = utils.parseSize(value);
                        if(!size) return;

                        tdStyle += `height:${size.value}${size.unit};`;
                    }
                    else if(tagStr === 'nopad') {
                        if(tdClassList.includes('wiki-table-nopadding')) break;

                        tdClassList.push('wiki-table-nopadding');
                    }
                    else if(name === 'bgcolor') {
                        if(tdStyle.includes('background-color:')) break;

                        tdStyle += `background-color:${light};`;
                        if(dark) tdDarkStyle += `background-color:${dark};`;
                    }
                    else if(name === 'colbgcolor') {
                        if(colBgColorAssigned) break;

                        colBgColors[rowIndex] = light;
                        if(dark) colDarkBgColors[rowIndex] = dark;

                        colBgColorAssigned = true;
                    }
                    else if(name === 'rowbgcolor') {
                        if(trStyle.includes('background-color:')) break;

                        trStyle += `background-color:${light};`;
                        if(dark) trDarkStyle += `background-color:${dark};`;
                    }
                    else if(name === 'color') {
                        if(tdStyle.includes('color:')) break;

                        tdStyle += `color:${light};`;
                        if(dark) tdDarkStyle += `color:${dark};`;
                    }
                    else if(name === 'colcolor') {
                        if(colColorAssigned) break;

                        colColors[rowIndex] = light;
                        if(dark) colDarkColors[rowIndex] = dark;

                        colColorAssigned = true;
                    }
                    else if(name === 'rowcolor') {
                        if(trStyle.includes('color:')) break;

                        trStyle += `color:${light};`;
                        if(dark) trDarkStyle += `color:${dark};`;
                    }
                    else if(tagStr === 'keepall') {
                        if(tdClassList.includes('wiki-table-keepall')) break;
                        tdClassList.push('wiki-table-keepall');
                    }
                    else if(tagStr === 'rowkeepall') {
                        if(trClassList.includes('wiki-table-keepall')) break;
                        trClassList.push('wiki-table-keepall');
                    }
                    else if(tagStr === 'colkeepall') {
                        if(colKeepAll.includes(rowIndex)) break;
                        colKeepAll[rowIndex] = true;
                    }
                    else if(utils.validateColor(tagStr)) {
                        if(tdStyle.includes('background-color:')) break;

                        tdStyle += `background-color:${tagStr};`;
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

                const visualRowIndex = rowIndex + Math.min(colspan, row.length) - 1;
                console.log('rowIndex', rowIndex, 'visualRowIndex', visualRowIndex, 'colBgColors', colBgColors);
                if(!tdStyle.includes('background-color:') && colBgColors[visualRowIndex])
                    tdStyle += `background-color:${colBgColors[visualRowIndex]};`;
                if(!tdDarkStyle.includes('background-color:') && colDarkBgColors[visualRowIndex])
                    tdDarkStyle += `background-color:${colDarkBgColors[visualRowIndex]};`;

                if(!tdStyle.includes('color:') && colColors[visualRowIndex])
                    tdStyle += `color:${colColors[visualRowIndex]};`;
                if(!tdDarkStyle.includes('color:') && colDarkColors[visualRowIndex])
                    tdDarkStyle += `color:${colDarkColors[visualRowIndex]};`;

                if(!tdClassList.includes('wiki-table-keepall') && colKeepAll[visualRowIndex])
                    tdClassList.push('wiki-table-keepall');

                if(value.endsWith('\n')) value = value.slice(0, -1);

                htmlValues.push(`
<td${tdStyle ? ` style="${tdStyle}"` : ''}${tdDarkStyle ? ` data-dark-style="${tdDarkStyle}"` : ''}${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan ? ` rowspan="${rowspan}"` : ''}${tdClassList.length ? ` class="${tdClassList.join(' ')}"` : ''}><div class="wiki-paragraph"><removeNewlineLater/>
${value}
<removeNewlineLater/></div></td>
`.trim());

                colspan = 1;
            }

            htmlRows.push(`<tr${trStyle ? ` style="${trStyle}"` : ''}${trDarkStyle ? ` data-dark-style="${trDarkStyle}"` : ''}>${htmlValues.join('')}</tr>`);
        }

        rows.length = 0;

        const tableWrapperClassList = ['wiki-table-wrap'];

        if(tableAlign) tableWrapperClassList.push(`table-${tableAlign}`);

        const table = `<removeNewlineLater/>${removeNewParagraph ? '' : '</div>'}<div class="${tableWrapperClassList.join(' ')}"${tableWrapStyle ? ` style="${tableWrapStyle}"` : ''}><table class="wiki-table"${tableStyle ? ` style="${tableStyle}"` : ''}${tableDarkStyle ? ` data-dark-style="${tableDarkStyle}"` : ''}><tbody>${htmlRows.join('')}</tbody></table></div>${removeNewParagraph ? '' : '<div class="wiki-paragraph">'}<removeNewlineLater/>\n`;

        return table + (fromLastLine ? '' : '\n' + content);
    },
    format(content, namumark, _, isLastLine, removeNewParagraph = false) {
        const rows = namumark.syntaxData.rows ??= [];
        const rowText = namumark.syntaxData.rowText ??= '';

        const makeTable = (fromLastLine = false) => this.makeTable(content, namumark, fromLastLine, removeNewParagraph);

        const trimedContent = content.trim();
        if(!trimedContent.startsWith('||') && !rowText) {
            return makeTable();
        }

        const newRowText = namumark.syntaxData.rowText += (rowText ? '\n' : '') + content;

        if(newRowText.length > 2 && newRowText.endsWith('||')) {
            rows.push(newRowText.split(/(?<!\\)\|\|/).slice(1, -1).map(a => a.replaceAll('\\||', '||')));
            namumark.syntaxData.rowText = '';
        }

        if(isLastLine) return makeTable(true);

        return '';
    },
    parse(content, removeNewParagraph = false) {
        const fakeNamumark = {
            syntaxData: {}
        }

        const lines = content.split('\n');

        const newLines = [];
        let removeNextNewLine = false;
        const pushLine = text => {
            // if(removeNextNewLine) {
            //     if(!newLines.length) newLines.push(text);
            //     else newLines[newLines.length - 1] += text;
            //     removeNextNewLine = false;
            // }
            // else newLines.push(text);
            newLines.push(text);
        }

        for(let i in lines) {
            i = parseInt(i);
            const line = lines[i];
            const isLastLine = i === lines.length - 1;
            let output = this.format(line, fakeNamumark, lines, isLastLine, removeNewParagraph);

            let setRemoveNextNewLine = false;
            if(output === '') continue;
            if(output != null) {
                // if(output.includes('<removeNextNewline/>')) {
                //     output = output.replace('<removeNextNewline/>', '');
                //     setRemoveNextNewLine = true;
                // }
                //
                // if(output.includes('<removeNewline/>')) {
                //     output = output.replace('<removeNewline/>', '');
                //     if(!newLines.length) pushLine(output);
                //     else newLines[newLines.length - 1] += output;
                // }
                // else pushLine(output);
                pushLine(output);
            }
            else pushLine(line);

            if(setRemoveNextNewLine) removeNextNewLine = true;
        }

        return newLines.join('\n');
    }
}