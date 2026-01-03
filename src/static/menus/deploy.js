// Import the central menu registry and API base URL
import { menus } from '/static/pages/menu.js';
import { 
    API_BASE_URL, 
    fetchWithAuth, 
    loadTerminalView, 
    loadConsoleView,
    updateBackButtonHandler,
    unregisterBackButtonHandler,
    updateAccountButtonVisibility,
    updateSiteTitleVisibility
} from '/static/main.js';
import { updateStatusDisplay, renderMenu } from '/static/pages/menu.js';
// Import getUser to check authentication status and retrieve token
import { getUser, initializeGoogleSignIn, triggerGoogleSignIn } from '/static/scripts/authenticate.js';
// Import the new prompt display function and cleanup
import {
    prompt,
    cancelCurrentPrompt,
    clearPromptStack,
} from '/static/pages/prompt.js';
// Import the new WebSocket connection function
import { establishWebSocketConnection } from '/static/scripts/socket.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';


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
 * @param {string} [statusMessage] - An optional message to display after cancellation.
 */
function cancelActiveDeployment(reason, statusMessage) {
    console.log(`[DEPLOY CANCELLATION] Reason: ${reason}. Deployment ID: ${activeDeployment.deploymentId}`);
    document.body.classList.remove('deployment-loading');
    
    // Explicitly clean up UI state that might have been set by the terminal view
    document.body.classList.remove('terminal-view-active');
    document.body.classList.remove('overlay-active');
    
    const { ws, deploymentId } = activeDeployment;

    if (ws && ws.readyState < WebSocket.CLOSING) {
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

    unregisterBackButtonHandler();
    
    cancelCurrentPrompt();
    clearPromptStack();
    
    // cleanupDeployUI() is not needed as loadConsoleView rebuilds the DOM from scratch.
    
    loadConsoleView({ 
        menuId: 'deploy-menu', 
        output: statusMessage || 'Deployment cancelled.', 
        type: 'info' 
    });
    
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
async function _initiateDeployment(params = {}, deploymentType) {
    updateStatusDisplay(`Starting deployment…`, 'info');
    document.body.classList.add('deployment-loading');

    updateAccountButtonVisibility(false); // Hide account button
    updateSiteTitleVisibility(false); // Hide site title during deployment
    
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
        // Also update the menu title
        if (params.menuTitle) {
            params.menuTitle.textContent = 'deploying';
            params.menuTitle.classList.add('rainbow-text');
        }
    }
    // --- END: Show Loading GIF & Rainbow Text ---

    const user = getUser(); // Still need user for initial call

    try {
        // Step 1: Initial HTTP call to the /deploy endpoint
        updateStatusDisplay(`Preparing deployment…`, 'info');
        // Use shared auth wrapper to benefit from silent reauth
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
            updateStatusDisplay(`Error initiating deployment for ${deploymentType}: ${errorMsg}`, 'error');
            return;
        }

        updateStatusDisplay(`Deployment created. Connecting…`, 'info');

        // Step 2: Establish WebSocket connection
        updateStatusDisplay(`Connecting…`, 'info');
        const ws = await establishWebSocketConnection(
            result.websocket_url, 
            (ws, event) => {
                // onOpen callback
                updateStatusDisplay(`Connected. Waiting for server…`, 'info');
            },
            null, // onMessage - will be set up in communicate()
            (event) => {
                // onError callback
                updateStatusDisplay(`Connection error.`, 'error');
                cancelActiveDeployment('websocket_error');
            },
            (event) => {
                // onClose callback
                // Intentionally no status message on normal close
            },
            updateStatusDisplay // statusCallback
        );
        
        if (!ws) {
            const errorMsg = "Failed to establish WebSocket connection.";
            updateStatusDisplay(errorMsg, 'error');
            return;
        }

        // Step 3: Start the communication/prompt flow. The terminal view will be loaded
        // by the `communicate` function when it receives the first 'terminal' message.
        activeDeployment.ws = ws;
        activeDeployment.deploymentId = result.deployment_id;
        communicate(ws, result.deployment_id);

    } catch (error) {
        const errorMsg = error.message || "An unknown error occurred during deployment initiation.";
        updateStatusDisplay(`Deployment error: ${errorMsg}`, 'error');
        console.error(`Deployment initiation exception for ${deploymentType}:`, error);
        // activeDeployment might be partially set, cancelActiveDeployment handles this
        cancelActiveDeployment(`initiation_error: ${error.message}`);
    }
}


// --- Action Handlers ---

// Action handler for deploying a blank VM
export const handleDeployAdvanced = requireAuthAndSubscription(
    (params) => _initiateDeployment(params, 'advanced'),
    'deploy a vm'
);

// Action handler for deploying WordPress
export const handleDeploySimple = requireAuthAndSubscription(
    (params) => _initiateDeployment(params, 'simple'),
    'deploy wordpress'
);


// --- Communication with Backend ---

