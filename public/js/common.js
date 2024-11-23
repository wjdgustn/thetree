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

function plainAlert(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const message = doc.body.textContent;

    const treeAlert = document.getElementById('thetree-alert');
    const treeAlertContent = document.getElementById('thetree-alert-content');
    if(treeAlert && treeAlertContent) {
        treeAlert.hidden = false;
        treeAlertContent.textContent = message;
    }
    else alert(message);
}

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

function backupForm() {
    const forms = content.querySelectorAll('form');
    for(let form of forms) {
        if(!form.id) continue;

        formBackup[form.id] = new FormData(form);
    }
}

function restoreForm() {
    const forms = content.querySelectorAll('form');
    const usedFormIds = [];
    for(let form of forms) {
        const backup = formBackup[form.id];
        if(!backup) continue;

        usedFormIds.push(form.id);

        for(let [key, value] of backup) {
            const input = form.querySelector(`input[name="${key}"], select[name="${key}"]`);
            if(!input) continue;

            if(input.type === 'checkbox' || input.type === 'radio')
                input.checked = !!value;
            else {
                if(input._x_model)
                    input._x_model.set(value);
                else
                    input.value = value;
            }
        }
    }

    for(let key of Object.keys(formBackup)) {
        if(!usedFormIds.includes(key)) delete formBackup[key];
    }
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

    backupForm();

    if(response.redirected) {
        window.beforePageLoad = null;
        return await movePage(response);
    }

    const html = await response.text();
    if(response.status.toString().startsWith('4')) return plainAlert(html);

    if(await replaceContent(html)) {
        setupPjax();
        restoreForm();
    }
    else plainAlert(html);
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

    window.beforePageLoad = null;
    emit('thetree:pageLoad');
}

let content;
async function movePage(response, pushState = true) {
    if(typeof window.beforePageLoad === 'function') {
        const canMove = await window.beforePageLoad();
        if(!canMove) return;
    }

    if(typeof response === 'string') response = await fetch(response);

    const html = await response.text();

    if(response.status.toString().startsWith('4')) return plainAlert(html);

    if(await replaceContent(html)) {
        if(pushState) {
            const newUrl = new URL(response.url);
            if(newUrl.pathname !== location.pathname
                || newUrl.search !== location.search) history.pushState(null, null, response.url);
        }

        setupPjax();
        restoreForm();
    }
    else location.href = response.url;
}

async function replaceContent(html) {
    let result = false;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let newContent;

    const fullReload = html.includes('<!DOCTYPE html>');
    if(fullReload) {
        newContent = doc.getElementById('content');
        document.body.innerHTML = doc.body.innerHTML;
        content = document.getElementById('content');
        result = true;
    }
    else {
        if(html.includes('<')) {
            newContent = doc;
            content.innerHTML = html;
            result = true;
        }
    }

    if(result) {
        const allScripts = newContent.querySelectorAll('script');
        for(let script of allScripts) {
            if(script.src) {
                const response = await fetch(script.src);
                if(!response.ok) continue;
                const scriptText = await response.text();
                eval(scriptText);
            }
            else eval(script.textContent);
            if(script.id === 'initScript') {
                State.page = page;
                State.session = session;
            }
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

window.addEventListener('beforeunload', e => {
    if(typeof window.beforePageLoad !== 'function') return;

    const canMove = window.beforePageLoad();
    if(!canMove) e.preventDefault();
});

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