module.exports = {
    escapeHtml: text => text
        .replaceAll('&', "&amp;")
        .replaceAll('<', "&lt;")
        .replaceAll('>', "&gt;")
        .replaceAll(`"`, "&quot;")
        .replaceAll(`'`, "&#039;"),
    unescapeHtml: text => text
        .replaceAll("&amp;", '&')
        .replaceAll("&lt;", '<')
        .replaceAll("&gt;", '>')
        .replaceAll("&quot;", `"`)
        .replaceAll("&#039;", `'`),
    removeEscapedChar: text => {
        let newText = '';
        for(let i = 0; i < text.length; i++) {
            if(text[i] === '\\') {
                i++;
                continue;
            }
            newText += text[i];
        }
        return newText;
    }
}