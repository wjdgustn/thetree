const { Priority } = require('../types');

module.exports = {
    priority: Priority.Literal,
    fullLine: true,
    format(content, _, lines) {
        if(lines.length !== 1) return;

        if(!content.startsWith('#redirect ')) return;

        return `#redirect [[${content.slice('#redirect '.length)}]]`;
    }
}