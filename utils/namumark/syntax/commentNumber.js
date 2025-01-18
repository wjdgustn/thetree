const { Priority } = require('../types');


module.exports = {
    priority: Priority.Last,
    fullContent: true,
    format(sourceText, namumark) {
        if(!namumark.thread) return sourceText;

        let text = '';

        let sourceTextPos = 0;
        let repeatCount = 0;
        while(sourceTextPos < sourceText.length) {
            if(repeatCount++ > 100000) return '<span style="color:red">render error</span>';
            let newText = '';
            let textLength = 0;

            const sharpPos = sourceText.indexOf('#', sourceTextPos);
            const openTagPos = sourceText.indexOf('<', sourceTextPos);

            const isEscapeChar = sourceText.slice(sourceTextPos - 1, sourceTextPos - 1 + '&#039;'.length) === '&#039;';

            if(sharpPos === sourceTextPos && !isEscapeChar) {
                let num = '';
                let numPos = sourceTextPos + 1;
                while(!isNaN(sourceText[numPos])) {
                    num += sourceText[numPos];
                    numPos++;
                }

                if(num) {
                    newText = `<a href="#${num}" class="wiki-self-link">#${num}</a>`;
                    textLength = num.length + 1;
                }
                else newText = '#';
            }
            else if(openTagPos === sourceTextPos) {
                const closeTagPos = sourceText.indexOf('>', sourceTextPos + 1);
                if(closeTagPos !== -1) {
                    const tagName = sourceText.slice(sourceTextPos + 1, closeTagPos);
                    const closePos = sourceText.indexOf(`</${tagName.split(' ')[0]}>`, closeTagPos + 1);
                    if(closePos !== -1) newText = sourceText.slice(sourceTextPos, closePos + 1);
                    else newText = sourceText.slice(sourceTextPos, closeTagPos);
                }
            }
            else {
                const target = [sharpPos, openTagPos].filter(a => a !== -1);
                let nextPos = target.length ? Math.min(...target) : sourceText.length;
                if(isEscapeChar) nextPos++;
                newText = sourceText.slice(sourceTextPos, nextPos);
            }

            text += newText;
            sourceTextPos += textLength || newText.length;
        }

        return text;
    }
}