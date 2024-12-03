function setupWikiHandlers() {
    const headings = document.getElementsByClassName('wiki-heading');
    for(let heading of headings) {
        heading.addEventListener('click', e => {
            if(e.target.tagName === 'A') return;

            const heading = e.currentTarget;
            const content = heading.nextElementSibling;
            const prevClosed = heading.classList.contains('wiki-heading-folded');
            if(prevClosed) {
                heading.classList.remove('wiki-heading-folded');
                content.classList.remove('wiki-heading-content-folded');
            }
            else {
                heading.classList.add('wiki-heading-folded');
                content.classList.add('wiki-heading-content-folded');
            }
        });
    }

    const foldings = document.getElementsByClassName('wiki-folding');
    for(let folding of foldings) {
        const foldingText = folding.firstElementChild;
        const foldingContent = foldingText.nextElementSibling;

        foldingContent.classList.add('wiki-folding-opened');
        const offsetWidth = folding.offsetWidth;
        const offsetHeight = folding.offsetHeight;
        foldingContent.classList.remove('wiki-folding-opened');

        foldingText.addEventListener('click', e => {
            const foldingText = e.currentTarget;
            const foldingContent = foldingText.nextElementSibling;

            const opened = foldingContent.classList.contains('wiki-folding-open-anim');

            const setSizeToOffsetSize = () => {
                foldingContent.style.maxWidth = offsetWidth + 'px';
                foldingContent.style.maxHeight = offsetHeight + 'px';
            }
            const removeSize = () => {
                foldingContent.style.maxWidth = '';
                foldingContent.style.maxHeight = '';
            }
            const finishOpen = () => {
                if(transitionCount) return;

                console.log('finishOpen');

                removeSize();
                foldingContent.classList.add('wiki-folding-opened');
            }

            let transitionCount = 0;

            foldingContent.addEventListener('transitionstart', () => transitionCount++);
            foldingContent.addEventListener('transitionend', () => transitionCount--);
            foldingContent.addEventListener('transitioncancel', () => transitionCount--);

            if(opened) {
                setSizeToOffsetSize();

                requestAnimationFrame(() => requestAnimationFrame(() => {
                    foldingContent.classList.remove('wiki-folding-open-anim');
                    foldingContent.classList.remove('wiki-folding-opened');

                    removeSize();
                }));
            }
            else {
                foldingContent.classList.add('wiki-folding-open-anim');
                setSizeToOffsetSize();

                foldingContent.addEventListener('transitionend', finishOpen, { once: true });
            }
        });
    }
}

document.addEventListener('thetree:pageLoad', () => {
    setupWikiHandlers();
});