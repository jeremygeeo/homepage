/**
 * Converts an ISO 8601 date string into a human-readable "time ago" format.
 * @param {string} dateString - The ISO date string (e.g., "2025-09-26T15:49:50.333Z").
 * @returns {string} A formatted string like "5 minutes ago".
 */
function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.round((now - date) / 1000);

    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);
    const months = Math.round(days / 30.44); // Average days in a month
    const years = Math.round(days / 365.25); // Account for leap years

    if (seconds < 60) {
        return "just now";
    } else if (minutes < 60) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else if (hours < 24) {
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (days < 30) {
        return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (months < 12) {
        return `${months} month${months > 1 ? 's' : ''} ago`;
    } else {
        return `${years} year${years > 1 ? 's' : ''} ago`;
    }
}

module.exports = {
    formatTimeAgo,
};