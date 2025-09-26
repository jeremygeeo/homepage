document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.getElementById('nav-links');
    const hamburger = document.querySelector('.hamburger');

    // Recursively creates navigation items and dropdowns
    function createNavItem(item) {
        const li = document.createElement('li');
        li.className = 'nav-item';
        const a = document.createElement('a');
        a.href = item.path;
        a.textContent = item.name;
        li.appendChild(a);

        if (item.children && item.children.length > 0) {
            // Add a dropdown indicator for items with children
            a.innerHTML += ' <span class="dropdown-arrow">▼</span>';

            const dropdown = document.createElement('ul');
            dropdown.className = 'dropdown';
            item.children.forEach(child => {
                dropdown.appendChild(createNavItem(child));
            });
            li.appendChild(dropdown);

            // On mobile, toggle dropdown on click
            a.addEventListener('click', (e) => {
                if (window.innerWidth <= 768) {
                    e.preventDefault(); // Prevent navigation
                    li.classList.toggle('open');
                }
            });

        }
        return li;
    }

    fetch('/api/nav')
        .then(res => res.json())
        .then(navData => {
            navData.forEach(item => {
                navLinks.appendChild(createNavItem(item));
            });
        });

    // Toggle mobile navigation
    hamburger.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });
});