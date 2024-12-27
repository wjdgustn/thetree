const mongoose = require('mongoose');
const Diff = require('diff');
const { getChoseong } = require('es-hangul');

const utils = require('./');
const { BacklinkFlags, ACLTypes } = require('./types');

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
        const newLineArr = [];
        const lineArr = this.blameToLineArr(last?.blame || []);

        let offset = 0;
        for(let diff of lineDiff) {
            if(diff.removed) {
                // offset -= diff.count;
                continue;
            }

            if(diff.added) {
                for(let i = 0; i < diff.count; i++) {
                    newLineArr.push(curr.uuid);
                }
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
        if(!rev?.content) return [];

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

        addBacklinks(BacklinkFlags.Link, links);
        addBacklinks(BacklinkFlags.File, files);
        addBacklinks(BacklinkFlags.Include, includes);
        addBacklinks(BacklinkFlags.Redirect, redirect);

        // return backlinks.sort((a, b) => Intl.Collator('en').compare(a.docName, b.docName));
        return {
            backlinks,
            categories: categories.map(a => a.document.slice('분류:'.length))
        }
    },
    async postHistorySave(rev) {
        const dbDocument = await mongoose.models.Document.findOne({
            uuid: rev.document
        });
        if(!dbDocument) return;

        const document = utils.dbDocumentToDocument(dbDocument);

        const parser = new global.NamumarkParser({
            document: dbDocument,
            aclData: {
                alwaysAllow: true
            }
        });
        const parseResult = await parser.parse(rev.content);

        const { backlinks, categories } = await this.generateBacklink(dbDocument, this, parseResult);

        const contentExists = rev.content != null;
        await mongoose.models.Document.updateOne({
            uuid: rev.document
        }, {
            backlinks,
            categories,
            contentExists
        });

        let anyoneReadable = contentExists;
        if(anyoneReadable) {
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