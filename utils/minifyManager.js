const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const UglifyJS = require('uglify-js');
const CleanCSS = require('clean-css');

const utils = require('./');

const getCache = () => {
    if(!fs.existsSync('./cache/minifyCache.json')) saveCache({});

    return JSON.parse(fs.readFileSync('./cache/minifyCache.json').toString());
}

const saveCache = obj => {
    fs.writeFileSync('./cache/minifyCache.json', JSON.stringify(obj, null, 2));
}

const JS_PATH = './public/js';
const CSS_PATH = './public/css';
const MIN_JS_PATH = './publicMin/js';
const MIN_CSS_PATH = './publicMin/css';

const uglifyOptions = {
    toplevel: true,
    mangle: {
        toplevel: true,
        eval: true
    }
}

module.exports = {
    check() {
        if(!fs.existsSync('./publicMin')) fs.mkdirSync('./publicMin');

        if(config.minify.js) this.minifyJS();
        if(config.minify.css) this.minifyCSS();
    },
    minifyJS(force = false) {
        const cache = getCache();

        if(!fs.existsSync(MIN_JS_PATH)) fs.mkdirSync(MIN_JS_PATH);

        const jsFiles = [...new Set([
            'common.js',
            'wiki.js',
            ...fs.readdirSync(JS_PATH).filter(a => a.endsWith('.js'))
        ])];
        const jsContents = jsFiles.map(a => fs.readFileSync(path.join(JS_PATH, a)).toString());
        const jsHashes = jsContents.map(a => crypto.createHash('sha256').update(a).digest('hex'));

        if(!force && utils.compareArray(jsHashes, cache.jsHashes)) return;

        const nameCache = {};
        for(let i = 0; i < jsFiles.length; i++) {
            const name = jsFiles[i];
            const code = jsContents[i];
            const result = UglifyJS.minify(code, {
                ...uglifyOptions,
                nameCache
            });

            fs.writeFileSync(path.join(MIN_JS_PATH, name), result.code);
        }

        cache.jsHashes = jsHashes;
        cache.nameCache = nameCache;
        saveCache(cache);

        if(fs.existsSync('./cache/skinjs')) fs.rmSync('./cache/skinjs', { recursive: true });
    },
    minifyCSS(force = false) {
        const cache = getCache();

        if(!fs.existsSync(MIN_CSS_PATH)) fs.mkdirSync(MIN_CSS_PATH);

        const cssFiles = fs.readdirSync(CSS_PATH).filter(a => a.endsWith('.css'));
        const cssContents = cssFiles.map(a => fs.readFileSync(path.join(CSS_PATH, a)).toString());
        const cssHashes = cssContents.map(a => crypto.createHash('sha256').update(a).digest('hex'));

        if(!force && utils.compareArray(cssHashes, cache.cssHashes)) return;

        for(let i = 0; i < cssFiles.length; i++) {
            const name = cssFiles[i];
            const code = cssContents[i];
            const result = new CleanCSS().minify(code);

            fs.writeFileSync(path.join(MIN_CSS_PATH, name), result.styles);
        }

        cache.cssHashes = cssHashes;
        saveCache(cache);
    },
    handleSkinJS(filename, req, res, next) {
        if(!fs.existsSync('./cache/skinjs')) fs.mkdirSync('./cache/skinjs');

        const codePath = path.join('./skins', decodeURIComponent(req.url));
        if(!codePath.startsWith('skins/') || !fs.existsSync(codePath)) return next();

        const code = fs.readFileSync(codePath).toString();
        const hash = crypto.createHash('sha256').update(code).digest('hex');
        const cachePath = path.join('./cache/skinjs', hash + '.js');

        let minCode;
        if(fs.existsSync(cachePath)) minCode = fs.readFileSync(cachePath).toString();
        else {
            const cache = getCache();
            const result = UglifyJS.minify(code, {
                ...uglifyOptions,
                nameCache: cache.nameCache
            });
            minCode = result.code;

            fs.writeFileSync(cachePath, minCode);
        }

        res.setHeader('Etag', hash);
        res.end(minCode);
    },
    handleSkinCSS(filename, req, res, next) {
        if(!fs.existsSync('./cache/skincss')) fs.mkdirSync('./cache/skincss');

        const codePath = path.join('./skins', decodeURIComponent(req.url));
        if(!codePath.startsWith('skins/') || !fs.existsSync(codePath)) return next();

        const code = fs.readFileSync(codePath).toString();
        const hash = crypto.createHash('sha256').update(code).digest('hex');
        const cachePath = path.join('./cache/skincss', hash + '.css');

        let minCode;
        if(fs.existsSync(cachePath)) minCode = fs.readFileSync(cachePath).toString();
        else {
            const result = new CleanCSS().minify(code);
            minCode = result.styles;

            fs.writeFileSync(cachePath, minCode);
        }

        res.setHeader('Etag', hash);
        res.end(minCode);
    }
}