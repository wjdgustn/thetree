for(let key of Object.keys(globalUtils)) window[key] = globalUtils[key];

Object.defineProperty(window, 'query', {
    get() {
        return new URLSearchParams(window.location.search);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    content = document.getElementById('content');
});

document.addEventListener('alpine:initialized', () => {
    setupPjax();
});

window.addEventListener('popstate', async _ => {
    await movePage(document.location.href, false);
});

const aClickHandler = async e => {
    if(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    const aElement = e.currentTarget;

    let href = aElement.getAttribute('href');
    if(!href || href.startsWith('#')) return;

    const fullUrl = new URL(aElement.href);
    if(fullUrl.origin !== window.location.origin) return;

    if(typeof aElement.dataset.addRedirect !== 'undefined')
        href += `?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;

    e.preventDefault();
    await movePage(href);
}

const formBackup = {};
const formHandler = async e => {
    const form = e.currentTarget;

    e.preventDefault();

    const data = new FormData(form);
    const response = await fetch(form.action, {
        method: form.method,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(data).toString()
    });

    if(response.redirected) return await movePage(response);

    const forms = content.querySelectorAll('form');
    for(let form of forms) {
        if(!form.id) continue;

        formBackup[form.id] = new FormData(form);
    }

    const html = await response.text();
    if(replaceContent(html)) {
        setupPjax();

        const forms = content.querySelectorAll('form');
        for(let form of forms) {
            const backup = formBackup[form.id];
            if(!backup) continue;

            for(let [key, value] of backup) {
                const input = form.querySelector(`input[name="${key}"]`);
                if(!input) continue;

                if(input.type === 'checkbox' || input.type === 'radio')
                    input.checked = !!value;
                else
                    input.value = value;
            }
        }
    }
    else alert(html);
}

function setupPjax() {
    const aElements = document.querySelectorAll('a');
    for(let a of aElements) {
        a.removeEventListener('click', aClickHandler);
        a.addEventListener('click', aClickHandler);
    }

    const forms = document.querySelectorAll('form');
    for(let form of forms) {
        form.removeEventListener('submit', formHandler);
        form.addEventListener('submit', formHandler);
    }

    emit('thetree:pageLoad');
}

let content;
async function movePage(response, pushState = true) {
    if(typeof response === 'string') response = await fetch(response);

    const html = await response.text();

    if(replaceContent(html)) {
        if(pushState) history.pushState(null, null, response.url);

        setupPjax();
    }
    else location.href = response.url;
}

function replaceContent(html) {
    let result = false;

    if(html.includes('<!DOCTYPE html>')) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        document.body.innerHTML = doc.body.innerHTML;
        result = true;
    }
    else {
        if(html.includes('<')) {
            content.innerHTML = html;
            result = true;
        }
    }

    if(result) {
        const initScript = document.getElementById('initScript');
        if(initScript) {
            eval(initScript.textContent);
            State.page = page;
            State.session = session;
        }
    }

    return result;

    // const parser = new DOMParser();
    // const doc = parser.parseFromString(html, 'text/html');
    //
    // const newContent = doc.getElementById('content');
    // if(!newContent) return false;
    //
    // content.innerHTML = newContent.innerHTML;
    // return true;
}

function emit(name) {
    const event = new CustomEvent(name);
    document.dispatchEvent(event);
}

const localConfig = JSON.parse(localStorage.getItem('thetree_settings') ?? '{}');
document.addEventListener('alpine:init', () => {
    Alpine.store('state', {
        page,
        session,
        localConfig,
        getLocalConfig(key) {
            return this.localConfig[key] ?? defaultConfig[key];
        },
        setLocalConfig(key, value) {
            this.localConfig[key] = value;
            localStorage.setItem('thetree_settings', JSON.stringify(this.localConfig));

            setStyles();
        },
        get currentTheme() {
            let theme = this.getLocalConfig('wiki.theme');
            if(theme === 'auto') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            return theme;
        }
    });
    window.State = Alpine.store('state');

    const sample = [
        '얼불춤',
        '불과 얼음의 춤',
        '정현수',
        '샌즈',
        'A Dance of Fire and Ice',
        'ADOFAI'
    ];
    Alpine.data('search', () => ({
        searchFocused: false,
        searchText: '',
        cursor: -1,
        internalItems: [],
        get show() {
            return this.searchFocused && this.searchText.length > 0
        },
        blur() {
            this.searchFocused = false;
        },
        focus() {
            this.searchFocused = true;
        },
        inputChange() {
            if(!this.searchText.length) {
                this.internalItems = [];
                return;
            }

            this.internalItems = sample.filter(item => item.toLowerCase().includes(this.searchText.toLowerCase()));
            this.cursor = -1;
        },
        onClickItem(item) {
            console.log(item);
        },
        keyEnter() {
            this.onClickItem(this.internalItems[this.cursor]);
        },
        keyUp() {
            if(this.cursor >= 0) this.cursor--;
        },
        keyDown() {
            if(this.cursor < this.internalItems.length) this.cursor++;
        },
        onClickSearch() {
            console.log(this.searchText);
        },
        onClickMove() {
            console.log(this.searchText);
        }
    }));

    Alpine.data('recent', () => ({
        recent: [{"document":"냥냥냥","status":"normal","date":1730462638},{"document":"A","status":"normal","date":1730461011}]
    }));
});