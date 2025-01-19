document.addEventListener('thetree:pageLoad', () => {
    const disabledFeaturesForm = document.getElementById('disabled-features-form');
    const templateSelector = document.getElementById('templateSelector');

    templateSelector.addEventListener('change', () => {
        const template = templates[templateSelector.value];
        for(let key in template) {
            if(key === 'name') continue;
            disabledFeaturesForm[key].value = template[key] || '';
        }
    });

    for(let i in templates) {
        const template = templates[i];
        const option = document.createElement('option');
        option.value = i;
        option.innerText = template.name;
        templateSelector.appendChild(option);
    }
}, { once: true });