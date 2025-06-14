const utils = require('./utils');
const mainUtils = require('../');
const globalUtils = require('../global');
const { ACLTypes } = require('../types');

const link = require('./syntax/link');
const macro = require('./syntax/macro');
const table = require('./syntax/table');

const ACL = require('../../class/acl');

const Document = require('../../schemas/document');
const History = require('../../schemas/history');

const topToHtml = async (parsed, options = {}) => {
    if(!parsed) return '';

    options.originalDocument ??= options.document;
    const {
        document,
        dbDocument,
        originalDocument,
        rev,
        thread = false,
        aclData = {},
        commentId,
        req,
        includeData = null
    } = options;

    const Store = options.Store ??= {
        dbDocuments: [],
        revDocCache: [],
        categories: [],
        headings: []
    }

    const toHtml = doc => topToHtml(doc, options);

    const isTop = !!parsed.result;
    let doc = isTop ? parsed.result : parsed;

    if(!isTop && !Array.isArray(doc))
        doc = [doc];

    // if(Array.isArray(doc[0])) {
    //     const lines = [];
    //     for(let line of doc) {
    //         lines.push(await toHtml(line));
    //     }
    //     return lines.join('<br>');
    // }

    const commentPrefix = commentId ? `tc${commentId}-` : '';

    if(parsed.data) {
        Store.headings = parsed.data.headings;

        const parsedDocs = [];
        for(let link of [
            ...parsed.data.links,
            ...parsed.data.categories.map(a => '분류:' + a),
            ...parsed.data.includes
        ]) {
            if(link.startsWith(':')) {
                const slicedLink = link.slice(1);
                if(config.namespaces.some(a => slicedLink.startsWith(a + ':')))
                    link = slicedLink;
            }
            parsedDocs.push(mainUtils.parseDocumentName(link));
        }
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
            Store.dbDocuments = [
                ...result,
                ...parsedDocs
                    .map(a => !result.some(b => a.namespace === b.namespace && a.title === b.title) ? {
                        ...a,
                        contentExists: false
                    } : null)
                    .filter(a => a)
            ]
        }

        const revDocs = Store.dbDocuments
            .filter(a => a.namespace.includes('파일') || parsed.data.includes.includes(globalUtils.doc_fulltitle(a)));
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

    let result = '';
    for(let obj of doc) {
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
                result += `<div${obj.style ? ` style="${obj.style}"` : ''}${obj.darkStyle ? ` data-dark-style="${obj.darkStyle}"` : ''}>${await toHtml(obj.content)}</div>`;
                break;
            case 'htmlSyntax':
                result += obj.safeHtml;
                break;
            case 'folding':
                result += `<dl class="wiki-folding"><dt>${utils.escapeHtml(obj.text)}</dt><dd class="wiki-folding-close-anim">${await toHtml(obj.content)}</dd></dl>`;
                break;

            case 'text':
                result += utils.escapeHtml(obj.text).replaceAll('\n', '<br>');
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
                    Store
                });
                break;
            case 'macro':
                result += await macro(obj, {
                    includeData,
                    commentPrefix,
                    toHtml,
                    headings: Store.headings
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

    if(isTop) return {
        html: result
    }
    return result;
}

module.exports = topToHtml;