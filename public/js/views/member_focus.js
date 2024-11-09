document.addEventListener('thetree:pageLoad', () => {
    const form = document.getElementById('member-form');
    const focusTarget = form.dataset.focus;
    if(focusTarget) {
        const target = document.getElementsByName(focusTarget)[0];
        if(target) target.focus();
    }
});