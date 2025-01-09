document.addEventListener('thetree:pageLoad', () => {
    const textInputs = document.getElementsByClassName('unsaved-warn');
    for(let textInput of textInputs) {
        textInput._thetree ??= {};
        textInput._thetree.originalContent = textInput.value;
    }

    window.beforePageLoad.push(() => {
        for(let textInput of textInputs) {
            if(textInput.value !== textInput._thetree.originalContent) {
                return confirm('변경된 사항이 저장되지 않았습니다.');
            }
        }

        return true;
    });
}, { once: true });