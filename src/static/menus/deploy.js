// Import the central menu registry and API base URL
import { menus } from '/static/pages/menu.js';
import { registerHandler } from '../scripts/registry.js';
import { 
    loadConsoleView,
    updateAccountButtonVisibility,
    updateSiteTitleVisibility,
    fetchWithAuth
} from '/static/main.js';
import { CONFIG } from '/static/config.js';
const API_BASE_URL = CONFIG.API_BASE_URL;
import { loadTerminalView, returnFromTerminal } from '/static/pages/terminal.js';
import { getUser, initializeGoogleSignIn, triggerGoogleSignIn } from '/static/scripts/authenticate.js';
import { prompt, clearPromptStack } from '/static/pages/prompt.js';
import { establishWebSocketConnection } from '/static/scripts/socket.js';
import { updateStatusDisplay, renderMenu } from '/static/pages/menu.js';
import { pushBackHandler, popBackHandler, replaceBackHandler } from '/static/scripts/back.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { purchaseDomain } from '/static/scripts/api.js';
import { handleTerminalMessage } from '/static/pages/terminal.js';


let currentProjectId = null;
let currentDeploymentName = null;
let pollingInterval = null; // Store the interval ID for polling
let activeDeployment = {
    ws: null,
    deploymentId: null
};

/**
 * A centralized function to cancel the active deployment, clean up UI,
 * and return the user to the deploy menu.
 * @param {string} reason - The reason for the cancellation.
 * @param {object} [navParams] - Optional navigation parameters.
 */
function _cancelActiveDeployment(reason, navParams = {}) {
    console.log(`[DEPLOY CANCELLATION] Reason: ${reason}. Deployment ID: ${activeDeployment.deploymentId}`);
    window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: false } }));
    document.body.classList.remove('deployment-loading');
    
    const { ws, deploymentId } = activeDeployment;

    if (ws) {
        ws.onmessage = null;
        if (ws.readyState < WebSocket.CLOSING) {
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        action: "cancel_deployment",
                        deployment_id: deploymentId,
                        reason: reason
                    }));
                }
                ws.close();
            } catch (e) {
                console.warn('Error during WebSocket cleanup:', e);
            }
        }
    }

    const params = { 
        menuId: 'deploy-menu',
        ...navParams
    };
    
    if (document.body.classList.contains('terminal-view-active')) {
        returnFromTerminal(params);
    } else {
        loadConsoleView(params);
    }
    
    activeDeployment.ws = null;
    activeDeployment.deploymentId = null;
}


// --- Menu Configuration ---
menus['deploy-menu'] = {
    text: 'difficulty:',
    items: [
        { 
            id: 'simple-option', 
            text: 'simple', 
            type: 'button', 
            action: 'handleDeploySimple',
            showLoading: true,
            tooltip: 'fast, feature complete, skips dumb questions (reccomended)'
        },
        /*{ 
            id: 'grapes-option', 
            text: 'grapes', 
            type: 'button', 
            action: 'handleDeployGrapes',
            info: 'Deploy a GrapesJS instance for web building.'
        },*/
        { 
            id: 'advanced-option', 
            text: 'advanced', 
            type: 'button', 
            action: 'handleDeployAdvanced',
            showLoading: true,
            tooltip: 'asks unimportant questions scenic route (fun)' 
        },
    ],
    backTarget: 'dashboard-menu',
    onLeave: () => {
        // Clear any active polling when leaving the menu
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            console.log('Cleared deployment status polling interval.');
        }
    }
};

// --- Deployment Initiation ---

/**
 * Phase 1: Preparation (Guarded by Auth/Sub)
 * This function handles the initial HTTP call to create the deployment.
 * It resolves when the server acknowledges the request, which organically 
 * ends the generic "Loading Mode" in menu.js.
 */
async function _prepareDeployment(prepParams) {
    const { params, deploymentType } = prepParams;
    updateStatusDisplay(`Preparing deployment…`, 'info');
    
    const response = await fetchWithAuth(`${API_BASE_URL}/deploy`, {
        method: 'POST',
        body: { ...params, task: deploymentType }
    });

    let result = null;
    try {
        result = await response.json();
    } catch(_) { result = {}; }

    if (!response.ok) {
        const serverError = (result && (result.error || result.message)) ? (result.error || result.message) : null;
        const errorMsg = serverError || response.statusText || "Unknown error during deployment request.";
        throw new Error(errorMsg);
    }

    return result; // Contains websocket_url and deployment_id
}

/**
 * Phase 2: Execution
 * This function takes over after preparation is complete.
 * It injects the "cat guy" and starts the WebSocket communication.
 */
