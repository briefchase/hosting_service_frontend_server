// Import the central menu registry
import { menus } from '/static/pages/menu.js';

// Define Firewall Menu Configuration
const firewallMenuConfig = {
    text: 'firewall:',
    items: [
        // Add specific firewall-related buttons or actions here
        { id: 'firewall-holes-option', text: 'holes', type: 'button' /* Add targetMenu or action if needed */ },
        { id: 'add-rule-option', text: 'add rule', type: 'button', action: 'addFirewallRule' },
        { id: 'view-rules-option', text: 'view rules', type: 'button', action: 'viewFirewallRules' },
    ],
    backTarget: 'dashboard-menu' // Allows navigation back to the main menu
};

// Register this menu configuration
menus['firewall-menu'] = firewallMenuConfig; 