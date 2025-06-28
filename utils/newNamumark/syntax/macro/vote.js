const utils = require('../../utils');

const Vote = require('../../../../schemas/vote');

module.exports = {
    allowThread: true,
    async format(params, options, obj) {
        if(!options.thread || !options.dbComment) return;

        params = obj.splittedParams;
        if(params.length < 2) return '';

        const title = params.shift();

        options.Store.voteIndex++;

        const baseData = {
            comment: options.dbComment.uuid,
            voteIndex: options.Store.voteIndex
        }

        let prevVote;
        if(options.aclData?.user) {
            prevVote = await Vote.findOne({
                ...baseData,
                user: options.aclData.user.uuid
            });
        }

        let result = `
<fieldset class="wiki-macro-vote">
<legend>${title}</legend>
<form id="vote-${options.commentId}-${options.Store.voteIndex}" action="/vote/${options.dbComment.uuid}/${options.Store.voteIndex}" method="post">
        `;

        for(let i in params) {
            const voteCount = await Vote.countDocuments({
                ...baseData,
                value: parseInt(i)
            });

            const option = params[i];
            result += `
<div>
<label>
<input type="radio" name="vote-${options.Store.voteIndex}" value="${i}"${prevVote?.value === parseInt(i) ? ' checked' : ''}>
${option} (${voteCount}표)
</label>
</div>
            `;
        }

        result += `
<button class="thetree-square-button thetree-blue-button">투표</button>
</form>
</fieldset>
        `;

        return result.replaceAll('\n', '').trim();
    }
}
