// Import the central menu registry
import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { API_BASE_URL, fetchWithAuth } from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { openPopup } from '/static/scripts/popup.js';

async function _getUsageLogic(params) {
    const { renderMenu, updateStatusDisplay, menuContainer, menuTitle } = params;

    // --- Start: Show Loading GIF & Rainbow Text ---
    window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: true } }));
    updateStatusDisplay('fetching usage data...', 'info');
    document.body.classList.add('deployment-loading');

    if (menuContainer) {
        const listContainer = menuContainer.querySelector('#menu-list-container');
        if (listContainer) {
            listContainer.innerHTML = ''; // Clear the menu buttons
            const loadingGif = document.createElement('img');
            loadingGif.src = '/static/resources/happy-cat.gif';
            loadingGif.alt = 'Loading...';
            loadingGif.className = 'loading-gif';
            listContainer.appendChild(loadingGif);
        }
        if (menuTitle) {
            menuTitle.textContent = 'fetching usage';
            menuTitle.classList.add('rainbow-text');
        }
    }
    // --- End: Show Loading GIF & Rainbow Text ---

    const cleanupLoadingUI = () => {
        document.body.classList.remove('deployment-loading');
        window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: false } }));
        if (menuTitle) {
            menuTitle.classList.remove('rainbow-text');
        }
    };

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/usage`);
        if (!response.ok) {
            try {
                const errorData = await response.json();
                if (errorData && errorData.message) {
                    throw new Error(errorData.message);
                }
            } catch (e) {
                // Ignore JSON parsing errors and fall through
            }
            throw new Error(`Failed to fetch: ${response.status}`);
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
            menuTitleText = `usage for ${data.month_name}:`;
            
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