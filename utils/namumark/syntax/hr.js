module.exports = {
    fullLine: true,
    format(content) {
        if(!content.startsWith('----')) return;

        let length = 0;
        for(let i = 0; i < content.length; i++) {
            const char = content[i];
            if(char !== '-') return;
            length++;

            if(length > 9) return;
        }

        return `<removeNewLine/><removeNextNewLine/></div><hr><div class="wiki-paragraph">`;
    }
}