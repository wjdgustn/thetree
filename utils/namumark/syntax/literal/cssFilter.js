const CSSFilter = require('cssfilter');

const allowedNames = require('./allowedNames.json');
console.log(allowedNames);

const filter = new CSSFilter.FilterCSS({
    whiteList: {
        ...Object.assign({}, ...allowedNames.map(a => ({[a]: true}))),
        display: v => [
            'block',
            'flex',
            'inline',
            'inline-block',
            'inline-flex',
            'inline-table',
            'list-item',
            'none',
            'table',
            'table-caption',
            'table-cell',
            'table-column',
            'table-column-group',
            'table-footer-group',
            'table-header-group',
            'table-row-group'
        ].includes(v),
        'text-align': v => [
            'left',
            'right',
            'center'
        ].includes(v)
    },
    onAttr: (name, value, options) => {
        if(value.startsWith('url(')) return '';
    }
});

module.exports = css => filter.process(css);