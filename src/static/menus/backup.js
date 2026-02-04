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
import { prompt, cancelCurrentPrompt, clearPromptStack } from '/static/pages/prompt.js';
import { establishWebSocketConnection } from '/static/scripts/socket.js';


let lastFetchedDeployments = [];
let lastFetchedMachines = [];
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
    window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: false } }));
    document.body.classList.remove('deployment-loading');
    document.body.classList.remove('terminal-view-active');
    document.body.classList.remove('overlay-active');
    
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
    clearPromptStack();

    // On success, go to resources menu. On failure/cancel, go back to backup menu.
    const targetMenu = (reason === 'restore_complete') ? 'resources-menu' : 'backup-menu';
    const messageType = (reason === 'restore_complete') ? 'success' : 'info';

    const params = { 
        menuId: targetMenu, 
        output: statusMessage || 'Restore process ended.', 
        type: messageType
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
        const vms = await fetchSites();
        let deployments = [];
        let emptyMessage = 'No deployments found.';

        if (Array.isArray(vms)) {
            if (vms.length === 1 && vms[0].id === 'no-deployments') {
                emptyMessage = vms[0].name;
            } else {
                vms.forEach(vm => {
                    if (vm.deployments && vm.deployments.length > 0) {
                        const deploymentsOnVm = vm.deployments.map(dep => ({
                            id: `${vm.id}-${dep.deployment_name}`,
                            name: dep.deployment_name,
                            deployment: dep.deployment_name,
                            vm_name: vm.name,
                            project_id: vm.project_id,
                        }));
                        deployments.push(...deploymentsOnVm);
                    }
                });
            }
        } else {
            console.warn("API response for /instances was not an array:", vms);
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
            text: `${deployment.name} on ${deployment.vm_name}`,
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
    window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: true } }));
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
            action: 'selectMachineForRestore',
            showLoading: true,
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

