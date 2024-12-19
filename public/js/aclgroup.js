document.addEventListener('thetree:pageLoad', () => {
    const createACLGroupButton = document.getElementById('create-aclgroup');
    const deleteACLGroupButtons = document.getElementsByClassName('delete-aclgroup');
    const deleteACLGroupItemButtons = document.getElementsByClassName('delete-aclgroupitem');
    const confirmButtons = document.getElementsByClassName('thetree-confirm-button');

    const createACLGroupModal = document.getElementById('create-aclgroup-modal');

    const deleteACLGroupModal = document.getElementById('delete-aclgroup-modal');
    const deleteACLGroupModalId = document.getElementById('delete-aclgroup-modal-id');
    const deleteACLGroupModalIdText = document.getElementById('delete-aclgroup-modal-id-text');

    const aclGroupRemoveForm = document.getElementById('aclgroup-remove-form');
    const aclGroupRemoveGroup = document.getElementById('aclgroup-remove-group');

    createACLGroupButton.addEventListener('click', () => createACLGroupModal._thetree.modal.open());

    for(let button of deleteACLGroupButtons) {
        const name = button.dataset.name;
        const uuid = button.dataset.uuid;

        button.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();

            if(!confirm(`${name} 그룹을 삭제하시겠습니까?`)) return;

            aclGroupRemoveGroup.value = uuid;
            aclGroupRemoveForm.dispatchEvent(new Event('submit'));
        });
    }

    for(let button of deleteACLGroupItemButtons) {
        const id = button.dataset.id;
        const uuid = button.dataset.uuid;

        button.addEventListener('click', () => {
            deleteACLGroupModalId.value = uuid;
            deleteACLGroupModalIdText.textContent = id;
            deleteACLGroupModal._thetree.modal.open();
        });
    }

    for(let button of confirmButtons)
        button.addEventListener('click', e => {
            if(!confirm('go?')) e.preventDefault();
        });
}, { once: true });