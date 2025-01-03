document.addEventListener('thetree:pageLoad', () => {
    const modals = document.getElementsByClassName('thetree-modal');
    for(let modal of modals) {
        // const bg = modal.getElementsByClassName('thetree-modal-bg')[0];
        const container = modal.getElementsByClassName('thetree-modal-container')[0];
        const content = modal.getElementsByClassName('thetree-modal-content')[0];
        const closeButton = modal.getElementsByClassName('thetree-modal-close')[0];

        const modalProps = modal._thetree.modal;

        if(modalProps.initialized) continue;

        modalProps.open = () => {
            if(modal.classList.contains('thetree-modal-display')) return;

            modal.classList.add('thetree-modal-display');
            document.body.style.overflow = 'hidden';

            requestAnimationFrame(() => requestAnimationFrame(() => {
                modal.classList.add('thetree-modal-open');
            }));
        }

        modalProps.close = (skipAnim = false) => {
            if(!modal.classList.contains('thetree-modal-open')) return;

            if(skipAnim) modal.classList.add('thetree-modal-noanim');

            modal.classList.remove('thetree-modal-open');
            document.body.style.overflow = '';

            modal.addEventListener('transitionend', () => {
                modal.classList.remove('thetree-modal-display');
                modal.classList.remove('thetree-modal-noanim');
            }, { once: true });

            if(skipAnim) modal.dispatchEvent(new Event('transitionend'));
        }

        container.addEventListener('click', () => modalProps.close());
        content.addEventListener('click', e => e.stopPropagation());
        closeButton.addEventListener('click', () => modalProps.close());

        modalProps.initialized = true;
    }
});