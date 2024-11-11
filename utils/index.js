module.exports = {
    getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max + 1);
        return Math.floor(Math.random() * (max - min)) + min;
    },
    withoutKeys(obj, keys = []) {
        return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
    }
}