async function _executeDeployment(prepParams, prepResult) {
    const { params, deploymentType } = prepParams;
    window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: true } }));
    document.body.classList.add('deployment-loading');

    updateAccountButtonVisibility(false); // Hide account button
    updateSiteTitleVisibility(false); // Hide site title during deployment
    
    // Register the master back button handler for the entire deployment.
    const deploymentBackButtonHandler = async () => {
        console.log("[Deployment] Back button pressed, showing exit confirmation.");
        
        const result = await prompt({
            text: "Are you sure you want to exit this deployment?",
            type: 'form',
            buttons: [
                { label: 'yes', value: true },
                { label: 'no', value: false }
            ],
            id: 'deployment_exit_confirm'
        });

        console.log("[Deployment] Exit confirmation result:", result);
        if (result && result.status === 'answered' && result.value === true) {
            console.log("[Deployment] User confirmed exit, cancelling deployment.");
            clearPromptStack();
            _cancelActiveDeployment("user_cancelled_via_prompt", "Deployment cancelled by user.");
        } else {
            // The Ballet: If the user says 'no', we must re-push the handler 
            // because executeBackHandler popped it before calling us.
            pushBackHandler(deploymentBackButtonHandler);
        }
    };
    
    // The Ballet: Phase 1 has resolved, organically ending the generic loading mode.
    // We now push our specialized confirmation handler onto a clean stack.
    pushBackHandler(deploymentBackButtonHandler);

    // --- START: Show Loading GIF & Rainbow Text ---
    if (params.menuContainer) {
        const listContainer = params.menuContainer.querySelector('#menu-list-container');
        if (listContainer) {
            listContainer.innerHTML = ''; // Clear the menu buttons
            const loadingGif = document.createElement('img');
            loadingGif.src = '/static/resources/happy-cat.gif';
            loadingGif.alt = 'Loading...';
            loadingGif.className = 'loading-gif'; // Add a class for styling
            listContainer.appendChild(loadingGif);
        }
        // Also update and show the menu title
        if (params.menuTitle) {
            params.menuTitle.style.display = ''; 
            params.menuTitle.textContent = 'deploying';
            params.menuTitle.classList.add('rainbow-text');
        }
    }
    // --- END: Show Loading GIF & Rainbow Text ---

    try {
        updateStatusDisplay(`Connecting…`, 'info');
        const ws = await establishWebSocketConnection(
            prepResult.websocket_url, 
            (ws, event) => {
                updateStatusDisplay(`Connected. Waiting for server…`, 'info');
            },
            null, 
            (event) => {
                updateStatusDisplay(`Connection error.`, 'error');
                _cancelActiveDeployment('websocket_error');
            },
            (event) => {},
            updateStatusDisplay 
        );
        
        if (!ws) {
            throw new Error("Failed to establish WebSocket connection.");
        }

        activeDeployment.ws = ws;
        activeDeployment.deploymentId = prepResult.deployment_id;
        communicate(ws, prepResult.deployment_id);

    } catch (error) {
        if (error.message !== 'UserCancelled') {
            console.error(`Deployment execution exception for ${deploymentType}:`, error);
        }
        _cancelActiveDeployment(`execution_error: ${error.message}`);
    }
}

// --- Action Handlers ---

async function _handleDeployAction(prepParams) {
    // Phase 1: Prepare (Guarded, organically ends Loading Mode on resolution)
    const prepResult = await _prepareDeployment(prepParams);
    
    // Phase 2: The Handoff
    // The Ballet: We return a function. menu.js will see this, finish its cleanup 
    // (popping the loading handler), and THEN call this function to start the deployment.
    return () => _executeDeployment(prepParams, prepResult);
}

// Action handler for advanced deployment
export const handleDeployAdvanced = requireAuthAndSubscription(
    (params) => _handleDeployAction({ params, deploymentType: 'advanced' }),
    'advanced deployment'
);

// Action handler for simple deployment
export const handleDeploySimple = requireAuthAndSubscription(
    (params) => _handleDeployAction({ params, deploymentType: 'simple' }),
    'simple deployment'
);


// --- Communication with Backend ---

