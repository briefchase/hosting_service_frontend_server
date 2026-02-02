import { menus } from '/static/pages/menu.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { 
    fetchWithAuth, 
    API_BASE_URL,
    loadConsoleView,
    updateBackButtonHandler,
    unregisterBackButtonHandler,
    updateAccountButtonVisibility,
    updateSiteTitleVisibility,
    returnFromTerminal
} from '/static/main.js';
import { fetchSites } from '/static/scripts/utilities.js';
import { prompt, cancelCurrentPrompt } from '/static/pages/prompt.js';
import { establishWebSocketConnection } from '/static/scripts/socket.js';


let lastFetchedDeployments = [];
let activeRestore = {
    ws: null,
    deploymentId: null
};

/**
 * A centralized function to cancel the active restore, clean up UI,
 * and return the user to the backup menu.
 * @param {string} reason - The reason for the cancellation.
 * @param {string} [statusMessage] - An optional message to display after cancellation.
 */
function _cancelActiveRestore(reason, statusMessage) {
    console.log(`[RESTORE CANCELLATION] Reason: ${reason}. Deployment ID: ${activeRestore.deploymentId}`);
    document.body.classList.remove('deployment-loading');
    
    const { ws, deploymentId } = activeRestore;

    if (ws && ws.readyState < WebSocket.CLOSING) {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    action: "cancel_deployment", // The backend uses the same cancel action
                    deployment_id: deploymentId,
                    reason: reason
                }));
            }
            ws.close();
        } catch (e) {
            console.warn('Error during WebSocket cleanup:', e);
        }
    }

    unregisterBackButtonHandler();
    cancelCurrentPrompt();
    
    const params = { 
        menuId: 'backup-menu', 
        output: statusMessage || 'Restore cancelled.', 
        type: 'info' 
    };
    
    // If the terminal is active, we need to exit it cleanly first
    if (document.body.classList.contains('terminal-view-active')) {
        returnFromTerminal(params);
    } else {
        loadConsoleView(params);
    }
    
    activeRestore.ws = null;
    activeRestore.deploymentId = null;
}


// --- UNWRAPPED ACTIONS ---

