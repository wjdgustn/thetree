const utils = require('../../utils');

const Vote = require('../../../../schemas/vote');

module.exports = {
    allowThread: true,
    async format(params, namumark) {
        if(!namumark.thread || !namumark.dbComment) return;

        params = utils.escapedSplit(params);
        if(params.length < 2) return;

        const title = params.shift();

        namumark.voteIndex ??= -1;
        namumark.voteIndex++;

        const baseData = {
            comment: namumark.dbComment.uuid,
            voteIndex: namumark.voteIndex
        }

        let prevVote;
        if(namumark.aclData?.user) {
            prevVote = await Vote.findOne({
                ...baseData,
                user: namumark.aclData.user.uuid
            });
        }

        let result = `
<fieldset class="wiki-macro-vote">
<legend>${title}</legend>
<form id="vote-${namumark.commentId}-${namumark.voteIndex}" action="/vote/${namumark.dbComment.uuid}/${namumark.voteIndex}" method="post">
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
<input type="radio" name="vote-${namumark.voteIndex}" value="${i}"${prevVote?.value === parseInt(i) ? ' checked' : ''}>
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