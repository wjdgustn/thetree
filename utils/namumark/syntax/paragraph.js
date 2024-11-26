module.exports = {
    fullLine: true,
    format(content, namumark) {
        if(!content.startsWith('=')) return;

        return `[문단]${content}[/문단]`;
    }
}