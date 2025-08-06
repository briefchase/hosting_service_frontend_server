// Import the central menu registry
import { menus } from '/static/pages/menu.js';

// Define Main Menu Configuration
const mainMenuConfig = {
    text: 'console:',
    items: [
        { id: 'deploy-option', text: 'deploy', targetMenu: 'deploy-menu', type: 'button' },
        { id: 'resources-option', text: 'resources', targetMenu: 'resource-menu', type: 'button' },
        // { id: 'firewall-option', text: 'firewall', targetMenu: 'firewall-menu', type: 'button' },
        // { id: 'backup-option', text: 'backup', targetMenu: 'backup-menu', type: 'button' },
        { id: 'usage-option', text: 'usage', action: 'listBillingAccounts', type: 'button' }
    ]
};

// Register this menu configuration with the central registry
menus['dashboard-menu'] = mainMenuConfig;
