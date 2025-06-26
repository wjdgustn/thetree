const utils = require('../utils');

module.exports = async (obj, toHtml) => {
    const rows = obj.rows;

    let tableAlign;
    const colBgColors = [];
    const colDarkBgColors = [];
    const colColors = [];
    const colDarkColors = [];
    const colKeepAll = [];

    const trClassList = [];

    let tableWrapStyle = ';';
    let tableStyle = ';';
    let tableDarkStyle = ';';

    let prevColspan = 1;
    const aliveRowSpans = [];

    const htmlRows = [];
    for(let colIndex in rows) {
        colIndex = parseInt(colIndex);
        const row = rows[colIndex];
        const htmlValues = [];

        let colspan = 1;

        let trStyle = ';';
        let trDarkStyle = ';';

        for(let i = 0; i < aliveRowSpans.length; i++) {
            const val = aliveRowSpans[i];
            if(val > 0) aliveRowSpans[i]--;
        }

        let visualRowIndex = -1;
        for(let rowIndex in row) {
            rowIndex = parseInt(rowIndex);
            const value = row[rowIndex];
            if(!value) {
                colspan++;
                continue;
            }
            visualRowIndex += prevColspan;

            const aliveRowSpan = aliveRowSpans[visualRowIndex];
            if(aliveRowSpan > 0) visualRowIndex++;

            const tdClassList = [];
            let tdStyle = ';';
            let tdDarkStyle = ';';
            let align;
            let rowspan;
            let colspanAssigned = false;
            let colBgColorAssigned = false;
            let colColorAssigned = false;

            let firstTextObj = value[0].lines?.[0][0];
            if(firstTextObj?.type !== 'text') firstTextObj = null;
            let lastTextObj = value.at(-1).lines?.at(-1).at(-1);
            if(lastTextObj?.type !== 'text') lastTextObj = null;

            let paramStr = firstTextObj?.text;
            const originalParamStr = paramStr;
            const prevParamStrLength = paramStr?.length;
            if(paramStr) while(paramStr.startsWith('<')) {
                const closeIndex = paramStr.indexOf('>');
                if(closeIndex === -1) break;

                const tagStr = paramStr.slice(1, closeIndex);

                const splittedTagStr = tagStr.split('=');
                const [name, value] = splittedTagStr;

                const splittedValue = (value || name)?.split(',') ?? [];
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

                    let [name, value] = splittedTableStr;
                    if(value.startsWith('"') && value.endsWith('"')) {
                        value = value.slice(1, -1);
                    }
                    else if(value.startsWith("'") && value.endsWith("'")) {
                        value = value.slice(1, -1);
                    }
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
                        if(tableStyle.includes(';color:')) break;

                        tableStyle += `color:${light};`;
                        if(dark) tableDarkStyle += `color:${dark};`;
                    }
                    else if(name === 'bgcolor') {
                        if(tableStyle.includes(';background-color:')) break;

                        tableStyle += `background-color:${light};`;
                        if(dark) tableDarkStyle += `background-color:${dark};`;
                    }
                    else if(name === 'bordercolor') {
                        if(tableStyle.includes(';border:')) break;

                        tableStyle += `border:2px solid ${light};`;
                        if(dark) tableDarkStyle += `border:2px solid ${dark};`;
                    }
                    else if(name === 'width') {
                        if(tableWrapStyle.includes(';width:')) break;

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
                    if(tdStyle.includes(';width:')) break;

                    const size = utils.parseSize(value);
                    if(!size) return;

                    tdStyle += `width:${size.value}${size.unit};`;
                }
                else if(name === 'height') {
                    if(tdStyle.includes(';height:')) break;

                    const size = utils.parseSize(value);
                    if(!size) return;

                    tdStyle += `height:${size.value}${size.unit};`;
                }
                else if(tagStr === 'nopad') {
                    if(tdClassList.includes('wiki-table-nopadding')) break;

                    tdClassList.push('wiki-table-nopadding');
                }
                else if(name === 'bgcolor') {
                    if(tdStyle.includes(';background-color:')) break;

                    tdStyle += `background-color:${light};`;
                    if(dark) tdDarkStyle += `background-color:${dark};`;
                }
                else if(name === 'colbgcolor') {
                    if(colBgColorAssigned) break;

                    colBgColors[visualRowIndex] = light;
                    if(dark) colDarkBgColors[visualRowIndex] = dark;

                    colBgColorAssigned = true;
                }
                else if(name === 'rowbgcolor') {
                    if(trStyle.includes(';background-color:')) break;

                    trStyle += `background-color:${light};`;
                    if(dark) trDarkStyle += `background-color:${dark};`;
                }
                else if(name === 'color') {
                    if(tdStyle.includes(';color:')) break;

                    tdStyle += `color:${light};`;
                    if(dark) tdDarkStyle += `color:${dark};`;
                }
                else if(name === 'colcolor') {
                    if(colColorAssigned) break;

                    colColors[visualRowIndex] = light;
                    if(dark) colDarkColors[visualRowIndex] = dark;

                    colColorAssigned = true;
                }
                else if(name === 'rowcolor') {
                    if(trStyle.includes(';color:')) break;

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
                else if([1, 2].includes(splittedValue.length)
                    && splittedValue.every(a => utils.validateColor(a))) {
                    if(tdStyle.includes(';background-color:')) break;

                    tdStyle += `background-color:${light};`;
                    if(dark) tdDarkStyle += `background-color:${dark};`;
                }
                else break;

                paramStr = paramStr.slice(closeIndex + '>'.length);
            }

            if(paramStr != null) firstTextObj.text = originalParamStr.slice(prevParamStrLength - paramStr.length);

            const startsWithSpace = firstTextObj?.text.startsWith(' ');
            const endsWithSpace = lastTextObj?.text.endsWith(' ');

            if(startsWithSpace && endsWithSpace) {
                align ??= 'center';
                firstTextObj.text = firstTextObj.text.slice(1);
                lastTextObj.text = lastTextObj.text.slice(0, -1);
            } else if(startsWithSpace) {
                align ??= 'right';
                firstTextObj.text = firstTextObj.text.slice(1);
            } else if(endsWithSpace) {
                align ??= 'left';
                lastTextObj.text = lastTextObj.text.slice(0, -1);
            }
            if(align) tdStyle += `text-align:${align};`;

            if(!tdStyle.includes(';background-color:') && colBgColors[visualRowIndex])
                tdStyle += `background-color:${colBgColors[visualRowIndex]};`;
            if(!tdDarkStyle.includes(';background-color:') && colDarkBgColors[visualRowIndex])
                tdDarkStyle += `background-color:${colDarkBgColors[visualRowIndex]};`;

            if(!tdStyle.includes(';color:') && colColors[visualRowIndex])
                tdStyle += `color:${colColors[visualRowIndex]};`;
            if(!tdDarkStyle.includes(';color:') && colDarkColors[visualRowIndex])
                tdDarkStyle += `color:${colDarkColors[visualRowIndex]};`;

            if(!tdClassList.includes('wiki-table-keepall') && colKeepAll[visualRowIndex])
                tdClassList.push('wiki-table-keepall');

            tdStyle = tdStyle.slice(1);
            tdDarkStyle = tdDarkStyle.slice(1);

            htmlValues.push(`<td${tdStyle ? ` style="${tdStyle}"` : ''}${tdDarkStyle ? ` data-dark-style="${tdDarkStyle}"` : ''}${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan ? ` rowspan="${rowspan}"` : ''}${tdClassList.length ? ` class="${tdClassList.join(' ')}"` : ''}>${await toHtml(value)}</td>`.trim());

            for(let i = 0; i < colspan; i++) {
                aliveRowSpans[visualRowIndex + i] = rowspan ?? 0;
            }

            prevColspan = colspan;
            colspan = 1;
        }

        trStyle = trStyle.slice(1);
        trDarkStyle = trDarkStyle.slice(1);
        htmlRows.push(`<tr${trStyle ? ` style="${trStyle}"` : ''}${trDarkStyle ? ` data-dark-style="${trDarkStyle}"` : ''}>${htmlValues.join('')}</tr>`);

        prevColspan = 1;
    }

    const tableWrapperClassList = ['wiki-table-wrap'];

    if(tableAlign) tableWrapperClassList.push(`table-${tableAlign}`);

    tableWrapStyle = tableWrapStyle.slice(1);
    tableStyle = tableStyle.slice(1);
    tableDarkStyle = tableDarkStyle.slice(1);

    return `<div class="${tableWrapperClassList.join(' ')}"${tableWrapStyle ? ` style="${tableWrapStyle}"` : ''}><table class="wiki-table"${tableStyle ? ` style="${tableStyle}"` : ''}${tableDarkStyle ? ` data-dark-style="${tableDarkStyle}"` : ''}><tbody>${htmlRows.join('')}</tbody></table></div>`;
}