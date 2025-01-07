document.addEventListener('thetree:pageLoad', () => {
    let scrollTimer;
    let locks = [];
    let fetchingComments = false;
    const scrollHandler = () => {
        if(scrollTimer != null) clearTimeout(scrollTimer);

        scrollTimer = setTimeout(async () => {
            console.log('scroll stopped');

            if(fetchingComments) await waitUntil(new Promise(resolve => {
                locks.push(resolve);
            }), 5000);

            const visibleComments = document.getElementsByClassName('comment-block-visible');
            const firstUnfetchedComment = [...visibleComments].find(a => !a.dataset.fetched);
            if(!firstUnfetchedComment) return;

            fetchingComments = true;

            console.log(`fetch comments under ${firstUnfetchedComment.dataset.index}`);

            fetchingComments = false;
            locks.forEach(r => r());
        }, 100);
    }

    window.addEventListener('scroll', scrollHandler);

    window.beforePageLoad = () => {
        console.log('cleanup scroll handler');
        window.removeEventListener('scroll', scrollHandler);
        return true;
    }

    scrollHandler();
}, { once: true });