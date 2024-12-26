for(let key of Object.keys(globalUtils)) window[key] = globalUtils[key];

Object.defineProperty(window, 'query', {
    get() {
        return new URLSearchParams(window.location.search);
    }
});

function contentLoadedHandler() {
    content = document.getElementById('content');
    progressBar = document.getElementById('progress-bar');
}

document.addEventListener('DOMContentLoaded', contentLoadedHandler);

document.addEventListener('alpine:initialized', () => {
    setupDocument();
});

let currentUrl = location.href;
window.addEventListener('popstate', async e => {
    const prevUrl = currentUrl;
    currentUrl = location.href;

    const isHashChange = prevUrl.split('#')[0] === currentUrl.split('#')[0];

    if(typeof window.beforePopstate === 'function') {
        const canMove = await window.beforePopstate(isHashChange);
        if(!canMove) return history.pushState({}, null, prevUrl);
    }

    if(isHashChange) focusAnchor();
    else await movePage(location.href, false, prevUrl);
});

function plainAlert(text) {
    if(!text) return;

    const doc = new DOMParser().parseFromString(text, 'text/html');
    const message = doc.body.textContent;

    const errorAlerts = document.getElementsByClassName('thetree-error-alert');
    if(errorAlerts.length) for(let alert of errorAlerts) {
        const content = alert.getElementsByClassName('thetree-alert-content-text')[0];
        if(!content) continue;

        alert.hidden = false;
        content.innerHTML = doc.body.innerHTML;
    }
    else alert(message);
}

const aClickHandler = async e => {
    if(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    const aElement = e.currentTarget;

    if(aElement._thetree?.preHandler?.(e) === false) return;

    if(aElement.target === '_blank') return;

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

            if(input.type === 'hidden') continue;

            if(input.type === 'checkbox' || input.type === 'radio')
                input.checked = !!value;
            else {
                if(input._x_model)
                    input._x_model.set(value);
                else
                    input.value = value;
            }

            if(input.autofocus) input.focus();
        }
    }

    for(let key of Object.keys(formBackup)) {
        if(!usedFormIds.includes(key)) delete formBackup[key];
    }
}

const formBackup = {};
const formHandler = async e => {
    const form = e.currentTarget;

    if(form.dataset.noFormHandler) return;

    e.preventDefault();

    increaseProgress(100);

    const data = new FormData(form);

    const url = new URL(form.action);
    if(form.method === 'get')
        url.search = new URLSearchParams(data).toString();

    const isMultipartForm = form.enctype === 'multipart/form-data';

    const response = await fetch(url, {
        method: form.method,
        ...(form.method === 'get' ? {} : {
            ...(isMultipartForm ? {} : {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }),
            body: isMultipartForm
                ? data
                : new URLSearchParams(data).toString()
        })
    });

    backupForm();

    if(response.redirected) {
        window.beforePageLoad = null;
        window.beforePopstate = null;
        return await movePage(response);
    }

    const html = await response.text();
    if(response.status.toString().startsWith('4')) {
        let json;
        try {
            json = JSON.parse(html);
            if(json.fieldErrors) {
                const inputs = form.querySelectorAll('input, select');
                for(let input of inputs) {
                    if(!input.name) continue;

                    const error = json.fieldErrors[input.name];

                    let fieldError;
                    if(['DIV', 'SPAN'].includes(input.parentElement?.tagName)) {
                        fieldError = input.parentElement.querySelector(`.input-error[data-for="${input.name}"]`);
                        if(!fieldError && error) {
                            fieldError = document.createElement('p');
                            fieldError.classList.add('input-error');
                            fieldError.dataset.for = input.name;
                            input.parentElement.appendChild(fieldError);
                        }
                    }
                    else {
                        if(input.nextElementSibling?.classList?.contains('input-error')) {
                            fieldError = input.nextSibling;
                        }
                        else if(error) {
                            fieldError = document.createElement('p');
                            fieldError.classList.add('input-error');
                            input.after(fieldError);
                        }
                    }

                    if(fieldError) {
                        if(error) fieldError.textContent = error.msg;
                        else fieldError.remove();
                    }
                }
            }
        } catch(e) {}

        setProgress(100);

        if(!json?.fieldErrors) return plainAlert(html);

        return;
    }

    if(await replaceContent(html, response.headers)) {
        setupDocument();
        restoreForm();
        changeUrl(response.url);
    }
    else plainAlert(html);

    setProgress(100);
}

