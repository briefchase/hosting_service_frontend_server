// Import the central menu registry
import { menus } from '/static/pages/menu.js';

// Define Backup Menu Configuration
const backupMenuConfig = {
    text: 'backup:',
    items: [
        { id: 'create-backup-option', text: 'create', targetMenu: 'create-backup-menu', type: 'button' },
        { id: 'restore-backup-option', text: 'restore', targetMenu: 'restore-backup-menu', type: 'button' },
        { id: 'schedule-backup-option', text: 'schedule', targetMenu: 'schedule-backup-menu', type: 'button' }
        // { id: 'restore-backup-option', text: 'restore from backup', type: 'button', action: 'restoreBackup' },
        // { id: 'configure-backup-option', text: 'configure schedule', type: 'button', action: 'configureBackup' },
    ],
    backTarget: 'dashboard-menu'
};

// Register this menu configuration
menus['backup-menu'] = backupMenuConfig; 