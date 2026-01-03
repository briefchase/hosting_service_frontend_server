// Import the central menu registry
import { menus } from '/static/pages/menu.js';

// Define Main Menu Configuration
const mainMenuConfig = {
    text: 'console:',
    items: [
        { id: 'deploy-option', text: 'deploy', targetMenu: 'deploy-menu', type: 'button', tooltip: 'make a website' },
        { id: 'resources-option', text: 'resources', targetMenu: 'resource-menu', type: 'button', tooltip: 'view deployments and artifacts' },
        // { id: 'firewall-option', text: 'firewall', targetMenu: 'firewall-menu', type: 'button' },
        { id: 'usage-option', text: 'usage', action: 'getUsage', type: 'button', tooltip: 'check accumulated balance' }
    ]
};

// Register this menu configuration with the central registry
menus['dashboard-menu'] = mainMenuConfig;
