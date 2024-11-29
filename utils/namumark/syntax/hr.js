module.exports = {
    fullLine: true,
    check: content => {
        if(!content.startsWith('----')) return false;

        let length = 0;
        for(let i = 0; i < content.length; i++) {
            const char = content[i];
            if(char !== '-') return false;
            length++;

            if(length > 9) return false;
        }

        return true;
    },
    format(content) {
        if(!this.check(content)) return;

        return `<removeNewlineLater/></div><hr><div class="wiki-paragraph"><removeNewlineLater/>`;
    }
}