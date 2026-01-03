// Import the central menu registry
import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { API_BASE_URL, fetchWithAuth } from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { openPopup } from '/static/scripts/popup.js';

async function _getUsageLogic(params) {
    const { renderMenu } = params;
    
    renderMenu({
        id: 'usage-menu',
        text: 'loading...',
        items: [{ text: 'fetching usage data...', type: 'record' }],
        backTarget: 'dashboard-menu'
    });

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/usage`);
        if (!response.ok) {
            // Try to parse the error response for a custom message
            try {
                const errorData = await response.json();
                if (errorData && errorData.message) {
                    throw new Error(errorData.message);
                }
            } catch (e) {
                // Ignore JSON parsing errors and fall through to the generic error
            }
            throw new Error(`Failed to fetch: ${response.status}`);
        }
        const data = await response.json();

        if (data.url) {
            const features = 'toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=900,height=720';
            const popup = openPopup(data.url, 'usage_popup', features);
            if (!popup) {
                renderMenu({
                    id: 'usage-popup-blocked-menu',
                    text: 'popup blocked',
                    items: [{ text: 'please enable popups to view usage', type: 'record' }],
                    backTarget: 'dashboard-menu'
                });
            } else {
                renderMenu('dashboard-menu');
            }
            return;
        }
        
        let usageItems;
        let menuTitle = 'current monthly usage:';

        if (data.message) {
            usageItems = [{
                id: 'usage-message',
                text: data.message,
                type: 'record'
            }];
        } else if (data.month_name) {
            menuTitle = `usage for ${data.month_name}:`;
            
            let gcpCostDisplay;
            if (data.gcp_cost < 0) {
                gcpCostDisplay = `$${(-data.gcp_cost).toFixed(2)} (free)`;
            } else {
                gcpCostDisplay = `$${data.gcp_cost.toFixed(2)}`;
            }
            
            usageItems = [
                { id: 'servercult-cost', text: `servercult cost: $${data.servercult_cost.toFixed(2)}`, type: 'record' },
                { id: 'gcp-cost', text: `google server cost: ${gcpCostDisplay}`, type: 'record' },
            ];
        } else {
            usageItems = [{
                id: 'usage-unavailable',
                text: 'Usage data not available.',
                type: 'record'
            }];
        }

        const finalConfig = {
            id: 'usage-menu',
            text: menuTitle,
            items: usageItems,
            backTarget: 'dashboard-menu'
        };
        menus['usage-menu'] = finalConfig;
        renderMenu('usage-menu');

    } catch (error) {
        renderMenu({
            id: 'usage-menu',
            text: 'error',
            items: [{ text: `could not load usage: ${error.message}`, type: 'record' }],
            backTarget: 'dashboard-menu'
        });
    }
}

export const getUsage = requireAuthAndSubscription(_getUsageLogic, 'view usage'); 