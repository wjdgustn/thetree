module.exports = {
    fullLine: true,
    check: content => {
        const trimedContent = content.trimStart();

        if(!trimedContent.startsWith('----')) return false;

        let length = 0;
        for(let i = 0; i < trimedContent.length; i++) {
            const char = trimedContent[i];
            if(char !== '-') return false;
            length++;

            if(length > 9) return false;
        }

        return true;
    },
    format(content) {
        if(!this.check(content)) return;

        const trimedContent = content.trimStart();
        const spaceCount = content.length - trimedContent.length;

        return `<!noParagraph>${' '.repeat(spaceCount)}<hr><!/noParagraph>`;
    }
}