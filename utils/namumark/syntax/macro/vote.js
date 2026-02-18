module.exports = {
    allowThread: true,
    async format(params, options, obj) {
        if(!options.thread) return '';

        params = await Promise.all(obj.parsedSplittedParams.map(a => options.toHtml(a)));
        if(params.length < 2) return '';

        const title = params.shift();

        options.Store.voteIndex++;

        const baseData = options.dbComment ? {
            comment: options.dbComment.uuid,
            voteIndex: options.Store.voteIndex
        } : null;

        let prevVote;
        if(options.aclData?.user && baseData) {
            prevVote = await options.parentAction('db', {
                model: 'Vote',
                action: 'findOne',
                data: {
                    ...baseData,
                    user: options.aclData.user.uuid
                }
            });
        }

        let result = `
<fieldset class="wiki-macro-vote">
<legend>${title}</legend>
<form id="vote-${options.commentId}-${options.Store.voteIndex}" action="/vote/${options.dbComment?.uuid ?? 'null'}/${options.Store.voteIndex}" method="post">
        `;

        for(let i in params) {
            const voteCount = baseData ? await options.parentAction('db', {
                model: 'Vote',
                action: 'countDocuments',
                data: {
                    ...baseData,
                    value: parseInt(i)
                }
            }) : 0;

            const option = params[i];
            result += `
<div>
<label>
<input type="radio" name="vote-${options.Store.voteIndex}" value="${i}"${prevVote?.value === parseInt(i) ? ' checked' : ''}>
${option} (${voteCount}${await options.parentAction('t', { key: 'namumark.vote.votes' })})
</label>
</div>
            `;
        }

        result += `
<button class="thetree-square-button thetree-blue-button">${await options.parentAction('t', { key: 'namumark.vote.vote' })}</button>
</form>
</fieldset>
        `;

        return result.replaceAll('\n', '').trim();
    }
}
