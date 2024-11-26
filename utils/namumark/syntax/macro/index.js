const { Priority } = require('../../types');

module.exports = {
    priority: Priority.Macro,
    openStr: `[`,
    closeStr: `]`,
    format: async (content, sourceContent) => {
        return null;
    }
}