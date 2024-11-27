let textInput;
let originalContent = '';

document.addEventListener('thetree:pageLoad', () => {
    window.beforePageLoad = () => {
        if(textInput.value !== originalContent) {
            return confirm('변경된 사항이 저장되지 않았습니다.');
        }

        return true;
    }

    const previewTabButton = document.getElementById('preview-tab-button');
    const previewTabContent = document.getElementById('preview-tab-content');
    textInput = document.getElementById('text-input');

    originalContent = textInput.value;

    previewTabButton?.addEventListener('click', async () => {
        previewTabContent.classList.add('preview-tab-loading');
        previewTabContent.innerHTML = '';

        const response = await fetch(doc_action_link(page.data.document, 'preview'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                content: textInput.value
            }).toString()
        });
        previewTabContent.innerHTML = await response.text();

        previewTabContent.classList.remove('preview-tab-loading');

        setupWikiHandlers();
    });
}, { once: true });