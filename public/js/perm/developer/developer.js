document.addEventListener('thetree:pageLoad', () => {
    const evalOutput = document.getElementById('evalOutput');
    const evalContent = document.getElementById('evalContent');
    const evalRun = document.getElementById('evalRun');
    const dangerButtons = document.getElementsByClassName('thetree-danger-button');

    evalRun.addEventListener('click', async () => {
        if(!evalContent.value) return;

        evalOutput.innerHTML = '';

        const response = await fetch('/admin/developer/eval', {
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
}, { once: true });