document.addEventListener('thetree:pageLoad', () => {
    const form = document.getElementById('pinForm');
    const formAlpineData = Alpine.$data(form);
    const pinInputs = [...document.getElementsByClassName('pin-input')];
    const hiddenPinInput = document.getElementById('pin-input-hidden');
    const passkeyLoginButton = document.getElementById('passkey-login-button');

    const getPinValue = () => pinInputs.map(a => a.value).join('');
    const focusPinInput = () => {
        const pinValue = getPinValue();
        pinInputs[pinValue.length]?.focus();
        hiddenPinInput.value = pinValue;
    }
    const movePinTexts = () => {
        const pinValue = getPinValue();
        for(let i in pinInputs) {
            const fillInput = pinInputs[i];
            const str = pinValue[i];
            if(!str) break;
            fillInput.value = str;
        }
    }

    for(let input of pinInputs) {
        input.addEventListener('focus', () => {
            focusPinInput();
        });

        input.addEventListener('input', () => {
            movePinTexts();
            focusPinInput();
        });

        input.addEventListener('keydown', e => {
            if(e.key === 'Backspace') {
                const pinValue = getPinValue();
                if(pinValue.length === 0) return;
                pinInputs[pinValue.length - 1].value = '';
                focusPinInput();
            }
        });

        input.addEventListener('paste', e => {
            const text = e.clipboardData.getData('text');
            e.preventDefault();

            for(let fillInput of pinInputs) {
                fillInput.value = '';
            }
            pinInputs[0].value = text;
            movePinTexts();
            focusPinInput();
        });
    }

    passkeyLoginButton.addEventListener('click', async () => {
        formAlpineData.doingPasskey = true;

        let asseResp;
        try {
            asseResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: State.page.data.passkeyData });
        } catch (e) {
            console.error(e);
            alert(e.toString());
            formAlpineData.doingPasskey = false;
            return;
        }

        const verification = await fetch('/member/login/pin', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                challenge: asseResp
            })
        });
        await movePage(verification);
    });

    if(formAlpineData.mode === 'passkey') passkeyLoginButton.click();
    else focusPinInput();
}, { once: true });