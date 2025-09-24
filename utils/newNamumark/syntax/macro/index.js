const { workerData } = require('piscina');

const utils = require('../../utils');

let { macros, threadMacros } = utils.loadMacros(workerData.macroPluginPaths);

module.exports = async (obj, options) => {
    // if(debug) loadMacros();

    // content = utils.parseIncludeParams(content, namumark.includeData);

    const name = obj.name;
    const params = obj.params;

    if(!macros[name]) return obj.image;

    if(options.thread && !threadMacros.includes(name)) return '';

    const counts = options.Store.macro.counts;
    counts[name] ??= 0;
    counts[name]++;

    return await macros[name](params, options, obj);
}