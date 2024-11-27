function headingClickHandler(e) {
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