const _listDeploymentsForBackup = async ({ renderMenu, updateStatusDisplay }) => {
    try {
        updateStatusDisplay('fetching deployments...', 'info');
        const deploymentsData = await fetchSites();
        let deployments = [];
        let emptyMessage = 'No deployments found.';

        if (Array.isArray(deploymentsData)) {
            if (deploymentsData.length === 1 && deploymentsData[0].id === 'no-deployments') {
                emptyMessage = deploymentsData[0].name;
            } else {
                deployments = deploymentsData.filter(item => item.id !== 'no-deployments');
            }
        } else {
            console.warn("API response for /instances was not an array:", deploymentsData);
        }

        lastFetchedDeployments = deployments;

        if (deployments.length === 0) {
            const noDeploymentsMenu = {
                id: 'no-deployments-for-backup',
                text: emptyMessage,
                items: [],
                backTarget: 'backup-menu'
            };
            renderMenu(noDeploymentsMenu);
            return;
        }

        const menuItems = deployments.map(deployment => ({
            id: `backup-${deployment.id}`,
            text: deployment.name,
            type: 'record',
            action: 'createScriptBackup',
            resourceId: deployment.id
        }));

        const deploymentsMenu = {
            id: 'select-deployment-for-backup',
            text: 'select a deployment to back up:',
            items: menuItems,
            backTarget: 'backup-menu'
        };

        renderMenu(deploymentsMenu);

    } catch (error) {
        console.error("Error listing deployments for backup:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
};

const _createScriptBackup = async ({ resourceId, renderMenu, updateStatusDisplay }) => {
    const deployment = lastFetchedDeployments.find(d => d.id === resourceId);
    if (!deployment) {
        const errorMsg = `Could not find deployment with ID: ${resourceId}`;
        console.error(errorMsg);
        updateStatusDisplay(errorMsg, 'error');
        return;
    }

    try {
        updateStatusDisplay(`creating backup for ${deployment.name}...`, 'info');
        
        const backupPayload = {
            deployment: deployment.deployment,
            project_id: deployment.project_id,
        };

        const response = await fetchWithAuth(`${API_BASE_URL}/create`, {
            method: 'POST',
            body: backupPayload
        });

        const result = await response.json();

        if (response.ok) {
            updateStatusDisplay(result.message, 'success');
        } else {
            throw new Error(result.error || 'Failed to create backup');
        }
    } catch (error) {
        console.error("Error creating backup:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
};

const _showRestoreMenu = async ({ renderMenu, updateStatusDisplay }) => {
    try {
        updateStatusDisplay('fetching backups...', 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/list-backups`);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to fetch backups.');
        }

        if (!result.backups || result.backups.length === 0) {
            renderMenu({
                id: 'no-backups-found',
                text: 'No backups found in Google Drive.',
                items: [],
                backTarget: 'backup-menu'
            });
            return;
        }

        const menuItems = result.backups.map(backup => ({
            id: `backup-file-${backup.id}`,
            text: backup.name,
            type: 'record',
            action: 'selectDeploymentForRestore',
            backupFilename: backup.name, // Pass the filename for display purposes
            backupFileId: backup.id      // Pass the file ID for backend operations
        }));
        
        renderMenu({
            id: 'select-backup-for-restore',
            text: 'select a backup to restore:',
            items: menuItems,
            backTarget: 'backup-menu'
        });

    } catch (error) {
        console.error("Error listing backups for restore:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
};

const _selectDeploymentForRestore = async (params) => {
    const { backupFilename, backupFileId, renderMenu, updateStatusDisplay } = params;
    if (!backupFilename) {
        updateStatusDisplay('Error: No backup file was selected.', 'error');
        return;
    }

    try {
        updateStatusDisplay('fetching deployments...', 'info');
        const deploymentsData = await fetchSites();
        let deployments = [];
        let emptyMessage = 'No deployments found to restore to.';

        if (Array.isArray(deploymentsData)) {
            if (deploymentsData.length === 1 && deploymentsData[0].id === 'no-deployments') {
                emptyMessage = deploymentsData[0].name;
            } else {
                deployments = deploymentsData.filter(item => item.id !== 'no-deployments');
            }
        }

        lastFetchedDeployments = deployments;
        updateStatusDisplay('', 'info');

        if (deployments.length === 0) {
            renderMenu({
                id: 'no-deployments-for-restore',
                text: emptyMessage,
                items: [],
                backTarget: 'backup-menu' // Or maybe 'select-backup-for-restore'?
            });
            return;
        }

        const menuItems = deployments.map(deployment => ({
            id: `restore-${deployment.id}`,
            text: deployment.name,
            type: 'record',
            action: 'confirmRestore',
            resourceId: deployment.id,
            backupFilename: backupFilename, // Carry filename over
            backupFileId: backupFileId      // Carry file ID over
        }));

        renderMenu({
            id: 'select-deployment-for-restore',
            text: `restore ${backupFilename.substring(0, 20)}... to:`,
            items: menuItems,
            backTarget: 'backup-menu' // Go back to the main backup menu
        });

    } catch (error) {
        console.error("Error listing deployments for restore:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
};


const _confirmRestore = async (params) => {
    const { resourceId, backupFilename, backupFileId, updateStatusDisplay, menuContainer, menuTitle } = params;
    const deployment = lastFetchedDeployments.find(d => d.id === resourceId);
    if (!deployment) {
        updateStatusDisplay('Could not find deployment details.', 'error');
        return;
    }
    if (!backupFilename) {
        updateStatusDisplay('No backup file was selected.', 'error');
        return;
    }

    const confirmation = await prompt({
        id: 'confirm-restore-prompt',
        text: `Restore ${deployment.name} from ${backupFilename}? This re-runs the setup script.`,
        type: 'options',
        options: [
            { label: 'yes', value: 'yes' },
            { label: 'no', value: 'no' }
        ]
    });

    if (confirmation.status !== 'answered' || confirmation.value !== 'yes') {
        updateStatusDisplay('Restore cancelled.', 'info');
        return;
    }

    // --- Start: Show Loading GIF & Rainbow Text ---
    updateStatusDisplay('Starting restore...', 'info');
    document.body.classList.add('deployment-loading');
    updateAccountButtonVisibility(false);
    updateSiteTitleVisibility(false);

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
            menuTitle.textContent = 'restoring';
            menuTitle.classList.add('rainbow-text');
        }
    }
    // --- End: Show Loading GIF & Rainbow Text ---

    try {
        updateStatusDisplay(`initiating restore for ${deployment.name}...`, 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/restore`, {
            method: 'POST',
            body: { 
                deployment: deployment.deployment,
                backup_file_id: backupFileId
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || result.message || 'Failed to initiate restore');
        }

        updateStatusDisplay('Restore initiated. Connecting to live log...', 'info');

        const ws = await establishWebSocketConnection(
            result.websocket_url,
            (ws, event) => updateStatusDisplay('Connected. Waiting for server...', 'info'),
            null, // onMessage is handled by _communicateRestore
            (event) => {
                updateStatusDisplay('Connection error.', 'error');
                _cancelActiveRestore('websocket_error');
            },
            (event) => { /* No status on normal close */ },
            updateStatusDisplay
        );

        if (!ws) {
            throw new Error("Failed to establish WebSocket connection.");
        }

        activeRestore.ws = ws;
        activeRestore.deploymentId = result.deployment_id;
        _communicateRestore(ws, params);

    } catch (error) {
        console.error("Error initiating restore:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
        _cancelActiveRestore(`initiation_error: ${error.message}`);
    }
};

async function _communicateRestore(ws, params) {
    const { updateStatusDisplay } = params;
    updateStatusDisplay(`Connection ready.`);
    
    let terminalLoaded = false;
    let terminalLoading = false;
    let terminalApi = null;
    const terminalQueue = [];

    const restoreBackButtonHandler = () => {
        // Unregister the handler to hide the back button while prompting.
        unregisterBackButtonHandler();

        prompt({
            text: "Are you sure you want to exit this restore?",
            type: 'options',
            options: [
                { label: 'yes', value: true },
                { label: 'no', value: false }
            ],
            id: 'restore_exit_confirm'
        }).then(result => {
            if (result && result.status === 'answered' && result.value === true) {
                _cancelActiveRestore("user_cancelled_via_prompt", "Restore cancelled by user.");
            } else {
                // If the user selects "No" or cancels the prompt, re-register the handler to show the back button again.
                updateBackButtonHandler(restoreBackButtonHandler);
            }
        });
    };
    
    // Start with the confirmation handler.
    updateBackButtonHandler(restoreBackButtonHandler);

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            const { event: eventName, payload } = data;

            if (eventName === 'UPDATE_STATUS') {
                const messageText = payload.text || JSON.stringify(payload);
                const level = payload.level || 'info';

                if (payload.view === 'terminal') {
                    if (!terminalLoaded && !terminalLoading) {
                        loadAndSwitchToTerminal(messageText, level);
                    } else if (terminalLoading) {
                        terminalQueue.push({ text: messageText, level: level });
                    } else if (terminalApi) {
                        terminalApi.addOutput(messageText, level);
                    }
                } else {
                    updateStatusDisplay(messageText, level);
                }
            } else if (eventName === 'FATAL_ERROR') {
                const messageText = payload.message || JSON.stringify(payload);
                updateStatusDisplay(messageText, 'error');
                _cancelActiveRestore(`server_error: ${messageText}`);
            } else if (eventName === 'DEPLOYMENT_COMPLETE') {
                if (terminalApi) {
                    const messageText = payload.finalMessage || "Restore finished.";
                    terminalApi.addOutput(messageText, 'info');
                    terminalApi.disableInput();
                }
                if (ws && ws.readyState < WebSocket.CLOSING) {
                    ws.close();
                }
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
            updateStatusDisplay('Error processing server message.', 'error');
            _cancelActiveRestore(`ws_message_error: ${error.message}`);
        }
    };

    async function loadAndSwitchToTerminal(initialMessage, initialLevel) {
        if (terminalLoading || terminalLoaded) return;
        terminalLoading = true;
        document.body.classList.remove('deployment-loading');
        
        try {
            const { loadTerminalView } = await import('/static/main.js');
            terminalApi = await loadTerminalView({
                existingWs: ws,
                hideInput: true
            });

            if (terminalApi) {
                terminalApi.addOutput(initialMessage, initialLevel);
                terminalLoaded = true;
            }

            // Flush any messages that arrived while loading
            if (terminalApi && terminalQueue.length > 0) {
                for (const queued of terminalQueue.splice(0)) {
                    terminalApi.addOutput(queued.text, queued.level);
                }
            }
        } catch (error) {
            console.error("Error loading terminal view:", error);
            updateStatusDisplay(`Error loading terminal: ${error.message}`, 'error');
        } finally {
            terminalLoading = false;
        }
    }
}

const _showScheduleMenu = async ({ renderMenu, updateStatusDisplay }) => {
    try {
        updateStatusDisplay('fetching deployments...', 'info');
        const deploymentsData = await fetchSites({ include_schedule: true });
        let deployments = [];
        let emptyMessage = 'No deployments found.';

        if (Array.isArray(deploymentsData)) {
            if (deploymentsData.length === 1 && deploymentsData[0].id === 'no-deployments') {
                emptyMessage = deploymentsData[0].name;
            } else {
                deployments = deploymentsData.filter(item => item.id !== 'no-deployments');
            }
        } else if (deploymentsData && deploymentsData.id === 'no-deployments') {
            // It's the "no deployments" object, let the empty array handle it.
        } else {
            console.warn("API response for /instances was not an array:", deploymentsData);
        }

        lastFetchedDeployments = deployments;

        if (deployments.length === 0) {
            const noDeploymentsMenu = {
                id: 'no-deployments-for-schedule',
                text: emptyMessage,
                items: [],
                backTarget: 'backup-menu'
            };
            renderMenu(noDeploymentsMenu);
            return;
        }

        const menuItems = deployments.map(deployment => ({
            id: `schedule-backup-${deployment.id}`,
            text: `${deployment.name} - ${deployment.backup_schedule || 'not set'}`,
            type: 'record',
            action: 'promptBackupSchedule',
            resourceId: deployment.id
        }));

        const deploymentsMenu = {
            id: 'select-deployment-for-schedule',
            text: 'select a deployment to schedule:',
            items: menuItems,
            backTarget: 'backup-menu'
        };

        renderMenu(deploymentsMenu);

    } catch (error) {
        console.error("Error listing deployments for schedule:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
};

const _promptBackupSchedule = async ({ resourceId, updateStatusDisplay }) => {
    const deployment = lastFetchedDeployments.find(d => d.id === resourceId);
    if (!deployment) {
        updateStatusDisplay('Could not find deployment details. Please try again.', 'error');
        return;
    }
    const result = await prompt({
        id: 'backup-schedule-prompt',
        text: `How often would you like to backup ${deployment.name}?`,
        type: 'form',
        items: [
            {
                type: 'select',
                id: 'interval',
                label: 'Backup Frequency',
                options: [
                    { label: 'Never', value: 'never' },
                    { label: 'Daily', value: 'daily' },
                    { label: 'Weekly', value: 'weekly' },
                    { label: 'Monthly', value: 'monthly' },
                ]
            }
        ],
        buttons: [
            { label: 'Save', isSubmit: true },
        ],
        cancelable: true
    });

    if (result.status === 'answered' && result.value) {
        await _setBackupSchedule({
            deployment,
            interval: result.value.interval,
            updateStatusDisplay
        });
    }
};

const _setBackupSchedule = async ({ deployment, interval, updateStatusDisplay }) => {
    try {
        updateStatusDisplay(`setting backup schedule for ${deployment.name}...`, 'info');
        const schedulePayload = {
            deployment: deployment.deployment,
            project_id: deployment.project_id,
            interval: interval
        };

        const response = await fetchWithAuth(`${API_BASE_URL}/schedule`, {
            method: 'POST',
            body: schedulePayload
        });

        const result = await response.json();

        if (response.ok) {
            updateStatusDisplay(result.message, 'success');
        } else {
            throw new Error(result.error || 'Failed to set backup schedule');
        }
    } catch (error) {
        console.error("Error setting backup schedule:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
};


// --- EXPORTED, GUARDED ACTIONS ---

export const listDeploymentsForBackup = requireAuthAndSubscription(
    _listDeploymentsForBackup,
    "create a backup"
);

export const createScriptBackup = requireAuthAndSubscription(
    _createScriptBackup,
    "create a script backup"
);

export const showRestoreMenu = requireAuthAndSubscription(
    _showRestoreMenu,
    "restore from backup"
);

export const selectDeploymentForRestore = requireAuthAndSubscription(
    _selectDeploymentForRestore,
    "restore from backup"
);

export const confirmRestore = requireAuthAndSubscription(
    _confirmRestore,
    "restore from backup"
);

export const showScheduleMenu = requireAuthAndSubscription(
    _showScheduleMenu,
    "schedule a backup"
);

export const promptBackupSchedule = requireAuthAndSubscription(
    _promptBackupSchedule,
    "schedule a backup"
);

// --- MENU CONFIG ---

const backupMenuConfig = {
    text: 'backups:',
    items: [
        { id: 'create-backup-option', text: 'create', action: 'listDeploymentsForBackup', type: 'button', showLoading: true },
        { id: 'restore-backup-option', text: 'restore', action: 'showRestoreMenu', type: 'button', showLoading: true },
        { id: 'schedule-backup-option', text: 'schedule', action: 'showScheduleMenu', type: 'button', showLoading: true }
    ],
    backTarget: 'resource-menu'
};
menus['backup-menu'] = backupMenuConfig;

const restoreBackupMenuConfig = {
    text: 'restore from backup:',
    items: [
        { text: 'feature not implemented', type: 'record' }
    ],
    backTarget: 'backup-menu'
};
menus['restore-backup-menu'] = restoreBackupMenuConfig;

const scheduleBackupMenuConfig = {
    text: 'schedule backups:',
    items: [
        { text: 'feature not implemented', type: 'record' }
    ],
    backTarget: 'backup-menu'
};
menus['schedule-backup-menu'] = scheduleBackupMenuConfig; 