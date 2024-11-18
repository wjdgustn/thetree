document.addEventListener('thetree:pageLoad', () => {
    const navLinks = document.querySelectorAll('.nav-block-content-ul > li > .nav-link');

    for(let navLink of navLinks) {
        navLink.addEventListener('click', e => {
            const href = navLink.getAttribute('href');
            if(!href.startsWith('#')) return;

            e.preventDefault();
            history.pushState(null, null, navLink.href);

            const splittedHref = href.split('.');

            for(let other of navLinks) {
                const otherHref = other.getAttribute('href');
                if(otherHref.includes('.')) {
                    const splittedChild = otherHref.split('.');
                    splittedChild[0] = splittedHref[0];

                    other.href = splittedChild.join('.');

                    if(otherHref === href) other.classList.add('nav-link-selected');
                    else other.classList.remove('nav-link-selected');
                }
                else {
                    if(otherHref === splittedHref[0]) other.classList.add('nav-link-selected');
                    else other.classList.remove('nav-link-selected');
                }
            }
        });
    }

    const trs = document.querySelectorAll('tr');

    let dragging;
    for(let tr of trs) {
        tr.draggable = true;

        tr.addEventListener('dragstart', _ => {
            dragging = tr;
        });

        tr.addEventListener('dragenter', _ => {
            const childs = [...tr.parentNode.children];
            if(childs.indexOf(tr) < childs.indexOf(dragging))
                tr.before(dragging);
            else
                tr.after(dragging);
        });

        tr.addEventListener('dragover', e => {
            e.preventDefault();
        });

        tr.addEventListener('dragend', _ => {
            const childs = [...tr.parentNode.children];
            for(let child of childs) {
                console.log(child.children[0].innerText);
            }
            console.log('---');
        });
    }
});