const mongoose = require('mongoose');
const { getChoseong } = require('es-hangul');

const utils = require('./');
const globalUtils = require('./global');
const {
    BacklinkFlags,
    ACLTypes,
    HistoryTypes,
    UserTypes,
    ThreadCommentTypes,
    BlockHistoryTypes
} = require('./types');
const diffLib = require('./diff/lib');

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

            if(lastResult && lastResult.uuid === uuid) lastResult.count++;
            else result.push({
                uuid: uuid,
                count: 1
            });
        }

        return result;
    },
    async generateBlame(last, curr) {
        let { addedLines, deletedLines, changedLines, newLines } = await utils.generateDiff(last?.content || '', curr?.content || ' ', true);
        if(!last) {
            addedLines = diffLib.stringAsLines(curr.content).map((_, i) => i);
        }
        // console.log('addedLines', addedLines);
        // console.log('changedLines', changedLines);

        const lineArr = this.blameToLineArr(last?.blame || []).filter((_, i) => !deletedLines.includes(i));
        const newLineArr = newLines.map((_, i) => addedLines.includes(i) ? curr.uuid : lineArr.shift());
        for(let line of changedLines) newLineArr[line] = curr.uuid;

        // console.log('newLineArr', newLineArr, this.lineArrToBlame(newLineArr));
        return this.lineArrToBlame(newLineArr);
    },
    async generateBacklink(document, rev, parseResult, htmlResult) {
        if(!rev?.content) return { backlinks: [], categories: [] };

        if(!parseResult) {
            parseResult = global.NamumarkParser.parser(rev.content);
            htmlResult = await global.NamumarkParser.toHtml(parseResult, {
                document
            });
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

        addBacklinks(BacklinkFlags.Link, htmlResult.links);
        addBacklinks(BacklinkFlags.File, htmlResult.files);
        addBacklinks(BacklinkFlags.Include, parseResult.data.includes);
        if(rev.content.startsWith('#redirect ')) {
            let redirectName = rev.content.split('\n')[0].slice('#redirect '.length);
            const hashSplitted = redirectName.split('#');
            if(hashSplitted.length >= 2)
                redirectName = hashSplitted.join('#');
            addBacklinks(BacklinkFlags.Redirect, redirectName);
        }

        // return backlinks.sort((a, b) => Intl.Collator('en').compare(a.docName, b.docName));
        return {
            backlinks,
            categories: parseResult.data.categories.map(a => ({
                document: a.document,
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

        const parseResult = global.NamumarkParser.parser(rev.content);
        const htmlResult = await global.NamumarkParser.toHtml(parseResult, {
            document
        });

        const contentExists = rev.content != null;
        if(backlink) {
            const { backlinks, categories } = await this.generateBacklink(dbDocument, rev, parseResult, htmlResult);

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
            if(anyoneReadable && !['문서', '틀', '분류', '파일', '사용자'].includes(dbDocument.namespace)) {
                const acl = await ACL.get({ document: dbDocument });
                const { result: readable } = await acl.check(ACLTypes.Read, {
                    permissions: ['any']
                });
                anyoneReadable = readable;
            }

            if(global.documentIndex) {
                if(contentExists) await documentIndex.addDocuments({
                    uuid: dbDocument.uuid,
                    choseong: getChoseong(document.title),
                    namespace: dbDocument.namespace,
                    title: dbDocument.title,
                    content: globalUtils.removeHtmlTags(htmlResult.html),
                    raw: rev.content,
                    anyoneReadable
                }, {
                    primaryKey: 'uuid'
                });
                else await documentIndex.deleteDocument(dbDocument.uuid);
            }
        }
    },
    async checkMemberContribution(uuid) {
        const checkDays = parseInt(config.auto_verified_member?.check_days);
        if(!checkDays || isNaN(checkDays)) return;

        const delayHours = parseInt(config.auto_verified_member?.delay_hours);
        if(isNaN(delayHours)) return;

        const createdAt = {
            $gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * checkDays),
            ...(delayHours ? {
                $lte: new Date(Date.now() - 1000 * 60 * 60 * delayHours)
            } : {})
        }

        const user = await mongoose.models.User.findOne({ uuid });
        if(user?.type !== UserTypes.Account) return;

        if(user.permissions.includes('auto_verified_member')) return;

        if(config.auto_verified_member.no_block_days) {
            const blockGroups = await mongoose.models.ACLGroup.find({
                $or: [
                    {
                        forBlock: true
                    },
                    {
                        isWarn: true
                    }
                ]
            });
            const blocked = await mongoose.models.BlockHistory.exists({
                type: BlockHistoryTypes.ACLGroupAdd,
                targetUser: user.uuid,
                aclGroup: {
                    $in: blockGroups.map(group => group.uuid)
                },
                createdAt: {
                    $gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * config.auto_verified_member.no_block_days)
                }
            });
            if(blocked) return;
        }

        const verify = async () => await mongoose.models.User.updateOne({
            uuid: user.uuid
        }, {
            $addToSet: {
                permissions: 'auto_verified_member'
            }
        });

        if(config.auto_verified_member.edit_count) {
            const editCount = await mongoose.models.History.countDocuments({
                user: user.uuid,
                type: {
                    $in: [
                        HistoryTypes.Create,
                        HistoryTypes.Modify
                    ]
                },
                createdAt
            });
            if(editCount >= config.auto_verified_member.edit_count)
                return verify();
        }
        if(config.auto_verified_member.comment_count) {
            const commentCount = await mongoose.models.ThreadComment.countDocuments({
                user: user.uuid,
                type: ThreadCommentTypes.Default,
                createdAt
            });
            if(commentCount >= config.auto_verified_member.comment_count)
                return verify();
        }
    }
}
