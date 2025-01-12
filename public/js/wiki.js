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

        let offsetWidth;
        let offsetHeight;
        const resizeObserver = new ResizeObserver(([entry]) => {
            if(!entry.contentRect.height) return;

            foldingContent.classList.add('wiki-folding-opened');
            offsetWidth = foldingContent.offsetWidth;
            offsetHeight = foldingContent.offsetHeight;
            foldingContent.classList.remove('wiki-folding-opened');

            resizeObserver.disconnect();
        });
        resizeObserver.observe(foldingText);

        let transitionCount = 0;
        const transitioning = () => transitionCount !== 0;

        foldingContent.addEventListener('transitionstart', _ => transitionCount++);
        foldingContent.addEventListener('transitionend', _ => transitionCount--);
        foldingContent.addEventListener('transitioncancel', _ => transitionCount--);

        const setSizeToOffsetSize = () => {
            foldingContent.style.maxWidth = offsetWidth + 'px';
            foldingContent.style.maxHeight = offsetHeight + 'px';
        }
        const removeSize = () => {
            foldingContent.style.maxWidth = '';
            foldingContent.style.maxHeight = '';
        }
        const finishOpen = () => {
            if(transitioning()) return;

            removeSize();
            foldingContent.classList.add('wiki-folding-opened');

            foldingContent.removeEventListener('transitionend', finishOpen);
        }

        foldingText.addEventListener('click', e => {
            const foldingText = e.currentTarget;
            const foldingContent = foldingText.nextElementSibling;

            const opened = foldingContent.classList.contains('wiki-folding-open-anim');

            if(opened) {
                setSizeToOffsetSize();

                requestAnimationFrame(_ => {
                    foldingContent.classList.remove('wiki-folding-open-anim');
                    foldingContent.classList.remove('wiki-folding-opened');

                    removeSize();
                });
            }
            else {
                foldingContent.classList.add('wiki-folding-open-anim');
                setSizeToOffsetSize();

                foldingContent.addEventListener('transitionend', finishOpen);
            }
        });
    }

    let footnoteType = State.getLocalConfig('wiki.footnote_type');

    if(footnoteType === 'popover') setupFootnoteTooltip();
    else if(footnoteType === 'popup') setupFootnoteModal();

    const oldDarkStyle = document.getElementById('darkStyle');
    if(oldDarkStyle) oldDarkStyle.remove();

    const darkStyleElements = document.querySelectorAll('*[data-dark-style]');
    const darkStyles = [];
    for(let element of darkStyleElements) {
        const styleData = element.dataset.darkStyle.split(';').map(a => a.trim()).filter(a => a);
        let style = '';
        for(let stylePart of styleData) {
            const [key, value] = stylePart.split(':').map(a => a.trim());
            style += `${key}:${value} !important;`;
        }

        let darkStyle = darkStyles.find(a => a.style === style);
        if(!darkStyle) {
            darkStyle = {
                style,
                class: '_' + crypto.randomUUID().replaceAll('-', '')
            }
            darkStyles.push(darkStyle);
        }
        element.classList.add(darkStyle.class);
    }

    if(darkStyles.length) {
        const newDarkStyle = document.createElement('style');
        newDarkStyle.id = 'darkStyle';
        newDarkStyle.innerHTML = darkStyles.map(a => `.theseed-dark-mode .${a.class}{${a.style}}`).join('');
        document.body.appendChild(newDarkStyle);
    }
}

const footnotes = document.getElementsByClassName('wiki-fn-content');

function setupFootnoteTooltip() {
    const tooltip = document.getElementById('tooltip');
    const tooltipArrow = document.getElementById('tooltip-arrow');
    const tooltipContent = document.getElementById('tooltip-content');

    let cleanup;
    let hovering = 0;
    const mouseLeaveHandler = _ => {
        requestAnimationFrame(() => requestAnimationFrame( () =>{
            hovering--;

            if(!hovering) {
                tooltip.style.display = 'none';
                if (cleanup) cleanup();
            }
        }));
    }
    tooltip.addEventListener('mouseenter', _ => {
        hovering++;
    });
    tooltip.addEventListener('mouseleave', mouseLeaveHandler);

    for(let footnote of footnotes) {
        const targetId = footnote.getAttribute('href').slice(1);
        const contentElement = document.getElementById(targetId).parentElement;

        footnote.title = '';

        const update = () => FloatingUIDOM.computePosition(footnote, tooltip, {
            placement: 'top',
            middleware: [
                FloatingUIDOM.offset(5),
                FloatingUIDOM.flip(),
                FloatingUIDOM.shift()
            ]
        }).then(({x, y, placement, middlewareData}) => {
            tooltip.setAttribute('x-placement', placement);
            Object.assign(tooltip.style, {
                left: `${x}px`,
                top: `${y}px`,
            });

            tooltipArrow.style.left = `calc(50% - 10px - ${middlewareData.shift.x}px)`;
        });

        footnote.addEventListener('mouseenter', _ => {
            hovering++;

            tooltip.style.display = 'block';
            tooltipContent.innerHTML = contentElement.innerHTML;
            cleanup = FloatingUIDOM.autoUpdate(footnote, tooltip, update);
        });

        footnote.addEventListener('mouseleave', mouseLeaveHandler);
    }
}

function setupFootnoteModal() {
    for(let footnote of footnotes) {
        const targetId = footnote.getAttribute('href').slice(1);
        const contentElement = document.getElementById(targetId).parentElement;

        footnote.title = '';

        const modal = document.getElementById('footnote-modal');
        const modalContent = document.getElementById('footnote-modal-content');

        footnote.addEventListener('click', e => {
            e.preventDefault();

            modalContent.innerHTML = contentElement.innerHTML;
            modal._thetree.modal.open();
        });
    }
}

document.addEventListener('thetree:pageLoad', () => {
    setupWikiHandlers();
});