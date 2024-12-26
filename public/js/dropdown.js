document.addEventListener('thetree:pageLoad', () => {
    const dropdowns = document.getElementsByClassName('thetree-searchable-dropdown');
    for(let dropdown of dropdowns) {
        const dropdownProps = dropdown._thetree.dropdown;

        if(dropdownProps.initialized) continue;

        const clearButton = dropdown.getElementsByClassName('searchable-dropdown-clear')[0];
        const dropdownList = dropdown.getElementsByClassName('searchable-dropdown-menu')[0];
        const searchInput = dropdown.getElementsByClassName('searchable-dropdown-search')[0];
        const valueText = dropdown.getElementsByClassName('searchable-dropdown-selected')[0];
        const options = dropdownList.getElementsByClassName('searchable-dropdown-option');
        const valueInput = dropdown.getElementsByClassName('searchable-dropdown-value')[0];

        dropdownProps.open = () => {
            if(dropdown.classList.contains('searchable-dropdown-open')) return;

            dropdown.classList.add('searchable-dropdown-open');
            clearButton.style.display = 'none';
            dropdownList.style = '';

            dropdownProps.filter('');
        }

        dropdownProps.close = () => {
            if(!dropdown.classList.contains('searchable-dropdown-open')) return;

            dropdown.classList.remove('searchable-dropdown-open');
            dropdown.classList.remove('searchable-dropdown-searching');

            searchInput.value = '';

            clearButton.style.display = valueInput.value ? '' : 'none';
            dropdownList.style.display = 'none';
            dropdownList.style.visibility = 'hidden';

            searchInput.blur();
        }

        dropdownProps.filter = value => {
            value = value.toLowerCase();
            if(!value) {
                dropdown.classList.remove('searchable-dropdown-searching');
                for(let option of options) {
                    option.classList.remove('searchable-dropdown-option-highlight');
                    option.style.display = '';
                }
                return;
            }

            dropdown.classList.add('searchable-dropdown-searching');

            for(let option of options) {
                option.classList.remove('searchable-dropdown-option-highlight');
                const text = option.textContent.toLowerCase();
                option.style.display = text.includes(value) ? '' : 'none';
            }
        }

        const setValue = () => {
            const currOption = dropdownList.getElementsByClassName('searchable-dropdown-option-highlight')[0];
            if(!currOption) {
                valueText.style.display = 'none';
                valueInput.value = '';
                searchInput.placeholder = '선택';
                clearButton.style.display = 'none';

                dropdownProps.close();
                return;
            }

            valueText.textContent = currOption.textContent;
            valueText.style.display = '';
            valueInput.value = currOption.textContent;
            searchInput.placeholder = '';

            currOption.classList.remove('searchable-dropdown-option-highlight');

            dropdownProps.close();
        }

        dropdown.addEventListener('click', () => searchInput.focus());
        searchInput.addEventListener('focus', dropdownProps.open);
        searchInput.addEventListener('focusout', () => {
            if(!dropdown.matches(':hover')) dropdownProps.close();
        });

        searchInput.addEventListener('input', () => dropdownProps.filter(searchInput.value));

        searchInput.addEventListener('keydown', e => {
            const isUp = e.key === 'ArrowUp';
            const isDown = e.key === 'ArrowDown';
            const isEnter = e.key === 'Enter';
            if(!isUp && !isDown && !isEnter) return;

            const currOption = dropdownList.getElementsByClassName('searchable-dropdown-option-highlight')[0];
            if(!currOption && !isDown) return;

            e.preventDefault();

            if(isUp) {
                let newOption = currOption;
                do {
                    newOption = newOption.previousElementSibling;
                } while(newOption && newOption.style.display === 'none');

                if(!newOption) return;

                currOption.classList.remove('searchable-dropdown-option-highlight');
                newOption.classList.add('searchable-dropdown-option-highlight');

                newOption.scrollIntoView({ block: 'nearest' });
            }

            else if(isDown) {
                let newOption = currOption;
                if(currOption) {
                    do {
                        newOption = newOption.nextElementSibling;
                    } while(newOption && newOption.style.display === 'none');
                }
                else for(let option of options) if(option.style.display !== 'none') {
                    newOption = option;
                    break;
                }

                if(!newOption) return;

                currOption?.classList.remove('searchable-dropdown-option-highlight');
                newOption.classList.add('searchable-dropdown-option-highlight');

                newOption.scrollIntoView({ block: 'nearest' });
            }

            else if(isEnter) {
                setValue();
            }
        });

        clearButton.addEventListener('click', e => {
            e.stopPropagation();
            setValue();
        });

        for(let option of options) {
            option.addEventListener('mouseover', () => {
                const oldOption = dropdownList.getElementsByClassName('searchable-dropdown-option-highlight')[0];
                if(oldOption) oldOption.classList.remove('searchable-dropdown-option-highlight');
                option.classList.add('searchable-dropdown-option-highlight');
            });

            option.addEventListener('click', e => {
                e.stopPropagation();
                setValue();
            });
        }

        dropdownProps.initialized = true;
    }
});