function updateTimeTag() {
    const times = document.getElementsByTagName('time');
    for(let time of times) {
        const type = time.dataset.type;
        const date = new Date(time.dateTime);

        if(type === 'keep') continue;

        let isRelative = false;
        if(type === 'relative' && !State.getLocalConfig('wiki.no_relative_date')) {
            const diff = Date.now() - date.getTime();
            const relative = new Intl.RelativeTimeFormat();

            isRelative = true;

            if(diff < 1000 * 10) time.textContent = '방금 전';
            else if(diff < 1000 * 60) time.textContent = relative.format(-Math.floor(diff / 1000), 'second');
            else if(diff < 1000 * 60 * 60) time.textContent = relative.format(-Math.floor(diff / 1000 / 60), 'minute');
            else if(diff < 1000 * 60 * 60 * 24) time.textContent = relative.format(-Math.floor(diff / 1000 / 60 / 60), 'hour');
            else if(diff < 1000 * 60 * 60 * 24 * 30) time.textContent = relative.format(-Math.floor(diff / 1000 / 60 / 60 / 24), 'day');
            else isRelative = false;

            if(isRelative) continue;
        }

        const dateStr = [
            date.getFullYear(),
            date.getMonth() + 1,
            date.getDate()
        ].map(num => num.toString().padStart(2, '0')).join('-');

        const timeStr = [
            date.getHours(),
            date.getMinutes(),
            date.getSeconds()
        ].map(num => num.toString().padStart(2, '0')).join(':');

        let result = dateStr + ' ' + timeStr;

        if(type === 'timezone') {
            const offset = -(date.getTimezoneOffset() / 60);
            result += (offset > 0 ? '+' : '-') + (offset * 100).toString().padStart(4, '0');
        }

        time.textContent = result;
    }
}

function focusAnchor() {
    const hash = location.hash.slice(1);
    if(hash) {
        let element;
        if(hash === 'toc')
            element = document.getElementsByClassName('wiki-macro-toc')[0];
        else
            element = document.getElementById(hash);

        if(element) element.scrollIntoView();
    }
    else window.scrollTo(0, 0);
}

function setupDocument() {
    const aElements = document.getElementsByTagName('a');
    for(let a of aElements) {
        a.removeEventListener('click', aClickHandler);
        a.addEventListener('click', aClickHandler);
    }

    const forms = document.getElementsByTagName('form');
    for(let form of forms) {
        form.removeEventListener('submit', formHandler);
        form.addEventListener('submit', formHandler);
    }

    updateTimeTag();
    focusAnchor();

    window.beforePageLoad = null;
    window.beforePopstate = null;

    const allElements = document.getElementsByTagName('*');
    for(let element of allElements) {
        if(typeof element.className !== 'string'
            || !element.className.includes('thetree')) continue;
        if(element.thetree) continue;

        element._thetree = {
            modal: {},
            dropdown: {},
            preHandler: null
        };
    }

    emit('thetree:pageLoad');
}

function changeUrl(url) {
    const newUrl = new URL(url);
    if(newUrl.pathname !== location.pathname
        || newUrl.search !== location.search) {
        const anchor = newUrl.searchParams.get('anchor');
        if(anchor) {
            const element = document.getElementById(anchor);
            if(element) element.scrollIntoView();
            newUrl.searchParams.delete('anchor');
        }
        history.pushState({}, null, newUrl.toString());
        currentUrl = newUrl.toString();
    }
}

let content;
async function movePage(response, pushState = true, prevUrl = null) {
    if(typeof window.beforePageLoad === 'function') {
        const canMove = await window.beforePageLoad();
        if(!canMove) {
            if(prevUrl) history.pushState({}, null, prevUrl);
            return;
        }
    }

    increaseProgress(100);

    if(typeof response === 'string') response = await fetch(response);

    const html = await response.text();

    if(response.status.toString().startsWith('4')) {
        setProgress(100);
        return plainAlert(html);
    }

    if(response.status === 204) return setProgress(100);

    if(await replaceContent(html, response.headers)) {
        if(pushState) changeUrl(response.url);

        setupDocument();
        restoreForm();
    }
    else location.href = response.url;

    setProgress(100);
}

