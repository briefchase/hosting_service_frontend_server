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
            // The response is not ok, so it's an error. We expect a JSON body.
            const errorData = await response.json().catch(() => ({ 
                message: `HTTP error ${response.status}: ${response.statusText}` 
            }));

            // Create a new Error object that includes the structured data.
            const customError = new Error(errorData.message || 'An unknown error occurred');
            customError.id = errorData.error; // e.g., 'project_not_initialized'
            customError.status = response.status;
            throw customError; // Throw the structured error.
        }
        // If the response is OK, parse and return the JSON.
        return await response.json();
    } catch (error) {
        console.error("Error in fetchSites:", error);
        // Re-throw the error so the caller can handle it.
        // This will be either the customError from above or a network error.
        throw error;
    }
}


export async function purchaseDomain({ domainName, price, token, offSession = false }) {
    if (!token) return { ok: false, status: 401, error: 'unauthorized' };

    try {
        const payload = {
            domain: domainName,
            price: price,
            off_session: offSession
        };

        const response = await fetchWithAuth(`${API_BASE_URL}/domains`, {
            method: 'POST',
            body: payload
        });

        const contentType = response.headers.get('content-type') || '';
        const body = contentType.includes('application/json')
            ? await response.json().catch(() => ({}))
            : await response.text().catch(() => '');

        if (response.ok) {
            return { ok: true, result: body };
        }

        return {
            ok: false,
            status: response.status,
            error: (body && body.error) || `Server returned ${response.status}`,
            data: body
        };
    } catch (error) {
        return { ok: false, status: 0, error: error.message };
    }
}

export async function checkDomainAvailability({ domainName, token }) {
    if (!token) return { ok: false, status: 401, error: 'unauthorized' };
    if (!domainName) return { ok: false, status: 400, error: 'domain_required' };

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/check-domain-availability`, {
            method: 'POST',
            body: { domain: domainName }
        });

        const contentType = response.headers.get('content-type') || '';
        const body = contentType.includes('application/json')
            ? await response.json().catch(() => ({}))
            : await response.text().catch(() => '');

        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                error: (body && body.error) || `Server returned ${response.status}`,
                data: body
            };
        }

        return { ok: true, result: body };
    } catch (error) {
        return { ok: false, status: 0, error: error.message };
    }
}

export async function fetchDomainRecords(domainName, isManaged) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/${domainName}/records?isManaged=${isManaged}`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ 
                message: `HTTP error ${response.status}: ${response.statusText}` 
            }));
            throw new Error(errorData.message || 'An unknown error occurred');
        }
        return await response.json();
    } catch (error) {
        console.error("Error in fetchDomainRecords:", error);
        throw error;
    }
}


export async function relinkDomain({ domainName, deployment_name, machine_id }) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/relink-domain`, {
            method: 'POST',
            body: {
                domainName,
                deployment_name,
                machine_id
            }
        });

        const body = await response.json().catch(() => ({}));

        if (response.ok) {
            return { ok: true, result: body };
        }

        return {
            ok: false,
            status: response.status,
            error: body.error || `Server returned ${response.status}`
        };
    } catch (error) {
        return { ok: false, status: 0, error: error.message };
    }
}

