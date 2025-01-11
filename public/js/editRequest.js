document.addEventListener('thetree:pageLoad', () => {
    const closeButton = document.getElementById('close-button');
    const closeModal = document.getElementById('editrequest-close-modal');

    const tooltip = document.getElementById('button-tooltip');
    const tooltipArrow = document.getElementById('button-tooltip-arrow');
    const tooltipContent = document.getElementById('button-tooltip-content');
    const tooltipButtons = document.querySelectorAll('[data-tooltip]');

    let showTooltipTimer;
    function showTooltip(text, element) {
        clearTimeout(showTooltipTimer);

        showTooltipTimer = setTimeout(() => {
            tooltipContent.textContent = text;
            tooltip.style.display = '';

            requestAnimationFrame(() => requestAnimationFrame(() => {
                tooltip.style.opacity = '';

                FloatingUIDOM.computePosition(element, tooltip, {
                    placement: 'top',
                    middleware: [
                        FloatingUIDOM.offset(6),
                        FloatingUIDOM.flip(),
                        FloatingUIDOM.shift()
                    ]
                }).then(({x, y, placement, middlewareData}) => {
                    tooltip.setAttribute('x-placement', placement);
                    Object.assign(tooltip.style, {
                        left: `${x}px`,
                        top: `${y}px`
                    });

                    tooltipArrow.style.left = `calc(50% - 5px - ${middlewareData.shift.x}px)`;
                });
            }));
        }, 150);
    }

    function hideTooltip() {
        clearTimeout(showTooltipTimer);

        tooltip.style.opacity = '0';

        const prevContent = tooltipContent.textContent;
        tooltip.addEventListener('transitionend', () => {
            if(tooltip.style.opacity === '0'
                && prevContent === tooltipContent.textContent) tooltip.style.display = 'none';
        }, { once: true });
    }

    window.showTooltip = showTooltip;
    window.hideTooltip = hideTooltip;

    closeButton?.addEventListener('click', () => closeModal._thetree.modal.open());

    for(let button of tooltipButtons) {
        button.addEventListener('mouseenter', () => {
            showTooltip(button.dataset.tooltip, button);
        });
        button.addEventListener('mouseleave', () => {
            hideTooltip();
        });
    }
}, { once: true });