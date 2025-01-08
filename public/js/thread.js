document.addEventListener('thetree:pageLoad', () => {
    const data = State.page.data;

    let scrollTimer;
    let locks = [];
    let fetchingComments = false;
    const scrollHandler = () => {
        if(scrollTimer != null) clearTimeout(scrollTimer);

        scrollTimer = setTimeout(async () => {
            if(fetchingComments) await waitUntil(new Promise(resolve => {
                locks.push(resolve);
            }), 5000);

            const visibleComments = [...document.getElementsByClassName('comment-block-visible')];
            const lastUnfetchedComment = visibleComments.findLast(a => !a.dataset.fetched);
            if(!lastUnfetchedComment) return;

            fetchingComments = true;

            const lastIndex = lastUnfetchedComment.dataset.index;
            const lastComment = data.comments[lastIndex];
            console.log(lastComment);
            const comment = data.comments.find(a => !a.userHtml && a.id >= lastComment.id - State.page.data.commentLoadAmount + 1);
            console.log(`fetch comments under ${comment.id}`);
            console.log(comment);

            const response = await fetch(`/thread/${data.thread.url}/${comment.id}`);
            const comments = await response.json();
            for(let comment of comments) {
                const commentIndex = data.comments.findIndex(a => a.id === comment.id);
                if(commentIndex !== -1) data.comments[commentIndex] = comment;
                else data.comments.push(comment);
            }

            fetchingComments = false;
            locks.forEach(r => r());

            requestAnimationFrame(() => {
                setupUserText();
            });
        }, 100);
    }

    window.addEventListener('scroll', scrollHandler);

    const socket = io('/thread', {
        query: {
            thread: data.thread.url
        }
    });
    socket.on('comment', comment => {
        data.comments.push(comment);
    });

    window.beforePageLoad.push(() => {
        window.removeEventListener('scroll', scrollHandler);
        socket.disconnect();
        return true;
    });

    scrollHandler();
}, { once: true });