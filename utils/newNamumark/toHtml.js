const { highlight } = require('highlight.js');

const utils = require('./utils');
const mainUtils = require('../');
const globalUtils = require('../global');
const { ACLTypes } = require('../types');

const parser = require('./parser');

const link = require('./syntax/link');
const macro = require('./syntax/macro');
const table = require('./syntax/table');

const ACL = require('../../class/acl');

const Document = require('../../schemas/document');
const History = require('../../schemas/history');

const MAXIMUM_LENGTH = 1000000;
const MAXIMUM_LENGTH_HTML = '<h2>문서 길이가 너무 깁니다.</h2>';

const topToHtml = async (parsed, options = {}) => {
    options.originalDocument ??= options.document;
    const {
        document,
        dbDocument,
        originalDocument,
        rev,
        thread = false,
        dbComment,
        aclData = {},
        commentId,
        req,
        includeData = null
    } = options;

    const Store = options.Store ??= {
        dbDocuments: [],
        revDocCache: [],
        parsedIncludes: [],
        links: [],
        files: [],
        categories: [],
        heading: {
            list: [],
            html: ''
        },
        error: null,
        voteIndex: -1,
        macro: {
            counts: {}
        }
    }

    const toHtml = (doc, newOptions) => topToHtml(doc, {
        ...options,
        ...newOptions,
        skipInit: true
    });

    const isTop = !!parsed?.result;
    let doc = isTop ? parsed.result : parsed;

    if(!isTop && !Array.isArray(doc))
        doc = [doc];

    if(!isTop && !parsed) return '';

    // if(Array.isArray(doc[0])) {
    //     const lines = [];
    //     for(let line of doc) {
    //         lines.push(await toHtml(line));
    //     }
    //     return lines.join('<br>');
    // }

    const commentPrefix = commentId ? `tc${commentId}-` : '';

    if(parsed.data && !options.skipInit) {
        const includeParams = [];
        for(let [docName, params] of Object.entries(parsed.data.includeParams)) {
            const parsedName = mainUtils.parseDocumentName(docName);
            let doc = includeParams.find(a => a.namespace === parsedName.namespace && a.title === parsedName.title);
            if(!doc) {
                doc = {
                    ...parsedName,
                    params: []
                }
                includeParams.push(doc);
            }
            doc.params.push(...params);
        }

        const parsedDocAdder = (result, parsedDocs = [], includeParams = []) => {
            const links = [...new Set([
                ...result.data.links,
                ...result.data.categories.map(a => '분류:' + a.document),
                ...result.data.includes
            ])];

            const paramLinks = links.filter(a => a.includes('@'));
            if(includeParams.length) {
                for(let link of paramLinks) {
                    for(let params of includeParams) {
                        const newLink = utils.parseIncludeParams(link, params);
                        if(!links.includes(newLink))
                            links.push(newLink);
                    }
                }
            }
            else {
                for(let link of paramLinks) {
                    const newLink = utils.parseIncludeParams(link);
                    if(!links.includes(newLink))
                        links.push(newLink);
                }
            }

            for(let link of links) {
                if(link.startsWith(':')) {
                    const slicedLink = link.slice(1);
                    if(config.namespaces.some(a => slicedLink.startsWith(a + ':')))
                        link = slicedLink;
                }
                if(document) {
                    const docTitle = globalUtils.doc_fulltitle(document);
                    if(link.startsWith('../')) {
                        link = link.slice(3);

                        const splittedDocument = docTitle.split('/');
                        splittedDocument.pop();
                        const document = splittedDocument.join('/');
                        link = `${document}${(document && link) ? '/' : ''}${link}`;

                        link ||= docTitle;
                    }
                    else if(link.startsWith('/'))
                        link = docTitle + link;
                }

                const item = mainUtils.parseDocumentName(link);
                if(!parsedDocs.some(a => a.namespace === item.namespace && a.title === item.title))
                    parsedDocs.push(item);

                if(result.data.includes.includes(link))
                    item.isInclude = true;
            }
            return parsedDocs;
        }
        const parsedDocFinder = async parsedDocs => {
            parsedDocs = parsedDocs
                .filter(a => !Store.dbDocuments.some(b => a.namespace === b.namespace && a.title === b.title));

            const namespaces = [...new Set(parsedDocs.map(a => a.namespace))];

            const query = { $or: [] };
            for(let namespace of namespaces) {
                query.$or.push({
                    namespace,
                    title: {
                        $in: parsedDocs.filter(a => a.namespace === namespace).map(a => a.title)
                    }
                });
            }
            if(query.$or.length) {
                const result = await Document.find(query);
                Store.dbDocuments.push(...[
                    ...result,
                    ...parsedDocs
                        .map(a => !result.some(b => a.namespace === b.namespace && a.title === b.title) ? {
                            ...a,
                            contentExists: false
                        } : null)
                        .filter(a => a)
                ]);
            }

            if(!thread) {
                const revDocs = Store.dbDocuments
                    .filter(a => (a.namespace.includes('파일')
                            || parsedDocs.find(b => a.namespace === b.namespace && a.title === b.title)?.isInclude)
                        && !Store.revDocCache.some(b => a.namespace === b.namespace && a.title === b.title));
                const docRevs = await History.find({
                    document: {
                        $in: revDocs.map(a => a.uuid)
                    }
                }).sort({ rev: -1 });

                const nsACLResultCache = {};
                for(let doc of revDocs) {
                    let readable;
                    if(doc.contentExists) {
                        if(doc.lastReadACL === -1) {
                            if(nsACLResultCache[doc.namespace] == null) {
                                const acl = await ACL.get({ namespace: doc.namespace }, doc);
                                const { result } = await acl.check(ACLTypes.Read, aclData);
                                readable = result;
                                nsACLResultCache[doc.namespace] = readable;
                            }

                            readable = nsACLResultCache[doc.namespace];
                        }
                        else {
                            const acl = await ACL.get({ document: doc });
                            const { result } = await acl.check(ACLTypes.Read, aclData);
                            readable = result;
                        }
                    }
                    else readable = false;

                    Store.revDocCache.push({
                        namespace: doc.namespace,
                        title: doc.title,
                        readable,
                        rev: docRevs.find(a => a.document === doc.uuid)
                    });
                }
            }
        }

        const topDocs = parsedDocAdder(parsed);
        await parsedDocFinder(topDocs);

        const includeDocs = [];
        for(let docName of topDocs.filter(a => a.isInclude)) {
            const doc = Store.revDocCache.find(a => a.namespace === docName.namespace && a.title === docName.title);
            if(!doc) continue;
            if(doc && doc.rev?.content != null) {
                const params = includeParams
                    .find(a => a.namespace === docName.namespace && a.title === docName.title)?.params ?? [];
                doc.parseResult = parser(doc.rev.content);
                parsedDocAdder(doc.parseResult, includeDocs, params);
            }
        }
        await parsedDocFinder(includeDocs);

        Store.categories = parsed.data.categories;
        for(let obj of Store.categories) {
            const cache = Store.dbDocuments.find(cache => cache.namespace === '분류' && cache.title === obj.document);
            obj.notExist = !cache?.contentExists;
        }
    }

    if(isTop) {
        let html = '<div class="wiki-macro-toc">';
        let indentLevel = 0;
        for(let heading of parsed.data.headings) {
            const prevIndentLevel = indentLevel;
            indentLevel = heading.actualLevel;

            const indentDiff = Math.abs(indentLevel - prevIndentLevel);

            if(indentLevel !== prevIndentLevel)
                for(let i = 0; i < indentDiff; i++)
                    html += indentLevel > prevIndentLevel ? '<div class="toc-indent">' : '</div>';

            html += `<span class="toc-item"><a href="#${commentPrefix}s-${heading.numText}">${heading.numText}</a>. ${await toHtml(heading.linkText)}</span>`;

            Store.heading.list.push({
                level: heading.level,
                num: heading.numText,
                title: utils.unescapeHtml(await toHtml(heading.pureText)),
                anchor: `s-${heading.numText}`
            });
        }
        for(let i = 0; i < indentLevel + 1; i++)
            html += '</div>';

        Store.heading.html = html;
    }

    let result = '';
    for(let obj of doc) {
        if(Store.error) break;
        if(result.length > MAXIMUM_LENGTH) {
            Store.error = MAXIMUM_LENGTH_HTML;
            break;
        }

        if(Array.isArray(obj)) {
            const lines = [];
            for(let line of obj) {
                lines.push(await toHtml(line));
            }
            result += lines.join('');
            continue;
        }

        switch(obj.type) {
            case 'paragraph': {
                result += `<div class="wiki-paragraph">${await toHtml(obj.lines)}</div>`;
                break;
            }

            case 'heading': {
                const text = await toHtml(obj.text);

                result += `<h${obj.level} class="wiki-heading${obj.closed ? ' wiki-heading-folded' : ''}">`;
                result += `<a id="s-${obj.numText}" href="#${commentPrefix}toc">${obj.numText}.</a>`;
                result += ` <span id="${globalUtils.removeHtmlTags(text)}">${text}`;
                if(!thread) result += `
<span class="wiki-edit-section">
<a href="${utils.escapeHtml(globalUtils.doc_action_link(document, 'edit', {
                    section: obj.sectionNum
                }))}" rel="nofollow">[편집]</a>
</span>`.trim();
                result += `</span></h${obj.level}>`;
                result += `<div class="wiki-heading-content${obj.closed ? ' wiki-heading-content-folded' : ''}">`;
                result += await toHtml(obj.content);
                result += `</div>`;
                break;
            }
            case 'table':
                result += await table(obj, toHtml);
                break;
            case 'indent':
                result += `<div class="wiki-indent">${await toHtml(obj.content)}</div>`;
                break;
            case 'blockquote':
                result += `<blockquote class="wiki-quote">${await toHtml(obj.content)}</blockquote>`;
                break;
            case 'hr':
                result += '<hr>';
                break;
            case 'list': {
                const tagName = obj.listType === '*' ? 'ul' : 'ol';
                const listClass = {
                    '*': '',
                    '1': '',
                    'a': 'wiki-list-alpha',
                    'A': 'wiki-list-upper-alpha',
                    'i': 'wiki-list-roman',
                    'I': 'wiki-list-upper-roman'
                }[obj.listType];
                result += `<${tagName} class="wiki-list${listClass ? ` ${listClass}` : ''}"${tagName === 'ol' ? ` start="${obj.startNum}"` : ''}>`;
                for(let item of obj.items) {
                    result += `<li>${await toHtml(item)}</li>`;
                }
                result += `</${tagName}>`;
                break;
            }

            case 'wikiSyntax':
                let wikiParamsStr = utils.parseIncludeParams(obj.wikiParamsStr, includeData);

                const styleCloseStr = '"';

                const darkStyleOpenStr = 'dark-style="';
                const darkStyleIndex = wikiParamsStr.indexOf(darkStyleOpenStr);
                const darkStyleEndIndex = wikiParamsStr.indexOf(styleCloseStr, darkStyleIndex + darkStyleOpenStr.length);
                let darkStyle;
                if(darkStyleIndex >= 0 && darkStyleEndIndex >= 0) {
                    darkStyle = wikiParamsStr.slice(darkStyleIndex + darkStyleOpenStr.length, darkStyleEndIndex);
                    wikiParamsStr = wikiParamsStr.slice(0, darkStyleIndex) + wikiParamsStr.slice(darkStyleEndIndex + styleCloseStr.length);
                }

                const styleOpenStr = 'style="';
                const styleIndex = wikiParamsStr.indexOf(styleOpenStr);
                const styleEndIndex = wikiParamsStr.indexOf('"', styleIndex + styleOpenStr.length);
                let style;
                if(styleIndex >= 0 && styleEndIndex >= 0) {
                    style = wikiParamsStr.slice(styleIndex + styleOpenStr.length, styleEndIndex);
                }

                style = utils.cssFilter(style);
                darkStyle = utils.cssFilter(darkStyle);

                result += `<div${style ? ` style="${style}"` : ''}${darkStyle ? ` data-dark-style="${darkStyle}"` : ''}>${await toHtml(obj.content)}</div>`;
                break;
            case 'syntaxSyntax':
                result += `<pre><code>${highlight(obj.content, { language: obj.lang }).value}</code></pre>`;
                break;
            case 'htmlSyntax':
                result += utils.sanitizeHtml(utils.parseIncludeParams(obj.text, includeData));
                break;
            case 'folding':
                result += `<dl class="wiki-folding"><dt>${utils.escapeHtml(obj.text)}</dt><dd class="wiki-folding-close-anim">${await toHtml(obj.content)}</dd></dl>`;
                break;
            case 'ifSyntax':
                const { bool } = utils.parseExpression(obj.expression, includeData ?? {});
                if(bool) result += await toHtml(obj.content);
                break;

            case 'text':
                result += utils.escapeHtml(utils.parseIncludeParams(obj.text, includeData)).replaceAll('\n', '<br>');
                break;
            case 'bold':
                result += `<strong>${await toHtml(obj.content)}</strong>`;
                break;
            case 'italic':
                result += `<em>${await toHtml(obj.content)}</em>`;
                break;
            case 'strike':
                result += `<del>${await toHtml(obj.content)}</del>`;
                break;
            case 'underline':
                result += `<u>${await toHtml(obj.content)}</u>`;
                break;
            case 'sup':
                result += `<sup>${await toHtml(obj.content)}</sup>`;
                break;
            case 'sub':
                result += `<sub>${await toHtml(obj.content)}</sub>`;
                break;
            case 'legacyMath':
                result += utils.katex(obj.content);
                break;
            case 'commentNumber':
                result += `<a href="#${obj.num}" class="wiki-self-link">#${obj.num}</a>`;
                break;
            case 'scaleText':
                result += `<span class="wiki-size-${obj.isSizeUp ? 'up' : 'down'}-${obj.size}">${await toHtml(obj.content)}</span>`;
                break;
            case 'colorText':
                result += `<span${obj.color ? ` style="color:${obj.color}"` : ''}${obj.darkColor ? ` data-dark-style="color:${obj.darkColor}"` : ''}>${await toHtml(obj.content)}</span>`;
                break;
            case 'literal': {
                const hasNewline = obj.text.includes('\n');
                const text = utils.escapeHtml(obj.text).replaceAll('\n', '<br>');
                if(hasNewline) result += '<pre>';
                result += `<code>${text}</code>`;
                if(hasNewline) result += '</pre>';
                break;
            }
            case 'link':
                result += await link(obj, {
                    document: originalDocument,
                    dbDocument,
                    rev,
                    thread,
                    toHtml,
                    Store,
                    includeData
                });
                break;
            case 'macro':
                obj.params = utils.parseIncludeParams(obj.params, includeData);
                result += await macro(obj, {
                    thread,
                    dbComment,
                    includeData,
                    commentPrefix,
                    commentId,
                    toHtml,
                    aclData,
                    Store,
                    heading: Store.heading,
                    revDocCache: Store.revDocCache,
                    parsedIncludes: Store.parsedIncludes
                });
                break;
            case 'footnote': {
                const name = obj.name;
                const value = await toHtml(obj.value);
                result += `<a class="wiki-fn-content" title="${globalUtils.removeHtmlTags(value)}" href="#${commentPrefix}fn-${name}"><span id="${commentPrefix}rfn-${obj.index}"></span>[${name}]</a>`;
                break;
            }

            default:
                console.trace();
                console.error('missing implementation:', obj.type);
        }
    }

    if(Store.error)
        result = Store.error;

    if(isTop) return {
        html: result,
        links: Store.links,
        files: Store.files,
        categories: Store.categories,
        headings: Store.heading.list,
        hasError: !!Store.error
    }
    return result;
}

module.exports = topToHtml;