module.exports = {
    openStr: `[`,
    closeStr: `]`,
    format: async (content, sourceContent) => {
        return `im macro ${content}`;
    }
}