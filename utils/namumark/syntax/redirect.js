const { Priority } = require('../types');

module.exports = {
    priority: Priority.Literal,
    fullLine: true,
    format(content, namumark, lines) {
        if(lines.length !== 1) return;

        if(!content.startsWith('#redirect ')) return;

        const docName = content.slice('#redirect '.length);
        namumark.redirect = docName;
        let link = docName;
        if(link.startsWith('파일:') || link.startsWith('분류:')) link = `:${link}`;
        return `#redirect [[${link}]]`;
    }
}