// The core logic for handling the WebSocket communication and prompting the user.
async function communicate(ws, deploymentId) {
    updateStatusDisplay(`Connection ready.`);
    
  let terminalLoaded = false;
  let terminalLoading = false;
  let terminalApi = null;
  const terminalQueue = [];
   
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        const { event: eventName, payload } = data;

        try {
            switch (eventName) {
                case 'UPDATE_STATUS':
                    const messageText = payload.text || JSON.stringify(payload);
                    const level = payload.level || 'info';

                    // Check if the message is intended for the terminal view
                    if (payload.view === 'terminal') {
                        handleTerminalMessage(messageText, level, ws);
                    } else {
                        // This is a standard, pre-terminal status update
                        updateStatusDisplay(messageText, level);
                    }
                    break;
                case 'PROMPT_USER':
                    await handlePromptUserEvent(payload);
                    break;
                case 'FATAL_ERROR':
                    handleFatalErrorEvent(payload);
                    break;
                case 'DEPLOYMENT_COMPLETE':
                    handleDeploymentCompleteEvent(payload);
                    break;
                default:
                    updateStatusDisplay(`Received unknown event: ${eventName}`, 'warning');
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
            updateStatusDisplay('Error processing server message.', 'error');
            _cancelActiveDeployment(`ws_message_error: ${error.message}`);
        }
    };

    async function handlePromptUserEvent(payload) {
        // If the prompt payload has a URL, open it in a popup.
        if (payload.url) {
            const { openPopup } = await import('/static/scripts/popup.js');
            openPopup(payload.url);
        }

        try {
            const answer = await prompt({
                ...payload,
                noBackHandler: true
            }); // The payload is the prompt config
            
            if (payload.type === 'domain' && answer && answer.status === 'answered' && answer.value) {
                // The domain prompt returns { domainName, price } directly in answer.value
                const { domainName, price } = answer.value;
                const user = getUser();
                if (!user || !user.token) {
                    throw new Error("User not authenticated.");
                }
                
                updateStatusDisplay(`Purchasing...`, 'info');
                
                const result = await purchaseDomain({
                    domainName,
                    price,
                    offSession: true,
                    token: user.token
                });
                
                if (!result.ok) {
                    throw new Error(result.error || 'Failed to purchase domain.');
                }
                
                updateStatusDisplay(`Successfully registered ${domainName}!`, 'success');
                
                // Set the value back to just the domainName string for the worker
                answer.value = domainName;
            } else if (payload.type === 'form' && answer && answer.status === 'answered' && answer.value) {
                // If it's a form, the worker might be expecting a single value if there's only one item.
                // However, we've updated the worker to expect the object, so we just pass answer.value as-is.
                console.log("[Deployment] Form answer received:", answer.value);
            }

            // Send a structured response back to the worker
            ws.send(JSON.stringify({
                status: answer.status, // 'answered' or 'canceled'
                value: answer.value
            }));
        } catch (error) {
            console.error("Error handling prompt:", error);
            _cancelActiveDeployment(`prompt_error: ${error.message}`);
        }
    }

    function handleFatalErrorEvent(payload) {
        const messageText = payload.message || JSON.stringify(payload);
        updateStatusDisplay(messageText, 'error');
        _cancelActiveDeployment(`server_error: ${messageText}`);
    }

    function handleDeploymentCompleteEvent(payload) {
        const machineId = payload.machine_id;
        const deploymentName = payload.deployment_name;
        const promptConfig = {
            id: 'deployment-complete-prompt',
            type: 'form',
            text: payload.finalMessage || "Deployment finished.",
            buttons: [
                { label: 'ok', value: 'ok' },
                { label: 'view resource', value: 'view_resource' }
            ]
        };

        prompt(promptConfig).then(result => {
            if (ws && ws.readyState < WebSocket.CLOSING) {
                ws.close();
            }

            if (result && result.status === 'answered' && result.value === 'view_resource' && machineId && deploymentName) {
                console.log(`Transitioning to view site: ${deploymentName} on ${machineId}`);
                _cancelActiveDeployment('view_resource', { 
                    specialNav: 'viewSite', 
                    machineId: machineId,
                    deploymentName: deploymentName
                });
            } else {
                // User clicked OK. Leave them in the terminal.
                
                handleTerminalMessage("Deployment complete. Press back to return to the menu.", "success", ws);

                // Set a simple back button to return to the menu.
                // The Ballet: We replace the current terminal handler with a return handler
                replaceBackHandler(() => returnFromTerminal({ menuId: 'deploy-menu' }));

                // Mark deployment as no longer active.
                activeDeployment.ws = null;
                activeDeployment.deploymentId = null;
                window.dispatchEvent(new CustomEvent('deploymentstatechange', { detail: { isActive: false } }));
                document.body.classList.remove('deployment-loading');
            }
        });
    }
}

// Register handlers with the central registry
registerHandler('handleDeploySimple', handleDeploySimple);
registerHandler('handleDeployAdvanced', handleDeployAdvanced);
