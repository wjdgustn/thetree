document.addEventListener('thetree:pageLoad', () => {
    const addPasskeyButton = document.getElementById('add-passkey-button');
    const passkeyNameInput = document.getElementById('passkey-name-input');

    const deletePasskeyButtons = [...document.getElementsByClassName('delete-passkey-button')];

    addPasskeyButton?.addEventListener('click', async () => {
        const register = await fetch('/member/register_webauthn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: passkeyNameInput.value
            })
        });
        if(register.status !== 200) return alert(await register.text());
        const optionsJSON = await register.json();

        let attResp;
        try {
            attResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON });
        } catch(e) {
            console.error(e);
            alert(e.toString());
            return;
        }

        const verification = await fetch('/member/register_webauthn/challenge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(attResp)
        });

        if(verification.status === 204) {
            await movePage(location.href);
        }
        else {
            alert(await verification.text());
        }
    });

    for(let button of deletePasskeyButtons) {
        button.addEventListener('click', async () => {
            const res = await fetch('/member/delete_webauthn', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: button.dataset.name
                })
            });

            if(res.status === 204) await movePage(location.href);
            else alert(await res.text());
        });
    }
}, { once: true });