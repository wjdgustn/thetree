let title;
let navLinks;
let navTableBodies;

let createACLForm;
let target;
let aclType;

function updateNavs() {
    const splittedHref = location.hash.split('.');

    let showTarget;
    for(let other of navLinks) {
        const otherHref = other.getAttribute('href');
        if(otherHref.includes('.')) {
            const splittedOther = otherHref.split('.');
            if(splittedHref[0]) splittedOther[0] = splittedHref[0];

            const newOtherHref = splittedOther.join('.');
            other.href = newOtherHref;

            const parent = other.parentNode;
            if(location.hash.includes('.')
                ? splittedOther[1] === splittedHref[1]
                : parent.parentNode.children[0] === parent) {
                other.classList.add('nav-link-selected');
                showTarget = newOtherHref;
                title.innerText = other.innerText;

                target.value = splittedOther[0].slice(1);
                aclType.value = other.dataset.type;
            }
            else other.classList.remove('nav-link-selected');
        }
        else {
            const parent = other.parentNode;
            if(location.hash.length > 1
                ? otherHref === splittedHref[0]
                : parent.parentNode.children[0] === parent) {
                other.classList.add('nav-link-selected');
                createACLForm.hidden = other.dataset.editable === undefined;
            }
            else other.classList.remove('nav-link-selected');
        }
    }

    for(let tbody of navTableBodies) {
        tbody.hidden = tbody.id !== `tbody-${showTarget.slice(1)}`;
    }
}

document.addEventListener('thetree:pageLoad', () => {
    title = document.getElementById('acl-title');
    navLinks = document.querySelectorAll('.nav-block-content-ul > li > .nav-link');
    navTableBodies = document.getElementsByClassName('nav-tbody');

    createACLForm = document.getElementById('create-acl-form');
    target = document.getElementsByName('target')[0];
    aclType = document.getElementsByName('aclType')[0];

    updateNavs();

    for(let navLink of navLinks) {
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
}, { once: true });