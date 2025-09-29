import { API_BASE_URL } from '/static/main.js';

// Opens a popup to Google's Cloud Console welcome page for ToS acceptance,
// then polls the backend /tos-status to detect acceptance and auto-close.
export async function ensureGcpTosAccepted({ statusEl, pollIntervalMs = 2500, maxWaitMs = 180000 } = {}) {
    try {
        // First, quick server-side check to avoid opening popup if already accepted
        const pre = await fetch(`${API_BASE_URL}/tos-status`, { headers: buildAuthHeaders() });
        const preData = await pre.json().catch(() => ({}));
        if (pre.ok && preData && preData.accepted) return true;

        const url = 'https://console.cloud.google.com/welcome';
        const popup = window.open(url, 'gcp_tos_popup', 'width=480,height=640');
        if (!popup) {
            if (statusEl) statusEl.textContent = 'Please allow popups to accept Google Cloud Terms.';
            return false;
        }
        if (statusEl) statusEl.textContent = 'Please accept Google Cloud Terms in the popup…';

        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
            // If user closes the popup early, continue polling; they may have accepted in an existing tab
            await sleep(pollIntervalMs);
            const resp = await fetch(`${API_BASE_URL}/tos-status`, { headers: buildAuthHeaders() });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok && data && data.accepted) {
                try { popup.close(); } catch(_) {}
                if (statusEl) statusEl.textContent = '';
                return true;
            }
            // Handle insufficient scopes early to avoid confusing UX
            if (data && data.reason === 'insufficient_scopes') {
                if (statusEl) statusEl.textContent = 'Your Google permissions are insufficient. Please re-authenticate.';
                try { popup.close(); } catch(_) {}
                return false;
            }
        }
        try { popup.close(); } catch(_) {}
        if (statusEl) statusEl.textContent = 'Timed out waiting for Terms acceptance.';
        return false;
    } catch (e) {
        if (statusEl) statusEl.textContent = 'Could not verify Terms acceptance. Please try again.';
        return false;
    }
}

function buildAuthHeaders() {
    try {
        const s = sessionStorage.getItem('currentUser');
        if (!s) return {};
        const u = JSON.parse(s);
        if (u && u.token) return { Authorization: `Bearer ${u.token}` };
        return {};
    } catch (_) { return {}; }
}

function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}


