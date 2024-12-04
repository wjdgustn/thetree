const fs = require('fs');

const macros = {};
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
    }
}

loadMacros();

module.exports = {
    openStr: `[`,
    closeStr: `]`,
    format: async (content, namumark) => {
        // if(debug) loadMacros();

        const openParamIndex = content.indexOf('(');

        let name;
        let params;
        if(openParamIndex === -1) name = content;
        else {
            if(!content.endsWith(')')) return;

            name = content.substring(0, openParamIndex);
            params = content.substring(openParamIndex + 1, content.length - 1);
        }
        name = name.toLowerCase();

        if(!macros[name]) return;

        return await macros[name](params, namumark);
    }
}