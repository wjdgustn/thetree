const fs = require('fs');

const utils = require('../../utils');

const macros = {};
const threadMacros = [];
const loadMacros = () => {
    const files = fs.readdirSync(__dirname);
    for(let file of files) {
        if(file === 'index.js') continue;

        const macroName = file.replace('.js', '').toLowerCase();

        const macroPath = require.resolve(`./${file}`);
        if(debug) delete require.cache[macroPath];
        const macro = require(macroPath);
        macros[macroName] = macro.format ?? macro;

        if(macro.aliases)
            for(let alias of macro.aliases)
                macros[alias] = macro.format;

        if(macro.allowThread)
            threadMacros.push(macroName, ...(macro.aliases ?? []));
    }

    for(let macro of plugins.macro) {
        macros[macro.name] = macro.format;
        if(macro.aliases)
            for(let alias of macro.aliases)
                macros[alias] = macro.format;

        if(macro.allowThread)
            threadMacros.push(plugin.name, ...(macro.aliases ?? []));
    }
}

loadMacros();

module.exports = async (obj, options) => {
    // if(debug) loadMacros();

    // content = utils.parseIncludeParams(content, namumark.includeData);

    const name = obj.name;
    const params = obj.params;

    if(!macros[name]) return obj.image;

    if(options.thread && !threadMacros.includes(name)) return '';

    return await macros[name](params, options, obj);
}