// The core logic for handling the WebSocket communication and prompting the user.
async function communicate(ws, deploymentId) {
    updateStatusDisplay(`Connection ready.`);
    
  let terminalLoaded = false;
  let terminalLoading = false;
  let terminalApi = null;
  const terminalQueue = [];
   
    // A unified back button handler that always prompts for confirmation.
    const deploymentBackButtonHandler = () => {
        // Unregister the handler to hide the back button while prompting.
        unregisterBackButtonHandler();

        prompt({
            text: "Are you sure you want to exit this deployment?",
            type: 'options',
            options: [
                { label: 'yes', value: true },
                { label: 'no', value: false }
            ],
            id: 'deployment_exit_confirm'
        }).then(result => {
            if (result && result.status === 'answered' && result.value === true) {
                cancelActiveDeployment("user_cancelled_via_prompt", "Deployment cancelled by user.");
            } else {
                // If the user selects "No" or cancels the prompt, re-register the handler to show the back button again.
                updateBackButtonHandler(deploymentBackButtonHandler);
            }
        });
    };
    
    // Start with the confirmation handler.
    updateBackButtonHandler(deploymentBackButtonHandler);

    ws.onmessage = async (event) => {
        try {
            console.log("RAW WEBSOCKET MESSAGE:", event.data); // <-- ADDING LOGGING HERE
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
                // Add a case for a future explicit completion event
                case 'DEPLOYMENT_COMPLETE':
                    handleDeploymentCompleteEvent(payload);
                    break;
                default:
                    updateStatusDisplay(`Received unknown event: ${eventName}`, 'warning');
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
            updateStatusDisplay('Error processing server message.', 'error');
            cancelActiveDeployment(`ws_message_error: ${error.message}`);
        }
    };

    function handleUpdateStatusEvent(payload) {
        const messageText = payload.text || JSON.stringify(payload);
        const level = payload.level || 'info';

        // Check if the message is intended for the terminal view
        if (payload.view === 'terminal') {
            if (!terminalLoaded) {
                // If a load is already in progress, buffer the message
                if (terminalLoading) {
                    terminalQueue.push({ text: messageText, level: level });
                    return;
                }
                // Otherwise, initiate the terminal view load
                loadAndSwitchToTerminal(messageText, level);
            } else {
                // Terminal already loaded, just add output
                if (terminalApi) {
                    terminalApi.addOutput(messageText, level);
                }
            }
        } else {
            // This is a standard, pre-terminal status update
            updateStatusDisplay(messageText, level);
        }
    }
    
    async function loadAndSwitchToTerminal(initialMessage, initialLevel) {
        if (terminalLoading || terminalLoaded) return;

        terminalLoading = true;
        document.body.classList.remove('deployment-loading');
        
        try {
            terminalApi = await loadTerminalView({
                existingWs: ws,
                targetWebsocketPath: 'unused_since_ws_is_provided',
                hideInput: true
            });

            if (terminalApi) {
                terminalApi.addOutput(initialMessage, initialLevel);
                terminalLoaded = true;
            }
            
            // The correct handler is already set at the start of `communicate`, so this is no longer needed.
            // updateBackButtonHandler(terminalBackButtonHandler);

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

    async function handlePromptUserEvent(payload) {
        try {
            const answer = await prompt(payload); // The payload is the prompt config
            // Send a structured response back to the worker
            ws.send(JSON.stringify({
                status: answer.status, // 'answered' or 'canceled'
                value: answer.value
            }));
        } catch (error) {
            console.error("Error handling prompt:", error);
            cancelActiveDeployment(`prompt_error: ${error.message}`);
        }
    }

    function handleFatalErrorEvent(payload) {
        const messageText = payload.message || JSON.stringify(payload);
        updateStatusDisplay(messageText, 'error');
        cancelActiveDeployment(`server_error: ${messageText}`);
    }

    function handleDeploymentCompleteEvent(payload) {
        const messageText = payload.finalMessage || "Deployment finished.";
        
        // This function will handle the final cleanup and transition.
        const finalizeAndReturn = () => {
            document.removeEventListener('keydown', keydownHandler); // Clean up listener
            
            // Re-use the cancellation logic to clean up UI, but provide a success message.
            // Using a specific reason for clarity in logs.
            cancelActiveDeployment("deployment_complete", "Deployment successful.");
        };

        // This handler will listen for the Enter key.
        const keydownHandler = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                finalizeAndReturn();
            }
        };

        if (terminalApi) {
            terminalApi.addOutput(messageText, 'info');
            terminalApi.addOutput("\nPress Enter to continue...", 'system'); // Use 'system' or a similar class for styling
            terminalApi.disableInput(); // Keep input disabled
            document.addEventListener('keydown', keydownHandler);
        } else {
            // If for some reason the terminal view isn't active, fall back to a prompt.
            // This makes the system more robust.
            prompt({
                id: 'deployment-complete-fallback',
                type: 'options',
                text: messageText,
                options: ['OK']
            }).then(finalizeAndReturn);
        }

        if (ws && ws.readyState < WebSocket.CLOSING) {
            ws.close();
        }
    }
}
