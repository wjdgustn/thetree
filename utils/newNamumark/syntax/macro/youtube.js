const utils = require('../../utils');

module.exports = (params, { Store }) => {
    params = params.split(',').map(param => param.trim());

    let videoId = params.shift();

    let width = '640';
    let height = '360';
    let start;
    let end;
    for(let param of params) {
        if(param.startsWith('width=')) {
            const value = param.substring('width='.length);
            let checkStr = value;
            if(checkStr.endsWith('%')) checkStr = value.slice(0, -1);
            if(!isNaN(checkStr)) width = value;
        }
        else if(param.startsWith('height=')) {
            const value = param.substring('height='.length);
            if(!isNaN(value)) height = value;
        }
        else if(param.startsWith('start=')) {
            const value = param.substring('start='.length);
            if(!isNaN(value)) start = value;
        }
        else if(param.startsWith('end=')) {
            const value = param.substring('end='.length);
            if(!isNaN(value)) end = value;
        }
    }

    if(!videoId) return;

    videoId = utils.escapeHtml(videoId);
    width = utils.escapeHtml(width);
    height = utils.escapeHtml(height);
    start = utils.escapeHtml(start);
    end = utils.escapeHtml(end);

    let queryStr;
    if(start || end) {
        queryStr = '?';
        if(start) queryStr += `start=${start}`;
        if(end) queryStr += `${start ? '&' : ''}end=${end}`;
    }

    return Store.macro.counts.youtube >= 3
        ? `<div class="wiki-media-wrapper"><lite-youtube class="wiki-media" videoid="${videoId}"${start ? ` videostartat=${start}` : ''}${end ? ` params="end=${end}"` : ''} style="width:${width}px;height:${height}px"></lite-youtube></div>`
        : `<iframe class="wiki-media" allowfullscreen${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''} frameborder="0" src="//www.youtube.com/embed/${videoId}${queryStr ?? ''}" loading="lazy"></iframe>`;
}