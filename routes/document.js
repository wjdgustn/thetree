const express = require('express');

const globalUtils = require('../utils/global');

const app = express.Router();

app.get('/', (req, res) => {
    res.redirect(`/w/${config.front_page}`);
});

app.get('/w/*', (req, res) => {
    const originalName = req.params[0];
    const splitedName = originalName.split(':');
    const probablyNamespace = splitedName.length > 1 ? splitedName[0] : null;
    const title = probablyNamespace ? splitedName.slice(1).join(':') : originalName;

    const namespace = probablyNamespace ?? '문서';

    const document = {
        namespace: probablyNamespace,
        title,
        forceShowNamespace: namespace === '문서' ? false : null
    }

    res.renderSkin('docTitle', {
        viewName: 'wiki',
        contentHtml: '<strong>test</strong>',
        date: 1,
        discuss_progress: false,
        document,
        edit_acl_message: `편집 권한이 부족합니다. 특정 사용자(이)여야 합니다. 해당 문서의 <a href="${globalUtils.doc_action_link(document, 'acl')}">ACL 탭</a>을 확인하시기 바랍니다.`,
        editable: true,
        rev: null,
        star_count: 0,
        starred: false,
        user: null
        // user: {
        //     uuid: 'asdf'
        // }
    });
});

module.exports = app;