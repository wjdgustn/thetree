const mongoose = require('mongoose');
const Diff = require('diff');
const { getChoseong } = require('es-hangul');

const utils = require('./');
const { BacklinkFlags, ACLTypes, HistoryTypes} = require('./types');

const ACL = require('../class/acl');

module.exports = {
    blameToLineArr(input) {
        const result = [];
        for(let diff of input) {
            for(let i = 0; i < diff.count; i++) {
                result.push(diff.uuid);
            }
        }

        return result;
    },
    lineArrToBlame(input) {
        const result = [];
        for(let uuid of input) {
            const lastResult = result[result.length - 1];

            if(lastResult?.uuid === uuid) lastResult.count++;
            else result.push({
                uuid: uuid,
                count: 1
            });
        }

        return result;
    },
    generateBlame(last, curr) {
        const lineDiff = Diff.diffLines(last?.content || '', curr.content || '');
        if(!lineDiff.length) lineDiff.push({
            count: 1,
            added: true,
            removed: false,
            value: ''
        });
        const newLineArr = [];
        const lineArr = this.blameToLineArr(last?.blame || []);
        console.log(lineDiff);

        let offset = 0;
        for(let i in lineDiff) {
            i = parseInt(i);
            const diff = lineDiff[i];
            const prevDiff = lineDiff[i - 1];

            if(diff.removed) {
                // offset -= diff.count;
                continue;
            }

            if(diff.added) {
                for(let i = 0; i < diff.count; i++) {
                    newLineArr.push(curr.uuid);
                }
                if(prevDiff?.removed && prevDiff.count <= diff.count) offset += diff.count - prevDiff.count;
            }
            else {
                for(let i = 0; i < diff.count; i++) {
                    newLineArr.push(lineArr[offset + i]);
                }
                offset += diff.count;
            }
        }

        return this.lineArrToBlame(newLineArr);
    },
    async generateBacklink(document, rev, parseResult) {
        if(!rev?.content) return { backlinks: [], categories: [] };

        if(!parseResult) {
            const parser = new global.NamumarkParser({
                document,
                aclData: {
                    alwaysAllow: true
                }
            });

            parseResult = await parser.parse(rev.content);
        }

        let backlinks = [];

        const addBacklinks = (flag, array) => {
            if(!array) return;
            if(!Array.isArray(array)) array = [array];

            for(let docName of array) {
                if(flag === BacklinkFlags.Redirect) {
                    const splittedName = docName.split('#');
                    if(splittedName.length > 1) splittedName.pop();
                    docName = splittedName.join('#');
                }
                const parsedName = utils.parseDocumentName(docName);
                if(!docName || !parsedName.title) continue;
                const existing = backlinks.find(a => a.docName === docName);
                if(existing) {
                    if(!existing.flags.includes(flag)) existing.flags.push(flag);
                }
                else backlinks.push({
                    docName,
                    flags: [flag]
                });
            }
        }

        addBacklinks(BacklinkFlags.Link, parseResult.links);
        addBacklinks(BacklinkFlags.File, parseResult.files);
        addBacklinks(BacklinkFlags.Include, parseResult.includes);
        addBacklinks(BacklinkFlags.Redirect, parseResult.redirect);

        // return backlinks.sort((a, b) => Intl.Collator('en').compare(a.docName, b.docName));
        return {
            backlinks,
            categories: parseResult.categories.map(a => ({
                document: a.document.slice('분류:'.length),
                text: a.text
            }))
        }
    },
    async postHistorySave(rev, backlink = true, search = true, dbDocument = null) {
        dbDocument ??= await mongoose.models.Document.findOne({
            uuid: rev.document
        });
        if(!dbDocument) return;

        await mongoose.models.History.updateMany({
            document: dbDocument.uuid,
            uuid: { $ne: rev.uuid }
        }, {
            latest: false
        });

        await mongoose.models.History.updateOne({
            uuid: rev.uuid
        }, {
            namespace: dbDocument.namespace
        });

        const document = utils.dbDocumentToDocument(dbDocument);

        const parser = new global.NamumarkParser({
            document: dbDocument,
            aclData: {
                alwaysAllow: true
            }
        });
        const parseResult = await parser.parse(rev.content);

        const contentExists = rev.content != null;
        if(backlink) {
            const { backlinks, categories } = await this.generateBacklink(dbDocument, rev, parseResult);

            let lastReadACL = dbDocument.lastReadACL;
            if(rev.type === HistoryTypes.ACL) {
                const acl = await mongoose.models.ACL.findOne({
                    document: dbDocument.uuid,
                    type: ACLTypes.Read
                }).sort({ expiresAt: -1 });

                lastReadACL = acl
                    ? (acl.expiresAt ? acl.expiresAt.getTime() : 0)
                    : -1;
            }

            await mongoose.models.Document.updateOne({
                uuid: rev.document
            }, {
                backlinks,
                categories,
                contentExists,
                lastReadACL
            });
        }

        if(search) {
            let anyoneReadable = contentExists;
            if(anyoneReadable && !['문서', '틀', '분류', '파일', '사용자', config.site_name].includes(dbDocument.namespace)) {
                const acl = await ACL.get({ document: dbDocument });
                const { result: readable } = await acl.check(ACLTypes.Read, {
                    permissions: ['any']
                });
                anyoneReadable = readable;
            }

            if(contentExists) await documentIndex.addDocuments({
                uuid: dbDocument.uuid,
                choseong: getChoseong(document.title),
                namespace: dbDocument.namespace,
                title: dbDocument.title,
                content: utils.removeHtmlTags(parseResult.html),
                raw: rev.content,
                anyoneReadable
            }, {
                primaryKey: 'uuid'
            });
            else await documentIndex.deleteDocument(dbDocument.uuid);
        }
    }
}