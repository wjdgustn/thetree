for(let key of Object.keys(globalUtils)) window[key] = globalUtils[key];

window.defaultConfig = {
    'wiki.theme': window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

Object.defineProperty(window, 'query', {
    get() {
        return new URLSearchParams(window.location.search);
    }
});

let userPopup;

let quickBlockModal;
let quickBlockGroupSelect;
let quickBlockMode;
let quickBlockTarget;
let quickBlockNote;
let quickBlockDuration;

let settingModal;
let settingModalContent;

let captcha;
let captchaLoaded;
const captchaLock = [];

function contentLoadedHandler() {
    content = document.getElementById('content');
    progressBar = document.getElementById('progress-bar');
    userPopup = document.getElementById('userpopup');

    quickBlockModal = document.getElementById('quickblock-modal');
    quickBlockGroupSelect = document.getElementById('quickblock-group-select');
    quickBlockMode = document.getElementById('quickblock-mode');
    quickBlockTarget = document.getElementById('quickblock-target');
    quickBlockNote = document.getElementById('quickblock-note');
    quickBlockDuration = document.getElementById('quickblock-duration');

    settingModal = document.getElementById('setting-modal');
    settingModalContent = document.getElementById('setting-modal-content');

    const settingInputs = document.getElementsByClassName('setting-input');
    for(let input of settingInputs) {
        const isCheckbox = input.type === 'checkbox';
        const value = input.dataset.default;
        if(isCheckbox) {
            defaultConfig[input.id] ??= value === 'true';
            input.checked = State.getLocalConfig(input.id);
        }
        else {
            defaultConfig[input.id] ??= value;
            input.value = State.getLocalConfig(input.id);
        }

        State.localConfig[input.id] ??= defaultConfig[input.id];
    }
}

document.addEventListener('alpine:initialized', () => {
    contentLoadedHandler();
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
    else {
        skipScrollToTop = true;
        await movePage(location.href, false, prevUrl);
    }
});

function plainAlert(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const message = doc.body.textContent;

    const errorAlerts = document.getElementsByClassName('thetree-error-alert');
    let hasErrorAlert = false;
    for(let alert of errorAlerts) {
        if(!text) {
            alert.style = 'display:none';
            continue;
        }

        const probModal = alert.parentElement.parentElement.parentElement.parentElement;
        if(probModal.classList.contains('thetree-modal')) {
            if(!probModal.classList.contains('thetree-modal-open')) continue;
        }

        const content = alert.getElementsByClassName('thetree-alert-content-text')[0];
        if(!content) continue;

        alert.style = '';
        content.innerHTML = doc.body.innerHTML;
        hasErrorAlert = true;
    }
    if(!hasErrorAlert && text) alert(message);
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

function backupForm(form = null) {
    const forms = form ? [form] : content.querySelectorAll('form');
    for(let form of forms) {
        if(!form.id) continue;

        formBackup[form.id] = new FormData(form);
    }
}

function restoreForm(reset = false, form = null) {
    const forms = form ? [form] : content.querySelectorAll('form');
    const usedFormIds = [];
    for(let form of forms) {
        const backup = formBackup[form.id];
        if(!backup) continue;

        usedFormIds.push(form.id);

        for(let [key, value] of backup) {
            const input = form.querySelector(`input[name="${key}"], select[name="${key}"], textarea[name="${key}"]`);
            if(!input) continue;

            if(input.type === 'hidden') continue;

            if(input.type === 'checkbox')
                input.checked = !!value;
            else if(input.type === 'radio') {
                const radios = form.querySelectorAll(`input[name="${key}"]`);
                for(let radio of radios)
                    radio.checked = radio.value === value;
            }
            else {
                if(reset) value = input.getAttribute('value') ?? '';

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

function processFieldErrors(inputs, fieldErrors = {}) {
    for(let input of inputs) {
        if(!input.name) continue;

        const error = fieldErrors[input.name];

        let fieldError;
        if(['DIV', 'SPAN', 'LABEL'].includes(input.parentElement?.tagName)) {
            const isLabel = input.parentElement.tagName === 'LABEL';
            const parent = isLabel ? input.parentElement.parentElement : input.parentElement;
            fieldError = (isLabel ? parent.parentElement : parent).querySelector(`.input-error[data-for="${input.name}"]`);
            if(!fieldError && error) {
                fieldError = document.createElement('p');
                fieldError.classList.add('input-error');
                fieldError.dataset.for = input.name;
                if(isLabel)
                    parent.insertAdjacentElement('afterend', fieldError);
                else
                    parent.appendChild(fieldError);
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

const formBackup = {};
const formHandler = async e => {
    const form = e.currentTarget;

    if(form.dataset.noFormHandler || form._thetree?.submitting) return;

    e.preventDefault();

    if(form._thetree.captcha != null) {
        for(let { reject } of captchaLock) reject();
        captchaLock.length = 0;

        captcha.reset(form._thetree.captcha);
        captcha.execute(form._thetree.captcha);
        try {
            await new Promise((resolve, reject) => {
                captchaLock.push({ resolve, reject });
            });
        } catch(e) {
            return;
        }
    }

    increaseProgress(100);

    form._thetree.submitting = true;

    const submitButtons = form.querySelectorAll('button:not([type="button"]):not([disabled])');
    for(let button of submitButtons) {
        button.disabled = true;
    }

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

    form._thetree.submitting = false;
    for(let button of submitButtons) {
        button.disabled = false;
    }

    backupForm();

    const inputs = form.querySelectorAll('input, select, textarea');

    let probModal = e.target.parentElement.parentElement.parentElement;
    if(!probModal.classList.contains('thetree-modal'))
        probModal = null;

    if(response.status === 204) {
        restoreForm(true, form);
        setProgress(100);
        plainAlert();
        processFieldErrors(inputs);

        if(probModal)
            probModal._thetree.modal.close(true);

        return;
    }

    if(response.redirected) {
        if(probModal)
            probModal._thetree.modal.close(true);

        window.beforePageLoad = [];
        window.beforePopstate = null;
        return await movePage(response);
    }

    const html = await response.text();
    let json;
    try {
        json = JSON.parse(html);
    } catch(e) {}

    if(response.status.toString().startsWith('4') && !html.startsWith('<')) {
        if(json?.fieldErrors)
            processFieldErrors(inputs, json.fieldErrors);

        setProgress(100);

        if(!json?.fieldErrors) {
            processFieldErrors(inputs);

            if(html.includes('캡챠')) {
                form.dataset.captcha = '1';
                setupDocument(true);
            }

            return plainAlert(html);
        }
        else return plainAlert();
    }
    if(response.status.toString().startsWith('5') && html.includes('<')) {
        location.reload();
    }

    if(json?.type) {
        if(json.type === 'js') {
            eval(json.script);
        }

        plainAlert();
        processFieldErrors(inputs);
    }
    else if(await replaceContent(html, response.headers)) {
        setupDocument();
        restoreForm();
        changeUrl(response.url);
        plainAlert();
        processFieldErrors(inputs);
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

            const durationStr = durationToString(diff);

            if(durationStr) {
                time.textContent = durationStr;
                isRelative = true;
            }
        }

        let result = getTimeStr(date);

        if(type === 'timezone') {
            const offset = -(date.getTimezoneOffset() / 60);
            result += (offset > 0 ? '+' : '-') + (offset * 100).toString().padStart(4, '0');
        }

        if(isRelative) time.title = result;
        else time.textContent = result;
    }
}

let skipScrollToTop = false;
function focusAnchor() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if(hash) {
        let element;
        if(hash === 'toc')
            element = document.getElementsByClassName('wiki-macro-toc')[0];
        else
            element = document.getElementById(hash);

        if(element) element.scrollIntoView();
    }
    else {
        if(skipScrollToTop) skipScrollToTop = false;
        else window.scrollTo(0, 0);
    }

    // const selectedNavs = document.getElementsByClassName('nav-content-selected');
    // for(let nav of selectedNavs) {
    //     // scroll to there
    //     console.log(nav.parentElement.parentElement);
    //     nav.parentElement.parentElement.scrollLeft = nav.parentElement.offsetLeft;
    // }
}

function setupUserText() {
    const userTexts = document.getElementsByClassName('user-text-name');
    for(let userText of userTexts) {
        if(userText._thetree?.userTextInitialized) continue;

        const handler = e => {
            e.preventDefault();

            if(!userPopup.classList.contains('popup-close')) {
                State.userPopup.close();
                return false;
            }

            State.userPopup.name = userText.textContent;
            State.userPopup.uuid = userText.dataset.uuid;
            State.userPopup.type = parseInt(userText.dataset.type);
            State.userPopup.note = userText.dataset.note || null;
            State.userPopup.isAdmin = !!userText.dataset.admin;
            State.userPopup.threadAdmin = !!userText.dataset.threadadmin;

            State.userPopup.open(userText);

            return false;
        }

        userText._thetree ??= {};
        if(userText.tagName === 'A') userText.removeEventListener('click', aClickHandler);
        userText.addEventListener('click', handler);

        userText._thetree.userTextInitialized = true;
    }
}

let captchaOnLoadForm;
function captchaOnLoad() {
    captcha = ({
        recaptcha: window.grecaptcha,
        turnstile: window.turnstile
    }[CONFIG.captcha.type]);

    const div = document.createElement('div');
    div.style.clear = 'both';
    captchaOnLoadForm.appendChild(div);
    captchaOnLoadForm._thetree.captcha = captcha.render(div, {
        sitekey: CONFIG.captcha.site_key,
        theme: State.currentTheme,
        callback: () => {
            for(let { resolve } of captchaLock) resolve();
            captchaLock.length = 0;
        },
        ...{
            recaptcha: {
                badge: 'inline',
                size: 'invisible'
            },
            turnstile: {
                execution: 'execute'
            }
        }[CONFIG.captcha.type]
    });
}

function setupDocument(forceCaptcha = false) {
    const aElements = document.getElementsByTagName('a');
    for(let a of aElements) {
        if(a.getAttribute('@click')?.includes('aClickHandler')) continue;

        a.removeEventListener('click', aClickHandler);
        a.addEventListener('click', aClickHandler);
    }

    const forms = document.getElementsByTagName('form');
    for(let form of forms) {
        form.removeEventListener('submit', formHandler);
        form.addEventListener('submit', formHandler);

        form._thetree ??= {};

        if(CONFIG.captcha && form.dataset.captcha && (forceCaptcha || !State.session.disable_captcha)) {
            captchaOnLoadForm = form;
            if(captchaLoaded) {
                captchaOnLoad();
            }
            else {
                const script = document.createElement('script');
                script.src = {
                    recaptcha: 'https://www.google.com/recaptcha/api.js?render=explicit&onload=' + captchaOnLoad.name,
                    turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=' + captchaOnLoad.name
                }[CONFIG.captcha.type];
                document.head.appendChild(script);
                captchaLoaded = true;
            }
        }
    }

    updateTimeTag();
    focusAnchor();

    window.beforePageLoad = [];
    window.beforePopstate = null;

    const allElements = document.getElementsByTagName('*');
    for(let element of allElements) {
        const isThetreeComponent = (typeof element.className) === 'string'
            && element.className.includes('thetree');
        const isPlugin = element.id.startsWith('plugin-');
        if(!isThetreeComponent && !isPlugin) continue;
        if(element._thetree) continue;

        if(isPlugin) element._thetree = {
            editor: {
                getValue() {},
                setValue(value) {},
                onLoad() {}
            }
        }
        else element._thetree = {
            modal: {},
            dropdown: {},
            preHandler: null
        }
    }

    setupUserText();

    const popup = document.getElementsByClassName('popup');
    for(let p of popup) {
        p.addEventListener('transitionend', e => {
            if(p.classList.contains('popup-close'))
                Object.assign(p.style, {
                    left: '',
                    top: ''
                });
        });
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
            if(element) requestAnimationFrame(() => element.scrollIntoView());
            newUrl.searchParams.delete('anchor');
            newUrl.hash = anchor;
        }
        newUrl.searchParams.delete('f');
        history.pushState({}, null, newUrl.toString());
        currentUrl = newUrl.toString();
    }
}

let content;
let movePageAbortController;
async function movePage(response, pushState = true, prevUrl = null) {
    if(window.beforePageLoad.length) for(let handler of window.beforePageLoad) {
        const canMove = await handler();
        if(!canMove) {
            if(prevUrl) history.pushState({}, null, prevUrl);
            return;
        }
    }

    increaseProgress(100);

    let anchor = '';
    if(typeof response === 'string') {
        const url = new URL(response, location.origin);
        if(url.hash) anchor = url.hash;
        url.searchParams.set('f', '1');

        movePageAbortController?.abort();
        movePageAbortController = new AbortController();
        try {
            response = await fetch((response.startsWith('?') ? '' : url.pathname) + url.search, {
                signal: movePageAbortController.signal
            });
        } catch(e) {
            if(e.name === 'AbortError') return;

            console.error(e);
            return;
        }
    }

    const html = await response.text();

    if(response.status.toString().startsWith('4')
        && !html.startsWith('<')) {
        setProgress(100);
        return plainAlert(html);
    }
    else if(response.status.toString().startsWith('5') && html.startsWith('<')) {
        location.reload();
    }
    else plainAlert();

    if(response.status === 204) return setProgress(100);

    if(await replaceContent(html, response.headers)) {
        if(pushState) changeUrl(response.url + anchor);

        setupDocument();
        restoreForm();
    }
    else {
        const newUrl = new URL(response.url);
        newUrl.hash = anchor;
        newUrl.searchParams.delete('f');

        location.href = newUrl.toString();
    }

    setProgress(100);
}

function updateTitle() {
    document.title = page.data.document
        ? `${doc_fulltitle(page.data.document)}${getTitleDescription(page)} - ${CONFIG.site_name}`
        : `${page.title} - ${CONFIG.site_name}`;
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
        if(location.pathname === '/member/mypage') return location.reload();

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
                    try {
                        const response = await fetch(script.src);
                        if(!response.ok) continue;
                        scriptText = await response.text();
                        scriptCache[script.src] = scriptText;
                    } catch(e) {
                        console.error(e);
                        console.error('script fetch error, src:', script.src);
                    }
                }
                eval(scriptText);
            }
            else if(script.nonce === nonce) eval(script.textContent);
            if(script.id === 'initScript') {
                State.page = page;
                State.session = session;
            }
        }

        updateTitle();
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
    if(!window.beforePageLoad.length) return;

    for(let handler of window.beforePageLoad) {
        const canMove = handler();
        if(!canMove) e.preventDefault();
    }
});

const getLocalConfig = key => {
    const result = (window.State ? State.localConfig : localConfig)[key] ?? defaultConfig[key];
    if(key === 'wiki.theme' && result === 'auto') return defaultConfig[key];
    return result;
}

const userLocalConfig = JSON.parse(localStorage.getItem('thetree_settings') ?? '{}');
const localConfig = { ...userLocalConfig };
document.addEventListener('alpine:init', () => {
    Alpine.store('state', {
        page,
        session,
        localConfig,
        recent: [],

        aClickHandler,
        movePage,

        userPopup: {
            type: 1,
            name: '',
            uuid: '',
            note: null,
            isAdmin: false,
            threadAdmin: false,
            deleted: false,
            account: false,
            blockable: false,
            get typeStr() {
                switch(parseInt(State.userPopup.type)) {
                    case 0:
                        return 'IP';
                    default:
                        let str = '사용자';
                        if(State.userPopup.isAdmin) str += ' (관리자)';
                        else if(State.userPopup.threadAdmin) str += ' (전 관리자)';
                        return str;
                }
            },
            async block() {
                const isAccount = State.userPopup.account;
                await State.openQuickACLGroup({
                    username: isAccount ? State.userPopup.name : null,
                    ip: !isAccount ? State.userPopup.name : null,
                    note: State.userPopup.note ?? undefined
                });
            },
            open(userText) {
                State.userPopup.deleted = State.userPopup.type === -1;
                State.userPopup.account = State.userPopup.type === 1;
                State.userPopup.blockable = [0, 1].includes(State.userPopup.type);

                requestAnimationFrame(() => requestAnimationFrame(() => {
                    userPopup.classList.remove('popup-close');

                    FloatingUIDOM.computePosition(userText, userPopup, {
                        placement: 'bottom-start',
                        middleware: [
                            FloatingUIDOM.offset(5),
                            FloatingUIDOM.flip()
                        ]
                    }).then(({x, y}) => {
                        Object.assign(userPopup.style, {
                            left: `${x}px`,
                            top: `${y}px`
                        });
                    });
                }));
            },
            close() {
                userPopup.classList.add('popup-close');
            }
        },
        threadPopup: {
            comment: null,
            open(comment, button) {
                const threadPopup = document.getElementById('threadpopup');
                if(!threadPopup) return;

                State.threadPopup.comment = comment;

                requestAnimationFrame(() => requestAnimationFrame(() => {
                    threadPopup.classList.remove('popup-close');

                    FloatingUIDOM.computePosition(button, threadPopup, {
                        placement: 'bottom-end',
                        middleware: [
                            FloatingUIDOM.offset(6),
                            FloatingUIDOM.flip()
                        ]
                    }).then(({x, y}) => {
                        Object.assign(threadPopup.style, {
                            left: `${x}px`,
                            top: `${y}px`
                        });
                    });
                }));
            },
            close() {
                const threadPopup = document.getElementById('threadpopup');
                if(!threadPopup) return;

                threadPopup.classList.add('popup-close');
            },
            async toggleRaw() {
                const comment = State.threadPopup.comment;

                if(!comment.rawHtml) {
                    const response = await fetch(`/admin/thread/${State.page.data.thread.url}/${State.threadPopup.comment.id}/raw`);
                    const text = await response.text();
                    if(!response.ok) return alert(text);

                    const rawHtml = document.createElement('div');
                    rawHtml.classList.add('wiki-raw');
                    rawHtml.innerText = text;

                    comment.rawHtml = rawHtml.outerHTML;
                }

                comment.seeRaw = !comment.seeRaw;
                comment.forceShow = true;
            },
            async hide() {
                await fetch(`/admin/thread/${State.page.data.thread.url}/${State.threadPopup.comment.id}/hide`, {
                    method: 'POST'
                });
            },
            async show() {
                await fetch(`/admin/thread/${State.page.data.thread.url}/${State.threadPopup.comment.id}/show`, {
                    method: 'POST'
                });
            }
        },

        threadIntersectionObserver: new IntersectionObserver(async entries => {
            let hasNewVisible = false;
            for(let entry of entries) {
                const element = entry.target.parentElement;

                if(entry.isIntersecting) {
                    element.classList.add('comment-block-visible');
                    hasNewVisible = true;
                }
                else {
                    element.classList.remove('comment-block-visible');
                }
            }
            if(hasNewVisible) window.dispatchEvent(new Event('scroll'));
        }),

        async openQuickACLGroup({
            username = null,
            ip = null,
            note = '긴급차단'
        } = {}) {
            quickBlockGroupSelect.innerHTML = '';
            quickBlockGroupSelect.disabled = true;

            quickBlockMode.value = username == null ? 'ip' : 'username';
            quickBlockMode.dispatchEvent(new Event('change'));
            quickBlockTarget.value = username ?? ip;
            quickBlockNote.value = note;
            quickBlockDuration.value = '0';

            quickBlockModal.querySelector('.thetree-alert').style = 'display:none';
            quickBlockModal.querySelectorAll('.input-error').forEach(a => a.remove());

            quickBlockModal._thetree.modal.open();

            const res = await fetch('/aclgroup/groups');
            const groups = await res.json();

            for(let group of groups) {
                const option = document.createElement('option');
                option.value = group.uuid;
                option.textContent = group.name;
                quickBlockGroupSelect.appendChild(option);
            }

            quickBlockGroupSelect.disabled = false;
        },

        settingSelectedTab: null,
        openSettingModal() {
            State.selectSettingTab('wiki', true);
            settingModal._thetree.modal.open();
        },
        selectSettingTab(tabName, skipAnim = false) {
            if(tabName === State.settingSelectedTab) return;

            State.settingSelectedTab = tabName;

            const oldTab = settingModalContent.getElementsByClassName('selected-tab-content')[0];
            if(!skipAnim && !oldTab) return;

            oldTab?.classList.remove('selected-tab-content');

            const afterAnim = () => {
                oldTab?.classList.remove('setting-tab-leave');

                const tab = document.getElementById('setting-tab-' + State.settingSelectedTab);
                tab.classList.add('selected-tab-content');
            }

            if(skipAnim) afterAnim();
            else {
                oldTab.classList.add('setting-tab-leave');
                oldTab.addEventListener('transitionend', afterAnim);
            }
        },

        async init() {
            setInterval(() => this.updateSidebar(), 1000 * 30);
            await this.updateSidebar();
        },
        async updateSidebar() {
            const result = await fetch('/sidebar.json');
            this.recent = await result.json();
            requestAnimationFrame(() => updateTimeTag());
        },
        getLocalConfig(key) {
            return this.localConfig[key] ?? defaultConfig[key];
        },
        setLocalConfig(key, value) {
            this.localConfig[key] = value;
            userLocalConfig[key] = value;
            localStorage.setItem('thetree_settings', JSON.stringify(userLocalConfig));

            emit('thetree:configChange');

            if(key === 'wiki.no_relative_date') updateTimeTag();

            const input = document.getElementById(key);
            const isCheckbox = input.type === 'checkbox';
            if(isCheckbox) input.checked = value;
            else input.value = value;
        },
        get currentTheme() {
            const theme = this.getLocalConfig('wiki.theme');
            return theme === 'auto' ? defaultConfig['wiki.theme'] : theme;
        }
    });
    window.State = Alpine.store('state');

    Alpine.data('search', () => ({
        searchFocused: false,
        lastSearchText: '',
        searchText: '',
        cursor: -1,
        internalItems: [],
        searchAbortController: null,
        wait: 50,
        searchTimeout: null,
        get show() {
            return this.searchFocused && this.searchText.length > 0 && this.internalItems.length > 0;
        },
        blur() {
            setTimeout(() => {
                this.searchFocused = false;
            }, 100);
        },
        focus() {
            this.searchFocused = true;
        },
        inputChange() {
            if(this.searchTimeout) clearTimeout(this.searchTimeout);

            this.searchTimeout = setTimeout(async () => {
                if(this.searchText === this.lastSearchText) return;
                this.lastSearchText = this.searchText;

                if(!this.searchText.length) {
                    this.internalItems = [];
                    return;
                }

                if(this.searchAbortController) this.searchAbortController.abort();

                try {
                    this.searchAbortController = new AbortController();
                    const result = await fetch(`/Complete?q=${encodeURIComponent(this.searchText)}`, {
                        signal: this.searchAbortController.signal
                    });
                    this.internalItems = await result.json();
                    this.cursor = -1;
                } catch(e) {}
            }, this.wait);
        },
        async onClickItem(item) {
            await movePage(`/Go?q=${encodeURIComponent(item)}`);
        },
        async keyEnter(e) {
            e.preventDefault();

            const item = this.internalItems[this.cursor];
            if(item) await this.onClickItem(item);
            else if(this.searchText) await movePage(`/Go?q=${encodeURIComponent(this.searchText)}`);
            else return;

            e.srcElement.blur();
        },
        keyUp() {
            if(this.cursor >= 0) this.cursor--;
        },
        keyDown() {
            if(this.cursor < this.internalItems.length) this.cursor++;
        },
        async onClickSearch(e) {
            e.preventDefault();
            if(!this.searchText) return;

            e.srcElement.blur();
            await movePage(`/Search?q=${encodeURIComponent(this.searchText)}`);
        },
        async onClickMove(e) {
            e.preventDefault();
            if(!this.searchText) return;

            e.srcElement.blur();
            await movePage(doc_action_link(this.searchText, 'w'));
        }
    }));

    Alpine.data('app', () => ({
        wikiContent: {
            [':class']() {
                const discuss = this.$el.classList.contains('wiki-thread-content');
                return {
                    'nowrap-wiki-table': State.localConfig['wiki.nowrap_wiki_table'],
                    'always-show-external-link-icon': State.localConfig['wiki.always_show_external_link_icon'],
                    'disable-strike': 'remove' === State.localConfig[discuss ? 'discuss.strike' : 'wiki.strike'],
                    'hide-strike': 'hide' === State.localConfig[discuss ? 'discuss.strike' : 'wiki.strike'],
                    'disable-bold': discuss && 'remove' === State.localConfig['discuss.bold'],
                    'hide-bold': discuss && 'hide' === State.localConfig['discuss.bold']
                }
            }
        }
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

window.addEventListener('keypress', async e => {
    if([
        'INPUT', 'TEXTAREA'
    ].includes(document.activeElement.tagName)) return;

    if(e.key === 'c') await movePage('/RecentChanges');
    if(e.key === 'd') await movePage('/RecentDiscuss');
    if(e.key === 'a') await movePage('/random');
    if(e.key === 'f') await movePage(`/w/${CONFIG.front_page}`);
    if(e.key === 'e') {
        const document = State.page.data.document;
        if(document) await movePage(doc_action_link(document, 'edit'));
    }
});