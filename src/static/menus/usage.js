// Import the central menu registry
import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { API_BASE_URL, fetchWithAuth } from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';

async function _listBillingAccountsLogic(params) {
    const { renderMenu } = params;
    
    renderMenu({
        id: 'usage-menu',
        text: 'loading...',
        items: [{ text: 'fetching billing accounts...', type: 'record' }],
        backTarget: 'dashboard-menu'
    });

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/billing_accounts`);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status}`);
        }
        const accounts = await response.json();
        
        const accountItems = accounts.map(accountName => ({
            id: `billing-account-${accountName.replace(/\s+/g, '-')}`, // generate a safe id
            text: accountName,
            type: 'record' // Just a list as requested.
        }));

        const finalConfig = {
            id: 'usage-menu',
            text: 'billing accounts:',
            items: accountItems.length > 0 ? accountItems : [{ id: 'no-billing-accounts', text: 'no linked accounts found', type: 'record' }],
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

export const listBillingAccounts = requireAuthAndSubscription(_listBillingAccountsLogic, 'view usage'); 