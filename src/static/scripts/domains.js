import { API_BASE_URL, fetchWithAuth } from '/static/main.js';

/**
 * Domain-related API helpers (no UI logic here)
 */

export async function purchaseDomain({ domainName, price, projectId, privacy, token, phoneNumber = null }) {
    if (!token) return { ok: false, status: 401, error: 'unauthorized' };

    try {
        const payload = {
            domain: domainName,
            price: price,
            project_id: projectId,
            privacy: privacy
        };
        // Expects phoneNumber to be an object: { countryCode, number }
        if (phoneNumber && phoneNumber.countryCode && phoneNumber.number) {
            payload.phone_country_code = phoneNumber.countryCode;
            payload.phone_number = phoneNumber.number;
        }

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