const _selectMachineForRestore = async (params) => {
    const { backupFilename, backupFileId, renderMenu, updateStatusDisplay } = params;
    if (!backupFilename) {
        updateStatusDisplay('Error: No backup file was selected.', 'error');
        return;
    }

    try {
        updateStatusDisplay('fetching machines...', 'info');
        const machines = await fetchSites(); 
        
        // Filter out the 'no-deployments' placeholder if it exists
        lastFetchedMachines = machines.filter(m => m.id !== 'no-deployments');
        updateStatusDisplay('', 'info');

        let emptyMessage = 'No machines found to restore to.';
        if (machines.length === 1 && machines[0].id === 'no-deployments') {
            emptyMessage = machines[0].name;
        }

        const menuItems = lastFetchedMachines.map(machine => {
            return {
                id: `restore-to-machine-${machine.id}`,
                text: machine.name, // Display the machine name
                type: 'record',
                action: 'confirmRestore',
                showLoading: true,
                resourceId: machine.id, // This is the machine ID
                backupFilename: backupFilename,
                backupFileId: backupFileId
            };
        });

        // Always add the option to create a new machine
        menuItems.push({
            id: 'restore-to-new-machine',
            text: 'new machine',
            type: 'record',
            action: 'confirmRestore',
            showLoading: true,
            resourceId: 'new_machine',
            backupFilename: backupFilename,
            backupFileId: backupFileId
        });

        if (lastFetchedMachines.length === 0) {
            renderMenu({
                id: 'no-machines-for-restore',
                text: emptyMessage,
                items: menuItems, // Still show the 'new machine' option
                backTarget: 'backup-menu'
            });
            return;
        }

        renderMenu({
            id: 'select-machine-for-restore',
            text: `restore ${backupFilename.substring(0, 20)}... to:`,
            items: menuItems,
            backTarget: 'backup-menu'
        });

    } catch (error) {
        console.error("Error listing machines for restore:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
};


const _confirmRestore = async (params) => {
    const { resourceId, backupFilename, backupFileId, updateStatusDisplay, menuContainer, menuTitle } = params;
    
    let machine;
    if (resourceId === 'new_machine') {
        machine = { id: 'new_machine', name: 'a new machine', zone: null };
    } else {
        machine = lastFetchedMachines.find(m => m.id === resourceId);
    }
    
    if (!machine) {
        updateStatusDisplay('Could not find machine details.', 'error');
        return;
    }
    if (!backupFilename) {
        updateStatusDisplay('Backup file is missing.', 'error');
        return;
    }

    const confirmation = await prompt({
        id: 'confirm-restore-prompt',
        text: `Restore backup ${backupFilename} to ${machine.name}?`,
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
    window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: true } }));
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
        updateStatusDisplay(`initiating restore...`, 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/restore`, {
            method: 'POST',
            body: { 
                vm_id: machine.id,
                zone: machine.zone,
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
                updateBackButtonHandler(restoreBackButtonHandler);
            }
        });
    };
    
    updateBackButtonHandler(restoreBackButtonHandler);

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            const { event: eventName, payload } = data;

            switch (eventName) {
                case 'UPDATE_STATUS':
                    handleUpdateStatusEvent(payload);
                    break;
                case 'PROMPT_USER':
                    await handlePromptUserEvent(payload);
                    break;
                case 'FATAL_ERROR':
                    handleFatalErrorEvent(payload);
                    break;
                case 'DEPLOYMENT_COMPLETE':
                    handleRestoreCompleteEvent(payload);
                    break;
                default:
                    updateStatusDisplay(`Received unknown event: ${eventName}`, 'warning');
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
            updateStatusDisplay('Error processing server message.', 'error');
            _cancelActiveRestore(`ws_message_error: ${error.message}`);
        }
    };

    function handleUpdateStatusEvent(payload) {
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
    }
    
    async function handlePromptUserEvent(payload) {
        if (payload.url) {
            const { openPopup } = await import('/static/scripts/popup.js');
            openPopup(payload.url);
        }

        try {
            const answer = await prompt(payload);
            ws.send(JSON.stringify({
                status: answer.status,
                value: answer.value
            }));
        } catch (error) {
            console.error("Error handling prompt:", error);
            _cancelActiveRestore(`prompt_error: ${error.message}`);
        }
    }

    function handleFatalErrorEvent(payload) {
        const messageText = payload.message || JSON.stringify(payload);
        updateStatusDisplay(messageText, 'error');
        _cancelActiveRestore(`server_error: ${messageText}`);
    }

    function handleRestoreCompleteEvent(payload) {
        const promptConfig = payload.prompt || {
            id: 'restore-complete-prompt',
            type: 'options',
            text: payload.finalMessage || "Restore finished.",
            options: ['OK']
        };

        prompt(promptConfig).then(result => {
            if (ws && ws.readyState < WebSocket.CLOSING) {
                ws.close();
            }

            if (result && result.status === 'answered' && result.value === 'view_resource' && result.context && result.context.site_id) {
                const siteId = result.context.site_id;
                console.log(`Transitioning to view site: ${siteId}`);
                
                unregisterBackButtonHandler();
                clearPromptStack();
                activeRestore.ws = null;
                activeRestore.deploymentId = null;
                document.body.classList.remove('deployment-loading');

                window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: false } }));
                loadConsoleView({ specialNav: 'viewSite', siteId: siteId });

            } else {
                _cancelActiveRestore("restore_complete", "Restore successful.");
            }
        });
    }

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
    window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: true } }));
    try {
        updateStatusDisplay('fetching deployments...', 'info');
        const vms = await fetchSites({ include_schedule: true });
        let deployments = [];
        let emptyMessage = 'No deployments found.';

        if (Array.isArray(vms)) {
            if (vms.length === 1 && vms[0].id === 'no-deployments') {
                emptyMessage = vms[0].name;
            } else {
                vms.forEach(vm => {
                    if (vm.deployments && vm.deployments.length > 0) {
                        const deploymentsOnVm = vm.deployments.map(dep => ({
                            id: `${vm.id}-${dep.deployment_name}`,
                            name: dep.deployment_name,
                            deployment: dep.deployment_name,
                            vm_name: vm.name,
                            project_id: vm.project_id,
                            backup_schedule: dep.backup_schedule || 'not set'
                        }));
                        deployments.push(...deploymentsOnVm);
                    }
                });
            }
        } else if (vms && vms.id === 'no-deployments') {
            emptyMessage = vms.name;
        } else {
            console.warn("API response for /instances was not an array:", vms);
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
            text: `${deployment.name} on ${deployment.vm_name} - ${deployment.backup_schedule || 'not set'}`,
            type: 'record',
            action: 'promptBackupSchedule',
            showLoading: true, // Add this
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

const _promptBackupSchedule = async ({ resourceId, updateStatusDisplay, renderMenu, menuContainer, menuTitle }) => {
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
                    { label: 'Manual', value: 'manual' },
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
        // --- Start: Show Loading GIF & Rainbow Text ---
        window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: true } }));
        updateStatusDisplay('Updating schedule...', 'info');
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
                menuTitle.textContent = 'scheduling';
                menuTitle.classList.add('rainbow-text');
            }
        }
        // --- End: Show Loading GIF & Rainbow Text ---

        await _setBackupSchedule({
            deployment,
            interval: result.value.interval,
            updateStatusDisplay,
            renderMenu // Pass renderMenu to the next function
        });
    } else {
        // User cancelled the prompt, return to the main backup menu.
        // The onRender handler for 'backup-menu' will reset the deployment state.
        renderMenu('backup-menu');
    }
};

const _setBackupSchedule = async ({ deployment, interval, updateStatusDisplay, renderMenu }) => {
    try {
        // This is already being set by the loading UI in the calling function.
        // updateStatusDisplay(`setting backup schedule for ${deployment.name}...`, 'info');
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
    } finally {
        // Clean up loading UI and refresh the schedule list menu.
        document.body.classList.remove('deployment-loading');
        // The deploymentstatechange flag remains true, navigation back will clear it.
        await _showScheduleMenu({ renderMenu, updateStatusDisplay });
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

export const selectMachineForRestore = requireAuthAndSubscription(
    _selectMachineForRestore,
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
    backTarget: 'resource-menu',
    onRender: () => {
        window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: false } }));
    }
};
menus['backup-menu'] = backupMenuConfig;
