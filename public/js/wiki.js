function headingClickHandler(e) {
    const content = e.target.nextElementSibling;
    const prevClosed = e.target.classList.contains('wiki-heading-folded');
    if(prevClosed) {
        e.target.classList.remove('wiki-heading-folded');
        content.classList.remove('wiki-heading-content-folded');
    }
    else {
        e.target.classList.add('wiki-heading-folded');
        content.classList.add('wiki-heading-content-folded');
    }
}

function setupWikiHandlers() {
    const headings = document.getElementsByClassName('wiki-heading');
    for(let heading of headings) {
        heading.removeEventListener('click', headingClickHandler);
        heading.addEventListener('click', headingClickHandler);
    }
}

document.addEventListener('thetree:pageLoad', () => {
    setupWikiHandlers();
});