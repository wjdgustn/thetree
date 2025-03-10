document.addEventListener('thetree:pageLoad', () => {
    const form = document.getElementById('edit-form');
    const formAlpineData = Alpine.$data(form);
    const textInput = document.getElementById('text-input');
    const pluginTabs = [...document.getElementsByClassName('plugin-tab')];
    const tabButtons = [...document.getElementsByClassName('tab-button')];

    formAlpineData.selectedTab = State.getLocalConfig('wiki.default_edit_mode');

    const setEditorValues = value => {
        for(let tab of pluginTabs) {
            tab._thetree.editor.setValue(value);
        }
        textInput.value = value;
    }
    requestAnimationFrame(() => {
        setEditorValues(textInput.value);
    });

    for(let button of tabButtons) {
        button.addEventListener('click', () => {
            const prevTab = document.getElementsByClassName('selected-tab-content')[0];
            const tabName = prevTab.dataset.tab;
            if(tabName === 'preview') return;

            const value = tabName === 'raw' ? textInput.value : prevTab._thetree.editor.getValue();
            setEditorValues(value);
        }, {
            capture: true
        });
    }

    const updateTextInput = () => {
        const currTab = document.getElementsByClassName('selected-tab-content')[0];
        const tabName = currTab.dataset.tab;
        if(!tabName.startsWith('plugin-')) return;

        const value = currTab._thetree.editor.getValue();
        textInput.value = value;
    }

    form.addEventListener('submit', updateTextInput, {
        capture: true
    });

    window.beforePageLoad.push(() => {
        updateTextInput();
        return true;
    });
}, { once: true });