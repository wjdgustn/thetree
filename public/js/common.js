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
    setupDocument();
});

let currentUrl = location.href;
window.addEventListener('popstate', async e => {
    const prevUrl = currentUrl;
    currentUrl = location.href;

    const isHashChange = prevUrl.split('#')[0] === currentUrl.split('#')[0];

    if(typeof window.beforePopstate === 'function') {
        const canMove = await window.beforePopstate(isHashChange);
        if(!canMove) return;
    }

    if(isHashChange) focusAnchor();
    else await movePage(location.href, false);
});

function plainAlert(text) {
    if(!text) return;

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

    if(form.enctype === 'multipart/form-data') return;

    e.preventDefault();

    const data = new FormData(form);

    const url = new URL(form.action);
    if(form.method === 'get')
        url.search = new URLSearchParams(data).toString();

    const response = await fetch(url, {
        method: form.method,
        ...(form.method === 'get' ? {} : {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams(data).toString()
        })
    });

    backupForm();

    if(response.redirected) {
        window.beforePageLoad = null;
        window.beforePopstate = null;
        return await movePage(response);
    }

    const html = await response.text();
    if(response.status.toString().startsWith('4')) return plainAlert(html);

    if(await replaceContent(html)) {
        setupDocument();
        restoreForm();
        changeUrl(response.url);
    }
    else plainAlert(html);
}

function updateTimeTag() {
    const times = document.getElementsByTagName('time');
    for(let time of times) {
        const type = time.dataset.type;
        const date = new Date(time.dateTime);

        if(type === 'keep') continue;

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
            modal: {}
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
async function movePage(response, pushState = true) {
    if(typeof window.beforePageLoad === 'function') {
        const canMove = await window.beforePageLoad();
        if(!canMove) return;
    }

    if(typeof response === 'string') response = await fetch(response);

    const html = await response.text();

    if(response.status.toString().startsWith('4')) return plainAlert(html);

    if(await replaceContent(html)) {
        if(pushState) changeUrl(response.url);

        setupDocument();
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
        const allScripts = [...newContent.querySelectorAll('script')];
        if(fullReload) allScripts.push(doc.getElementById('initScript'));

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

function isMobile() {
    let check = false;
    (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||window.opera);
    return check;
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