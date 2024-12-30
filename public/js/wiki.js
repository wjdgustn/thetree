function isMobile() {
    const ua = navigator.userAgent||navigator.vendor||window.opera;
    return /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(ua)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(ua.substr(0,4));
}

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

    let footnoteType = State.getLocalConfig('wiki.footnote_type');
    if(!footnoteType) footnoteType = isMobile() ? 'modal' : 'tooltip';

    if(footnoteType === 'tooltip') setupFootnoteTooltip();
    else if(footnoteType === 'modal') setupFootnoteModal();

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

    const newDarkStyle = document.createElement('style');
    newDarkStyle.id = 'darkStyle';
    newDarkStyle.innerHTML = darkStyles.map(a => `.theseed-dark-mode .${a.class}{${a.style}}`).join('');
    document.body.appendChild(newDarkStyle);
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