const scriptCache = {};
async function replaceContent(html, headers) {
    let result = false;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let newContent;

    const injectedStyles = [...document.querySelectorAll('link[data-injected]')];
    const styles = doc.body.querySelectorAll('link[rel="stylesheet"]');

    let loadingStyles = styles.length;
    let waitResolve;
    const loadedStyles = [];
    for(let style of styles) {
        style.remove();
        loadedStyles.push(style.href);

        const dupStyle = injectedStyles.find(a => a.href === style.href);
        if(dupStyle) {
            loadingStyles--;
            continue;
        }

        style.onload = () => {
            loadingStyles--;
            if(loadingStyles === 0) waitResolve?.();
        }
        style.dataset.injected = 'true';
        document.head.appendChild(style);
    }

    if(loadingStyles > 0) {
        await waitUntil(new Promise(resolve => {
            waitResolve = resolve;
        }), 5000);
    }

    for(let style of injectedStyles) {
        if(loadedStyles.includes(style.href)) continue;
        style.remove();
    }

    const fullReload = html.includes('<!DOCTYPE html>');
    if(fullReload) {
        newContent = doc.getElementById('content');
        document.body.innerHTML = doc.body.innerHTML;
        contentLoadedHandler();
        result = true;
    }
    else {
        if(html.includes('<')) {
            newContent = doc;
            content.innerHTML = doc.body.innerHTML;
            result = true;
        }
    }

    if(result) {
        const csp = headers.get('Content-Security-Policy');
        const nonce = csp.split(' ').find(a => a.startsWith("'nonce-")).slice("'nonce-".length, -1);

        const allScripts = [...newContent.querySelectorAll('script')];
        if(fullReload) allScripts.push(doc.getElementById('initScript'));

        for(let script of allScripts) {
            if(script.src) {
                let scriptText = scriptCache[script.src];
                if(!scriptText) {
                    const response = await fetch(script.src);
                    if (!response.ok) continue;
                    scriptText = await response.text();
                    scriptCache[script.src] = scriptText;
                }
                eval(scriptText);
            }
            else if(script.nonce === nonce) eval(script.textContent);
            if(script.id === 'initScript') {
                State.page = page;
                State.session = session;
            }
        }

        document.title = page.data.document
            ? `${doc_fulltitle(page.data.document)}${getTitleDescription(page)} - ${CONFIG.site_name}`
            : `${page.title} - ${CONFIG.site_name}`;
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

let progressBar;
let progressInterval;
function setProgress(progress = 0) {
    if(progressInterval) clearInterval(progressInterval);
    if(progressBar.classList.contains('done')) progressBar.classList.remove('done');

    progressBar.style.width = progress + '%';

    if(progress === 100) resetProgress();
}

function increaseProgress(progress = 0, during = 3000, interval = 100) {
    if(progressInterval) clearInterval(progressInterval);
    if(progressBar.classList.contains('done')) progressBar.classList.remove('done');

    let currentProgress = parseFloat(progressBar.style.width) || 0;
    let increase = progress / (during / interval);
    progressInterval = setInterval(() => {
        currentProgress += increase;
        progressBar.style.width = currentProgress + '%';

        if(currentProgress >= progress) clearInterval(progressInterval);
    }, interval);
}

function progressTransitionEnd(e) {
    if(e.propertyName !== 'opacity') return;

    progressBar.classList.remove('done');
    progressBar.style.width = '0';
    progressBar.removeEventListener('transitionend', progressTransitionEnd);
}

function resetProgress() {
    progressBar.classList.add('done');
    progressBar.addEventListener('transitionend', progressTransitionEnd);
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

            emit('thetree:configChange');
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

window.addEventListener('load', () => {
    const bodyStyles = document.body.querySelectorAll('link[rel="stylesheet"]');
    for(let style of bodyStyles) {
        style.remove();

        style.dataset.injected = 'true';
        document.head.appendChild(style);
    }
});