const express = require('express');

const NamumarkParser = require('../utils/namumark');

const utils = require('../utils');
const globalUtils = require('../utils/global');
const middleware = require('../utils/middleware');
const {
    ThreadStatusTypes,
    ThreadCommentTypes, ACLTypes
} = require('../utils/types');

const Document = require('../schemas/document');
const Thread = require('../schemas/thread');
const ThreadComment = require('../schemas/threadComment');

const ACL = require('../class/acl');

const app = express.Router();

app.get('/discuss/?*', middleware.parseDocumentName, async (req, res) => {
    const document = req.document;
    const { namespace, title } = document;
    const dbDocument = await Document.findOne({
        namespace,
        title
    });

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: readable, aclMessage: readAclMessage } = await acl.check(ACLTypes.Read, req.aclData);
    if(!readable) return res.error(readAclMessage, 403);

    let openThreads = [];
    if(dbDocument) {
        openThreads = await Thread.find({
            status: ThreadStatusTypes.Normal
        })
            .sort({
                lastUpdatedAt: -1
            })
            .lean();
    }

    res.renderSkin(undefined, {
        viewName: 'thread_list',
        contentName: 'document/discuss',
        document,
        serverData: {
            openThreads
        }
    });
});

app.get('/thread/:url', async (req, res) => {
    const document = {
        namespace: '테스트위키',
        title: '테스트',
        forceShowNamespace: null
    }
    const parser = new NamumarkParser({
        document,
        thread: true
    });
    const namumarkSample = await parser.parse('~~테스트~~');
    res.renderSkin(undefined, {
        viewName: 'thread',
        contentName: 'thread',
        document,
        comments: [
            {
                id: 1,
                createdAt: new Date(),

                userHtml: utils.userHtml(req.user, {
                    isAdmin: req.permissions.includes('admin'),
                    note: `토론 asdf #1 긴급차단`,
                    thread: true,
                    threadAdmin: true
                }),
                starter: true,
                contentHtml: namumarkSample.html
            },
            {
                id: 2,
                hidden: true
            },
            {
                id: 3
            },
            {
                id: 4
            },
            {
                id: 5
            },
            {
                id: 6
            }
        ],
        hideHiddenComments: !req.permissions.includes('hide_thread_comment'),
        serverData: {
            namumarkSample
            // thread
        }
    });
});

module.exports = app;