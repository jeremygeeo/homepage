const axios = require('axios');

const ASANA_PERSONAL_ACCESS_TOKEN = process.env.ASANA_PERSONAL_ACCESS_TOKEN;
const ASANA_WORKSPACE_ID = process.env.ASANA_WORKSPACE_ID;

if (!ASANA_PERSONAL_ACCESS_TOKEN) {
    console.warn('Asana integration is not configured. Please set ASANA_PERSONAL_ACCESS_TOKEN in your .env file.');
}

// Create a pre-configured axios instance for Asana API calls.
// This centralizes the authentication and base URL for all requests.
const asanaClient = axios.create({
    baseURL: 'https://app.asana.com/api/1.0',
    headers: {
        'Authorization': `Bearer ${ASANA_PERSONAL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
});

/**
 * Fetches tasks for a given Asana project.
 * For more fields, see the Asana API documentation for the `opt_fields` parameter.
 * @param {string} projectId The GID of the Asana project.
 * @returns {Promise<Array<object>>} A list of task objects.
 */
async function getTasksForProject(projectId) {
    if (!ASANA_PERSONAL_ACCESS_TOKEN) {
        console.error('Cannot fetch Asana tasks: ASANA_PERSONAL_ACCESS_TOKEN is not set.');
        return [];
    }

    try {
        // Example of fetching tasks with specific fields to keep the payload small.
        const response = await asanaClient.get(`/projects/${projectId}/tasks`, {
            params: {
                opt_fields: 'name,completed,due_on,assignee.name,permalink_url'
            }
        });
        return response.data.data; // The tasks are in the `data` property of the response
    } catch (error) {
        console.error(`Error fetching tasks for Asana project ${projectId}:`, error.response?.data || error.message);
        return [];
    }
}

/**
 * Fetches projects for a given Asana portfolio.
 * @param {string} portfolioId The GID of the Asana portfolio.
 * @returns {Promise<Array<object>>} A list of project objects.
 */
async function getProjectsForPortfolio(portfolioId) {
    if (!ASANA_PERSONAL_ACCESS_TOKEN) {
        console.error('Cannot fetch Asana projects: ASANA_PERSONAL_ACCESS_TOKEN is not set.');
        return [];
    }

    try {
        const response = await asanaClient.get(`/portfolios/${portfolioId}/items`, {
            params: {
                opt_fields: 'name,permalink_url,html_notes,current_status_update.status_type'
            }
        });
        // The API returns "items", which are the projects.
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching projects for Asana portfolio ${portfolioId}:`, error.response?.data || error.message);
        return [];
    }
}

/**
 * Fetches all milestone tasks for a given Asana project.
 * @param {string} projectId The GID of the Asana project.
 * @returns {Promise<Array<object>>} A list of milestone task objects.
 */
async function getMilestonesForProject(projectId) {
    if (!ASANA_PERSONAL_ACCESS_TOKEN) {
        console.error('Cannot fetch Asana milestones: ASANA_PERSONAL_ACCESS_TOKEN is not set.');
        return [];
    }

    try {
        const response = await asanaClient.get(`/projects/${projectId}/tasks`, {
            params: {
                // We fetch all tasks and filter for milestones on our side,
                // as the API doesn't support filtering by resource_subtype here.
                opt_fields: 'name,completed,due_on,permalink_url,resource_subtype,html_notes'
            }
        });

        // Filter the results to only include tasks that are milestones.
        const milestones = response.data.data.filter(task => task.resource_subtype === 'milestone');
        return milestones;
    } catch (error) {
        console.error(`Error fetching milestones for Asana project ${projectId}:`, error.response?.data || error.message);
        return [];
    }
}


module.exports = {
    getTasksForProject,
    getProjectsForPortfolio,
    getMilestonesForProject,
    ASANA_WORKSPACE_ID, // Exporting this can be useful
};