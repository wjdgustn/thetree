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

    setupFootnoteTooltip();
}

function setupFootnoteTooltip() {
    const tooltip = document.getElementById('tooltip');
    const tooltipContent = document.getElementById('tooltip-content');

    let cleanup;
    let hovering = 0;
    const mouseLeaveHandler = _ => {
        requestAnimationFrame(() => {
            console.log('oh mouse leave', hovering);
            hovering--;

            if(!hovering) {
                tooltip.style.display = 'none';
                if (cleanup) cleanup();
            }
        });
    }
    tooltip.addEventListener('mouseenter', _ => {
        hovering++;
    });
    tooltip.addEventListener('mouseleave', mouseLeaveHandler);

    const footnotes = document.getElementsByClassName('wiki-fn-content');
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
        });

        footnote.addEventListener('mouseenter', _ => {
            console.log('oh mouse enter');
            hovering++;

            tooltip.style.display = 'block';
            tooltipContent.innerHTML = contentElement.innerHTML;
            cleanup = FloatingUIDOM.autoUpdate(footnote, tooltip, update);
        });

        footnote.addEventListener('mouseleave', mouseLeaveHandler);
    }
}

document.addEventListener('thetree:pageLoad', () => {
    setupWikiHandlers();
});