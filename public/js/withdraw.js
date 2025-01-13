document.addEventListener('thetree:pageLoad', () => {
    const input = document.getElementById('pledgeInput');
    const [correctText, remainingText] = document.getElementsByClassName('pledge-text');

    remainingText.innerText = withdraw_pledge;

    const textArr = withdraw_pledge.split('');
    input.addEventListener('input', () => {
        let correctLen = 0;
        for(let i in textArr) {
            const char1 = input.value[i];
            const char2 = textArr[i];
            if(char1 !== char2) break;
            correctLen++;
        }

        correctText.innerText = withdraw_pledge.slice(0, correctLen);
        remainingText.innerText = withdraw_pledge.slice(correctLen);
    });

    input.addEventListener('paste', e => {
        e.preventDefault();
    });
});