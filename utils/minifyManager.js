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

// @scope 미지원 브라우저용 임시방편
const scopedCSSPolyfill = css => {
    const lines = css.replaceAll('\r', '').split('\n');
    const newLines = [];

    let scopedOpen = false;
    let scopedContent = '';
    let bracketOpen = 0;
    let lineNum = 0;
    for(let line of lines) {
        lineNum++;
        // console.log(`[${lineNum}] scopedOpen: ${scopedOpen} bracketOpen: ${bracketOpen} ${line}`);
        const trimed = line.trimStart();
        let newLine = trimed;
        let spaceCount = line.length - trimed.length;
        if(trimed.startsWith('@scope')) {
            const openPos = line.indexOf('(');
            const closePos = line.lastIndexOf(')');
            scopedOpen = true;
            scopedContent = line.substring(openPos + 1, closePos);
            continue;
        }

        if(trimed.endsWith('{')) {
            bracketOpen++;

            if(scopedOpen && !trimed.startsWith('@')) {
                const selectors = trimed.split(',').map(a => a.trim());
                newLine = selectors.map(a => scopedContent + ' ' + a).join(', ');
            }
        }
        if(trimed.startsWith('}')) {
            if(bracketOpen) {
                bracketOpen--;
            }
            else {
                scopedOpen = false;
                continue;
            }
        }

        newLines.push(' '.repeat(spaceCount) + newLine);
    }

    return newLines.join('\n');
}

const JS_PATH = './public/js';
const CSS_PATH = './public/css';
const MIN_JS_PATH = './publicMin/js';
const MIN_CSS_PATH = './publicMin/css';

const uglifyJSOptions = {
    toplevel: true,
    mangle: {
        toplevel: true,
        eval: true
    }
}

const cleanCSSOptions = {
    level: 0
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
                ...uglifyJSOptions,
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

        const viewsCSSPath = path.join(MIN_CSS_PATH, 'views');
        if(!fs.existsSync(MIN_CSS_PATH)) fs.mkdirSync(MIN_CSS_PATH);
        if(!fs.existsSync(viewsCSSPath)) fs.mkdirSync(viewsCSSPath);

        const cssFiles = [
            ...fs.readdirSync(CSS_PATH).filter(a => a.endsWith('.css')),
            ...fs.readdirSync(path.join(CSS_PATH, 'views'))
                .filter(a => a.endsWith('.css'))
                .map(a => path.join('views', a))
        ];
        const cssContents = cssFiles.map(a => fs.readFileSync(path.join(CSS_PATH, a)).toString());
        const cssHashes = cssContents.map(a => crypto.createHash('sha256').update(a).digest('hex'));

        if(!force && utils.compareArray(cssHashes, cache.cssHashes)) return;

        for(let i = 0; i < cssFiles.length; i++) {
            const name = cssFiles[i];
            let code = cssContents[i];
            if(!name.endsWith('.min.css')) code = scopedCSSPolyfill(code);
            const result = new CleanCSS(cleanCSSOptions).minify(code);

            fs.writeFileSync(path.join(MIN_CSS_PATH, name), result.styles);
        }

        cache.cssHashes = cssHashes;
        saveCache(cache);
    },
    handleSkinJS(filename, req, res, next) {
        if(!fs.existsSync('./cache/skinjs')) fs.mkdirSync('./cache/skinjs');

        const codePath = path.join('./skins', decodeURIComponent(req.url));
        if(!codePath.startsWith(`skins${path.sep}`) || !fs.existsSync(codePath)) return next();

        const code = fs.readFileSync(codePath).toString();
        const hash = crypto.createHash('sha256').update(code).digest('hex');
        const cachePath = path.join('./cache/skinjs', hash + '.js');

        let minCode;
        if(fs.existsSync(cachePath)) minCode = fs.readFileSync(cachePath).toString();
        else {
            const cache = getCache();
            const result = UglifyJS.minify(code, {
                ...uglifyJSOptions,
                nameCache: cache.nameCache
            });
            minCode = result.code;

            fs.writeFileSync(cachePath, minCode);
            saveCache(cache);
        }

        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Etag', hash);
        res.end(minCode);
    },
    handleSkinCSS(filename, req, res, next) {
        if(!fs.existsSync('./cache/skincss')) fs.mkdirSync('./cache/skincss');

        const codePath = path.join('./skins', decodeURIComponent(req.url));
        if(!codePath.startsWith(`skins${path.sep}`) || !fs.existsSync(codePath)) return next();

        let code = fs.readFileSync(codePath).toString();
        const hash = crypto.createHash('sha256').update(code).digest('hex');
        const cachePath = path.join('./cache/skincss', hash + '.css');

        let minCode;
        if(fs.existsSync(cachePath)) minCode = fs.readFileSync(cachePath).toString();
        else {
            code = scopedCSSPolyfill(code);
            const result = new CleanCSS(cleanCSSOptions).minify(code);
            minCode = result.styles;

            fs.writeFileSync(cachePath, minCode);
        }

        res.setHeader('Content-Type', 'text/css');
        res.setHeader('Etag', hash);
        res.end(minCode);
    }
}