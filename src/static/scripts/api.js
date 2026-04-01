import { fetchWithAuth } from '/static/main.js';
import { CONFIG } from '/static/config.js';

const API_BASE_URL = CONFIG.API_BASE_URL;

/**
 * Fetches the combined state of all infrastructure (Compute and Firebase).
 * @param {object} options - Optional parameters, e.g., { include_schedule: true }.
 * @returns {Promise<Object>} - A promise that resolves to an object { compute: Array, firebase: Array }.
 */
export async function fetchState(options = {}) {
    let url = `${API_BASE_URL}/instances`;
    if (options.include_schedule) {
        url += '?include_schedule=true';
    }

    try {
        const response = await fetchWithAuth(url);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const customError = new Error(data.message || `HTTP error ${response.status}`);
            customError.id = data.error;
            customError.status = response.status;
            throw customError;
        }
        return data;
    } catch (error) {
        console.error("Error in fetchState:", error);
        throw error;
    }
}

/**
 * Fetches only the managed VMs (Compute).
 * @param {object} options - Optional parameters, e.g., { include_schedule: true }.
 * @returns {Promise<Array>} - A promise that resolves to an array of machines.
 */
export async function fetchMachines(options = {}) {
    let url = `${API_BASE_URL}/machines`;
    if (options.include_schedule) {
        url += '?include_schedule=true';
    }

    try {
        const response = await fetchWithAuth(url);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const customError = new Error(data.message || `HTTP error ${response.status}`);
            customError.id = data.error;
            customError.status = response.status;
            throw customError;
        }
        return data;
    } catch (error) {
        console.error("Error in fetchMachines:", error);
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
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/check-availability`, {
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

export async function fetchDomainRecords(domainName) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/${domainName}/records`);
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

export async function fetchDomainDetails(domainName) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/${domainName}`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ 
                message: `HTTP error ${response.status}: ${response.statusText}` 
            }));
            throw new Error(errorData.message || 'An unknown error occurred');
        }
        return await response.json();
    } catch (error) {
        console.error("Error in fetchDomainDetails:", error);
        throw error;
    }
}


export async function relinkDomain({ domainName, deployment_name, machine_id, isExternal, isUnlink }) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/relink`, {
            method: 'POST',
            body: {
                domainName,
                deployment_name,
                machine_id,
                isExternal: !!isExternal,
                isUnlink: !!isUnlink
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

export async function transferOutDomain({ domainName, action }) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/transfer-out`, {
            method: 'POST',
            body: { domainName, action }
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return { ok: true, result: body };
        return { ok: false, error: body.error || 'Failed to transfer out' };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

export async function toggleDomainRenewal({ domainName, enable }) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/toggle-renewal`, {
            method: 'POST',
            body: { domainName, enable }
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return { ok: true, result: body };
        return { ok: false, error: body.error || 'Failed to toggle renewal' };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

export async function transferInDomain({ domainName, authCode }) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/transfer-in`, {
            method: 'POST',
            body: { domainName, authCode }
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return { ok: true, result: body };
        return { ok: false, error: body.error || 'Failed to transfer in' };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

export async function addDomainRecord({ domainName, type, name, content, ttl }) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/add-record`, {
            method: 'POST',
            body: { domainName, type, name, content, ttl }
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return { ok: true, result: body };
        return { ok: false, error: body.error || 'Failed to add record' };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

export async function updateDomainRecord({ domainName, recordId, type, name, content, ttl }) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/update-record`, {
            method: 'POST',
            body: { domainName, recordId, type, name, content, ttl }
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return { ok: true, result: body };
        return { ok: false, error: body.error || 'Failed to update record' };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

export async function deleteDomainRecord({ domainName, recordId }) {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/domains/delete-record`, {
            method: 'POST',
            body: { domainName, recordId }
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return { ok: true, result: body };
        return { ok: false, error: body.error || 'Failed to delete record' };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

