module.exports = {
    fullLine: true,
    check: content => {
        const trimedContent = content.trimStart();

        if(!trimedContent.startsWith('----')) return false;

        let length = 0;
        for(let i = 0; i < trimedContent.length; i++) {
            const char = trimedContent[i];

            if(char === '<') {
                const tagEnd = trimedContent.indexOf('>', i);
                if(tagEnd === -1) return false;
                i = tagEnd;
                continue;
            }

            if(char !== '-') return false;
            length++;

            if(length > 9) return false;
        }

        return true;
    },
    format(content) {
        const trimedContent = content.trimStart();

        if(!trimedContent.startsWith('----')) return;

        let length = 0;
        for(let i = 0; i < trimedContent.length; i++) {
            const char = trimedContent[i];

            if(char === '<') {
                const tagEnd = trimedContent.indexOf('>', i);
                if(tagEnd === -1) return;
                i = tagEnd;
                continue;
            }

            if(char !== '-') return;
            length++;

            if(length > 9) return;
        }
        const spaceCount = content.length - trimedContent.length;
        const otherStr = trimedContent.slice(length);

        return `<!noParagraph>${' '.repeat(spaceCount)}<hr><!/noParagraph>` + otherStr;
    }
}