document.addEventListener('thetree:pageLoad', () => {
    const fileBlock = document.getElementsByClassName('file-block')[0];
    const fileInput = document.getElementById('fileInput');
    const fakeFileInput = document.getElementById('fakeFileInput');
    const documentInput = document.getElementById('documentInput');

    fileBlock.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        fakeFileInput.value = fileInput.value;
        documentInput.value = '파일:' + fileInput.files[0].name;
        documentInput.dispatchEvent(new Event('input'));
    });
}, { once: true });