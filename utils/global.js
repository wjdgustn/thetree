module.exports = {
    doc_fulltitle(document) {
        const type = typeof document;

        if(type === 'string') return document;
        if(type === 'object') {
            if(document.forceShowNamespace === false) return document.title;
            return `${document.namespace}:${document.title}`;
        }
    },
    user_doc(str) {
        return `사용자:${str}`;
    },
    contribution_link(uuid) {
        return `/contribution/${uuid}/document`;
    },
    contribution_link_discuss(uuid) {
        return `/contribution/${uuid}/discuss`;
    },
    doc_action_link(document, route, query = {}) {
        let str = `/${route}/${this.doc_fulltitle(document)}`;
        if(Object.keys(query).length > 0) {
            str += '?';
            str += Object.keys(query).map(k => `${k}=${query[k]}`).join('&');
        }
        return str;
    }
}