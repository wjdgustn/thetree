document.addEventListener('thetree:pageLoad', () => {
    const form = document.querySelector('form[data-focus]');
    if(!form) return;

    const focusTarget = form.dataset.focus;
    if(focusTarget) {
        const target = document.getElementsByName(focusTarget)[0];
        if(target) target.focus();
    }
}, { once: true });