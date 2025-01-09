document.addEventListener('thetree:pageLoad', () => {
    const previewTabButton = document.getElementById('preview-tab-button');
    const previewTabContent = document.getElementById('preview-tab-content');
    const textInput = document.getElementById('text-input');

    previewTabButton?.addEventListener('click', async () => {
        previewTabContent.classList.add('preview-tab-loading');
        previewTabContent.innerHTML = '';

        const response = await fetch(doc_action_link(page.data.document, 'preview'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                content: textInput.value,
                ...(page.data.thread ? {
                    mode: 'thread'
                } : {})
            }).toString()
        });
        previewTabContent.innerHTML = await response.text();

        previewTabContent.classList.remove('preview-tab-loading');

        setupWikiHandlers();
        updateTimeTag();
    });
}, { once: true });