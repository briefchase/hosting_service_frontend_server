// Import the central menu registry
import { menus } from '/static/pages/menu.js';
import '/static/menus/site.js';

// Define Resources Menu as a static configuration
const resourceMenuConfig = {
    text: 'resources:',
    items: [
        { 
            id: 'list-sites-option', 
            text: 'sites', 
            action: 'listSites', 
            type: 'button',
            tooltip: 'manage and destroy deployed sites' 
        },
        { 
            id: 'list-machines-option',
            text: 'machines',
            action: 'listMachines',
            type: 'button',
            tooltip: 'view and ssh into virtual machines'
        },
        { 
            id: 'manage-domains-option', 
            text: 'domains', 
            action: 'listDomains', 
            type: 'button',
            tooltip: 'manage domains and dns records'
        },
        {
            id: 'manage-backups-option',
            text: 'backups',
            targetMenu: 'backup-menu',
            type: 'button',
            tooltip: 'schedule, create, and restore backups from your google drive'
        }
    ],
    backTarget: 'dashboard-menu'
};

// Register this static menu configuration.
menus['resource-menu'] = resourceMenuConfig; 