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

window.addEventListener('popstate', async e => {
    console.log(e.state);
    await movePage(document.location.href, false);
});

const aClickHandler = async e => {
    const aElement = e.srcElement;

    let href = aElement.getAttribute('href');
    if(!href || href === '#') return;

    const fullUrl = new URL(aElement.href);
    if(fullUrl.origin !== window.location.origin) return;

    if(typeof aElement.dataset.addRedirect !== 'undefined')
        href += `?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;

    e.preventDefault();
    await movePage(href);
}

const formBackup = {};
const formHandler = async e => {
    const form = e.srcElement;

    e.preventDefault();

    const data = new FormData(form);
    const response = await fetch(form.action, {
        method: form.method,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(data).toString()
    });

    if(response.redirected) return await movePage(response.url);

    const forms = content.querySelectorAll('form');
    for(let form of forms) {
        if(!form.id) continue;

        formBackup[form.id] = new FormData(form);
    }

    const html = await response.text();
    if(replaceContent(html, response)) {
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
async function movePage(url, pushState = true) {
    const response = await fetch(url);
    const html = await response.text();

    if(replaceContent(html, response)) {
        if(pushState) history.pushState(null, null, response.url);

        setupPjax();
    }
    else location.href = response.url;
}

function replaceContent(html, response) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if(response.headers.get('TheSeed-Full-Reload') === 'true')
        return location.href = response.url;

    const newContent = doc.getElementById('content');

    if(!newContent) return false;

    content.innerHTML = newContent.innerHTML;
    return true;
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
        recent: [{"document":"냥냥냥","status":"normal","date":1730462638},{"document":"A","status":"normal","date":1730461011}],
        getDateStr(date) {
            date = date * 1000;
            const now = Date.now();
            const dateObj = new Date(date);
            const olderThanToday = (now - 1000 * 60 * 60 * 24) > date;
            return (olderThanToday
                ? [
                    dateObj.getFullYear(),
                    dateObj.getMonth() + 1,
                    dateObj.getDate()
                ]
                : [
                    dateObj.getHours(),
                    dateObj.getMinutes(),
                    dateObj.getSeconds()
                ]).map(a => a.toString().padStart(2, '0')).join(olderThanToday ? '/' : ':');
        }
    }));
});