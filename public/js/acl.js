let title;
let navLinks;
let navTableBodies;

let createACLForm;
let target;
let aclType;

const aclTypes = [];

function updateNavs(hash) {
    if(!hash) hash = location.hash;
    const splittedHref = hash.split('.');

    let showTarget;
    for(let other of navLinks) {
        const otherHref = other.getAttribute('href');
        if(otherHref.includes('.')) {
            const splittedOther = otherHref.split('.');
            if(splittedHref[0]) splittedOther[0] = splittedHref[0];

            const newOtherHref = splittedOther.join('.');
            other.href = newOtherHref;

            const parent = other.parentNode;
            if(hash.includes('.')
                ? splittedOther[1] === splittedHref[1]
                : parent.parentNode.children[0] === parent) {
                other.classList.add('nav-content-selected');
                showTarget = newOtherHref;
                title.innerText = other.innerText;

                target.value = splittedOther[0].slice(1);
                aclType.value = other.dataset.type;
            }
            else other.classList.remove('nav-content-selected');

            if(!aclTypes.includes(splittedOther[1])) aclTypes.push(splittedOther[1]);
        }
        else {
            const parent = other.parentNode;
            if(hash.length > 1
                ? otherHref === splittedHref[0]
                : parent.parentNode.children[0] === parent) {
                other.classList.add('nav-content-selected');
                createACLForm.hidden = other.dataset.editable === undefined;
            }
            else other.classList.remove('nav-content-selected');
        }
    }

    for(let tbody of navTableBodies) {
        tbody.hidden = tbody.id !== `tbody-${showTarget.slice(1)}`;
    }
}

document.addEventListener('thetree:pageLoad', () => {
    window.beforePopstate = isHashChange => {
        if(isHashChange) {
            updateNavs();
            return false;
        }
        return true;
    }

    title = document.getElementById('acl-title');
    navLinks = document.querySelectorAll('.nav-block-content-ul > li > .nav-content');
    const contentNavLinks = document.getElementsByClassName('content-nav-content');
    navTableBodies = document.getElementsByClassName('nav-tbody');

    createACLForm = document.getElementById('create-acl-form');
    target = document.getElementsByName('target')[0];
    aclType = document.getElementsByName('aclType')[0];

    updateNavs();

    for(let navLink of [
        ...navLinks,
        ...contentNavLinks
    ]) {
        navLink.addEventListener('click', e => {
            const href = navLink.getAttribute('href');
            if(!href.startsWith('#')) return;

            e.preventDefault();
            history.pushState(null, null, navLink.href);

            updateNavs();
        });
    }

    const trs = document.querySelectorAll('tr');

    let dragging;
    for(let tr of trs) {
        if(tr.dataset.editable === undefined) continue;

        tr.draggable = true;

        tr.addEventListener('dragstart', _ => {
            dragging = tr;
        });

        tr.addEventListener('dragenter', _ => {
            if(!dragging) return;

            const childs = [...tr.parentNode.children];
            if(childs.indexOf(tr) < childs.indexOf(dragging))
                tr.before(dragging);
            else
                tr.after(dragging);
        });

        tr.addEventListener('dragover', e => {
            if(!dragging) return;

            e.preventDefault();
        });

        tr.addEventListener('dragend', async _ => {
            dragging = null;

            const childs = [...tr.parentNode.children];
            const uuids = childs.map(a => a.dataset.rule);

            const response = await fetch('/action/acl/reorder', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    acls: JSON.stringify(uuids)
                }).toString()
            });

            if(response.redirected) return await movePage(response);

            const text = await response.text();
            if(text) alert(text);
        });
    }

    const addToAll = document.getElementById('add-to-all');
    if(addToAll) addToAll.addEventListener('click', () => {
        const targetVal = target.value;

        for(let aclType of aclTypes) {
            updateNavs(`#${targetVal}.${aclType}`);
            createACLForm.dispatchEvent(new Event('submit'));
        }

        updateNavs();
    });
}, { once: true });