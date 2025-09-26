document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.getElementById('nav-links');
    const hamburger = document.querySelector('.hamburger');

    // Recursively creates navigation items and dropdowns
    function createNavItem(item, level = 0) {
        const li = document.createElement('li');
        li.className = 'nav-item';

        const a = document.createElement('a');
        a.href = item.path;
        a.textContent = item.name;
        li.appendChild(a);

        // Only create dropdowns if there are children and we are within the depth limit (level < 2 means we are creating for level 0 and 1 items)
        if (item.children && item.children.length > 0 && level < 2) {
            li.classList.add('has-dropdown');

            // Add a dropdown indicator for items with children
            const arrow = document.createElement('span');
            arrow.className = 'dropdown-arrow';
            a.appendChild(arrow);

            const dropdown = document.createElement('ul');
            dropdown.className = 'dropdown';
            item.children.forEach(child => {
                dropdown.appendChild(createNavItem(child, level + 1));
            });
            li.appendChild(dropdown);

            // Toggle dropdown on arrow click
            arrow.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent the link from navigating
                e.stopPropagation(); // Stop the event from bubbling up to the document

                const wasOpen = li.classList.contains('open');

                // Close all other open dropdowns at the same level
                document.querySelectorAll('.nav-item.open').forEach(openItem => {
                    if (openItem !== li) {
                        openItem.classList.remove('open');
                    }
                });

                // Toggle the current dropdown
                li.classList.toggle('open');
            });
        }
        return li;
    }

    fetch('/api/nav')
        .then(res => res.json())
        .then(navData => {
            if (!navLinks) return; // Exit if the nav element doesn't exist
            navData.forEach(item => {
                navLinks.appendChild(createNavItem(item));
            });
        });

    // Toggle mobile navigation
    hamburger.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });

    // Close dropdowns if user clicks outside of them
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.has-dropdown')) {
            document.querySelectorAll('.nav-item.open').forEach(item => {
                item.classList.remove('open');
            });
        }
    });
});