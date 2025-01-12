document.addEventListener('thetree:pageLoad', () => {
    const evalOutput = document.getElementById('evalOutput');
    const evalContent = document.getElementById('evalContent');
    const evalRun = document.getElementById('evalRun');
    const dangerButtons = document.getElementsByClassName('thetree-danger-button');
    const disabledFeaturesForm = document.getElementById('disabled-features-form');
    const templateSelector = document.getElementById('templateSelector');

    evalRun.addEventListener('click', async () => {
        if(!evalContent.value) return;

        evalOutput.innerHTML = '';

        const response = await fetch('/admin/config/eval', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                code: evalContent.value
            }).toString()
        });
        evalOutput.innerHTML = await response.text();
    });

    evalContent.addEventListener('keydown', e => {
        if(!e.shiftKey && e.key === 'Enter') {
            e.preventDefault();
            evalRun.click();
        }
    });

    for(let button of dangerButtons) button._thetree.preHandler = e => {
        if(!confirm('go?')) {
            e.preventDefault();
            return false;
        }
    }

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