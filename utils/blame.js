const Diff = require("diff");
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
    }
}