// Import the central menu registry
import { menus, renderMenu, updateStatusDisplay } from '/js/pages/menu.js';
import { registerHandler } from '../scripts/registry.js';
import { fetchWithAuth } from '/js/main.js';
import { CONFIG } from '/js/config.js';
const API_BASE_URL = CONFIG.API_BASE_URL;
import { requireAuthAndSubscription } from '/js/scripts/authenticate.js';
import { openPopup } from '/js/scripts/popup.js';

async function _getUsageLogic(params) {
    const { renderMenu, updateStatusDisplay, menuContainer, menuTitle } = params;

    updateStatusDisplay('fetching usage data...', 'info');

    const cleanupLoadingUI = () => {
        // This function is now a no-op but is kept to avoid breaking existing call sites.
        // The generic loading UI is handled by menu.js.
    };

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/usage`);
        if (!response.ok) {
            let errorToThrow;
            try {
                const errorData = await response.json();
                if (errorData && errorData.error === 'project_not_initialized') {
                    // Create a custom error that menu.js can identify
                    errorToThrow = new Error(errorData.message || 'Project not initialized.');
                    errorToThrow.id = 'project_not_initialized';
                } else if (errorData && errorData.message) {
                    errorToThrow = new Error(errorData.message);
                } else {
                    errorToThrow = new Error(`Failed to fetch: ${response.status}`);
                }
            } catch (e) {
                errorToThrow = new Error(`Failed to fetch: ${response.status}`);
            }
            throw errorToThrow;
        }
        const data = await response.json();

        cleanupLoadingUI();

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
        let menuTitleText = 'current monthly usage:'; // Renamed

        if (data.message) {
            usageItems = [{
                id: 'usage-message',
                text: data.message,
                type: 'record'
            }];
        } else if (data.month_name) {
            menuTitleText = `usage for ${data.month_name.toLowerCase()}:`;
            
            let gcpCostDisplay = data.gcp_cost < 0
                ? `$${(-data.gcp_cost).toFixed(2)} (free)`
                : `$${data.gcp_cost.toFixed(2)}`;
            
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
            text: menuTitleText,
            items: usageItems,
            backTarget: 'dashboard-menu'
        };
        menus['usage-menu'] = finalConfig;
        renderMenu('usage-menu');

    } catch (error) {
        // If it's our special error, re-throw it so the main menu handler can catch it.
        if (error.id === 'project_not_initialized') {
            throw error;
        }
        
        // For all other errors, handle them locally.
        cleanupLoadingUI();
        renderMenu({
            id: 'usage-menu',
            text: 'error',
            items: [{ text: `could not load usage: ${error.message}`, type: 'record' }],
            backTarget: 'dashboard-menu'
        });
    }
}

export const getUsage = requireAuthAndSubscription(_getUsageLogic, 'view usage');

// Register handlers with the central registry
registerHandler('getUsage', getUsage);
 