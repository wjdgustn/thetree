const { Priority } = require('../types');

module.exports = {
    priority: Priority.Literal,
    fullLine: true,
    format(content, namumark, lines) {
        if(lines.length !== 1) return;

        if(!content.startsWith('#redirect ')) return;

        const docName = content.slice('#redirect '.length);
        namumark.redirect = docName;
        return `#redirect [[${docName}]]`;
    }
}