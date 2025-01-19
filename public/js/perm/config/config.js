document.addEventListener('thetree:pageLoad', () => {
    const disabledFeaturesForm = document.getElementById('disabled-features-form');
    const templateSelector = document.getElementById('templateSelector');

    const templates = [
        {
            name: '빈 템플릿',
            methodField: 'ALL',
            type: 'string',
            condition: '',
            messageType: 'res.error',
            message: ''
        },
        {
            name: '문서 생성 비활성화',
            methodField: 'POST',
            type: 'js',
            condition: `!req.permissions.includes('admin') && req.url.startsWith('/edit/') && req.body.baseuuid === 'create'`,
            messageType: 'plaintext',
            message: '새 문서 생성이 비활성화되어 있습니다.'
        },
        {
            name: '읽기 전용 모드',
            methodField: 'ALL',
            type: 'js',
            condition: `['/edit/', '/move/', '/delete/'].some(a => req.url.startsWith(a))`,
            messageType: 'res.error',
            message: '위키가 읽기 전용 모드입니다.'
        }
    ];
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