import { API_BASE_URL, fetchWithAuth } from '/static/main.js';

/**
 * Fetches all sites/deployments from the API.
 * The backend endpoint remains '/instances' for compatibility.
 * @param {object} options - Optional parameters, e.g., { include_schedule: true }.
 * @returns {Promise<Array>} - A promise that resolves to an array of sites.
 */
export async function fetchSites(options = {}) {
    let url = `${API_BASE_URL}/instances`;
    if (options.include_schedule) {
        url += '?include_schedule=true';
    }

    try {
        const response = await fetchWithAuth(url);
        if (!response.ok) {
            // Try to get more detailed error from response body
            const errorData = await response.json().catch(() => null);
            if (errorData && errorData.error) {
                throw new Error(errorData.error);
            }
            throw new Error(`Failed to fetch sites: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Error in fetchSites:", error);
        // Re-throw the error so the caller can handle it, e.g., to show a UI message
        throw error;
    }
}
