module.exports = params => {
    params = params.split('-');
    if(params.length !== 3
        || params[0].length !== 4
        || params[1].length !== 2
        || params[2].length !== 2) return 'invalid date';

    params = params.map(param => parseInt(param));

    if(params[0] < 0
        || params[1] < 1 || params[1] > 12
        || params[2] < 1 || params[2] > 31) return 'invalid date';

    const today = new Date();
    const targetDate = new Date(params[0], params[1] - 1, params[2]);
    const diff = today - targetDate;
    const dday = diff / (1000 * 60 * 60 * 24);
    const intDday = Math.floor(dday);

    return (intDday > 0 ? '+' : '-') + Math.abs(intDday);
}