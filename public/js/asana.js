document.addEventListener('DOMContentLoaded', () => {
    const projectsContainer = document.getElementById('asana-projects-container');

    if (!projectsContainer) {
        return;
    }

    // Read the portfolio ID from the data attribute on the container element.
    const portfolioId = projectsContainer.dataset.portfolioId;

    if (!portfolioId || portfolioId === 'YOUR_PORTFOLIO_GID_HERE') {
        projectsContainer.innerHTML = '<p style="color: red;">Error: Asana Portfolio ID is not configured in the template. Please set the `data-portfolio-id` attribute.</p>';
        return;
    }
    /**
     * Fetches projects from the local API and displays them.
     */
    async function fetchAndDisplayProjects() {
        try {
            const response = await fetch(`/api/asana/portfolios/${portfolioId}/projects`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch projects.');
            }
            const projects = await response.json();

            if (projects.length === 0) {
                projectsContainer.innerHTML = '<p>No projects found in this portfolio.</p>';
                return;
            }

            // Clear the "Loading..." message
            projectsContainer.innerHTML = '';

            const ul = document.createElement('ul');
            ul.className = 'asana-project-list';

            projects.forEach(project => {
                const li = document.createElement('li');
                li.className = 'asana-project-item';

                const statusType = project.current_status_update?.status_type || 'not_set';

                // Use the pre-formatted html_notes from Asana if it exists.
                const projectDescriptionHtml = project.html_notes
                    ? `<div class="project-description">${project.html_notes}</div>`
                    : '';

                li.innerHTML = `
                    <div class="project-status-indicator status-${statusType.replace(/_/g, '-')}"></div>
                    <div class="project-content">
                        <a href="${project.permalink_url}" target="_blank" rel="noopener noreferrer" class="project-name">${project.name}</a>
                        ${projectDescriptionHtml}
                    </div>
                `;

                // If there are milestones, create and append a list for them
                if (project.milestones && project.milestones.length > 0) {
                    const milestonesContainer = document.createElement('div');
                    milestonesContainer.className = 'milestones-container';

                    const milestonesList = document.createElement('ul');
                    milestonesList.className = 'milestone-list';

                    project.milestones.forEach(milestone => {
                        const milestoneItem = document.createElement('li');
                        // Add 'completed' class if the milestone is completed
                        milestoneItem.className = `milestone-item ${milestone.completed ? 'completed' : ''}`;

                        // Format the date, or show a placeholder if it's null
                        let dateHtml = '<span class="milestone-date no-date">No Date</span>';
                        if (milestone.due_on) {
                            const currentYear = new Date().getFullYear();
                            // Create a date object in UTC to avoid timezone issues
                            const date = new Date(`${milestone.due_on}T00:00:00Z`);
                            const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
                            const milestoneYear = date.getUTCFullYear();

                            let yearHtml = '';
                            // Only show the year if it's a future year
                            if (milestoneYear > currentYear) {
                                yearHtml = `<span class="milestone-year">${milestoneYear}</span>`;
                            }
                            dateHtml = `<div class="milestone-date"><span class="milestone-month-day">${monthDay}</span>${yearHtml}</div>`;
                        }

                        // Add a placeholder for the status icon
                        const statusIconHtml = '<span class="milestone-status-icon"></span>';

                        // Use the pre-formatted html_notes for the milestone description.
                        const milestoneDescriptionHtml = milestone.html_notes
                            ? `<div class="milestone-description">${milestone.html_notes}</div>`
                            : '';

                        milestoneItem.innerHTML = `<div class="milestone-title">${statusIconHtml}${dateHtml} <a href="${milestone.permalink_url}" target="_blank" rel="noopener noreferrer">${milestone.name}</a></div>${milestoneDescriptionHtml}`;
                        milestonesList.appendChild(milestoneItem);
                    });

                    milestonesContainer.appendChild(milestonesList);
                    li.querySelector('.project-content').appendChild(milestonesContainer);
                }
                ul.appendChild(li);
            });

            projectsContainer.appendChild(ul);

        } catch (error) {
            console.error('Error fetching or displaying Asana projects:', error);
            projectsContainer.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
        }
    }

    fetchAndDisplayProjects();
});