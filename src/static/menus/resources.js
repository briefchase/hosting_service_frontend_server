// Import the central menu registry
import { menus } from '/static/pages/menu.js';

// Define Resources Menu as a static configuration
const resourceMenuConfig = {
    text: 'resources:',
    items: [
        { 
            id: 'list-instances-option', 
            text: 'instances', 
            action: 'listInstances', 
            type: 'button' 
        },
        { 
            id: 'manage-domains-option', 
            text: 'domains', 
            action: 'listDomains', 
            type: 'button' 
        }
    ],
    backTarget: 'dashboard-menu'
};

// Register this static menu configuration.
menus['resource-menu'] = resourceMenuConfig; 