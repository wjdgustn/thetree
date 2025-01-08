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
            const firstUnfetchedComment = visibleComments.find(a => !a.dataset.fetched);
            if(!firstUnfetchedComment) return;

            fetchingComments = true;

            const firstIndex = firstUnfetchedComment.dataset.index;
            const firstComment = data.comments[firstIndex];

            let commentOffset = 0;
            const firstFetchedBelowComment = data.comments.find(a => a.id > firstComment.id && a.userHtml);
            if(firstFetchedBelowComment) {
                const belowCommentAmount = firstFetchedBelowComment.id - 1 - firstComment.id;
                commentOffset += data.commentLoadAmount - belowCommentAmount;
            }

            const comment = data.comments.find(a => !a.userHtml && a.id >= firstComment.id - commentOffset);

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

        requestAnimationFrame(() => {
            setupUserText();
        });
    });

    window.beforePageLoad.push(() => {
        window.removeEventListener('scroll', scrollHandler);
        socket.disconnect();
        return true;
    });

    scrollHandler();
}, { once: true });