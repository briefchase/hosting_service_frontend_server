// Import the central menu registry and API base URL
import { menus } from '/static/pages/menu.js';
import { API_BASE_URL } from '/static/main.js';
// Import the function needed to load the terminal view and update status
import { loadTerminalView, loadConsoleView, returnFromTerminal } from '/static/main.js';
import { updateStatusDisplay, cleanupCurrentMenu } from '/static/pages/menu.js';
// Import getUser to check authentication status and retrieve token
import { getUser, initializeGoogleSignIn, triggerGoogleSignIn } from '/static/scripts/authenticate.js';
// Import the new prompt display function and cleanup
import {
    prompt,
    cleanupPrompts,
    cleanupPromptUI,
    currentResolve, // Import the resolver
} from '/static/pages/prompt.js';
// Import the new WebSocket connection function
import { establishWebSocketConnection } from '/static/scripts/socket.js';
// Import the global back button management functions
import { registerBackButtonHandler, unregisterBackButtonHandler } from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';

// Store references passed from initializeMenu
// let actionHandlersRef = {}; // This doesn't seem to be used currently

// Define Deploy Menu Configuration
const deployMenuConfig = {
    text: 'instance type:',
    items: [
        { 
            id: 'wordpress-option', 
            text: 'wordpress', 
            type: 'button', 
            action: 'handleDeployWordPress',
            info: 'Deploy a lamp stack in a vm running wordpress.' 
        },
        /*
        { 
            id: 'grapes-option', 
            text: 'grapes', 
            type: 'button', 
            action: 'handleDeployGrapes'
        },
        { 
            id: 'vm-option', 
            text: 'blank vm', 
            type: 'button', 
            action: 'handleDeployVM',
            info: 'Create a new Virtual Machine instance.' 
        },
        */
    ],
    backTarget: 'dashboard-menu'
};

// Register this menu configuration
menus['deploy-menu'] = deployMenuConfig;

// --- Deployment Initiation ---
async function _initiateDeploymentAndLoadTerminal(params = {}, deploymentType) {
    updateStatusDisplay(`Initiating deployment for: ${deploymentType}...`, 'info');
    
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

    const user = getUser(); // Still need user for the token

    try {
        // Step 1: Initial HTTP call to the /deploy endpoint
        updateStatusDisplay(`Requesting deployment ID and WebSocket URL for ${deploymentType}...`, 'debug');
        const response = await fetch(`${API_BASE_URL}/deploy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token}`
            },
            body: JSON.stringify({ ...params, task: deploymentType })
        });

        const result = await response.json();

        if (!response.ok) {
            const errorMsg = result.message || response.statusText || "Unknown error during deployment request.";
            updateStatusDisplay(`Error initiating deployment for ${deploymentType}: ${errorMsg}`, 'error');
            loadConsoleView({ output: `Failed to initiate deployment: ${errorMsg}`, type: 'error' });
            return;
        }

        updateStatusDisplay(`Deployment task for ${deploymentType} created. ID: ${result.deployment_id}.`, 'info');

        // Step 2: Establish WebSocket connection
        updateStatusDisplay(`Establishing WebSocket connection to ${result.websocket_url}...`, 'debug');
        const ws = await establishWebSocketConnection(
            result.websocket_url, 
            (ws, event) => {
                // onOpen callback
                updateStatusDisplay(`WebSocket connected. Awaiting server instructions for ${deploymentType} (ID: ${result.deployment_id})...`, 'info');
            },
            null, // onMessage - will be set up in communicate()
            (event) => {
                // onError callback
                updateStatusDisplay(`WebSocket connection error for ${deploymentType}`, 'error');
            },
            (event) => {
                // onClose callback
                updateStatusDisplay(`WebSocket connection closed for ${deploymentType}`, 'warning');
            },
            updateStatusDisplay // statusCallback
        );
        
        if (!ws) {
            const errorMsg = "Failed to establish WebSocket connection.";
            updateStatusDisplay(errorMsg, 'error');
            loadConsoleView({ output: errorMsg, type: 'error' });
            return;
        }

        // Step 3: Load the terminal view, passing the existing WebSocket
        loadTerminalView({ existingWs: ws });

        // Step 4: Start the communication/prompt flow
        communicate(ws, result.deployment_id);

    } catch (error) {
        const errorMsg = error.message || "An unknown error occurred during deployment initiation.";
        updateStatusDisplay(`Exception during deployment initiation for ${deploymentType}: ${errorMsg}`, 'error');
        console.error(`Deployment initiation exception for ${deploymentType}:`, error);
        loadConsoleView({ output: `Exception during deployment: ${errorMsg}`, type: 'error' });
        cleanupPrompts(); // Ensure prompts are cleared if an error occurs here
    }
}


// --- Action Handlers ---

// Action handler for deploying a blank VM
export const handleDeployVM = requireAuthAndSubscription(
    (params) => _initiateDeploymentAndLoadTerminal(params, 'vm'),
    'deploy a vm'
);

// Action handler for deploying WordPress
export const handleDeployWordPress = requireAuthAndSubscription(
    (params) => _initiateDeploymentAndLoadTerminal(params, 'wordpress'),
    'deploy wordpress'
);

// Action handler for deploying GrapesJS
export const handleDeployGrapes = requireAuthAndSubscription(
    (params) => _initiateDeploymentAndLoadTerminal(params, 'grapes'),
    'deploy grapes'
);


// --- Communication with Backend ---

// The core logic for handling the WebSocket communication and prompting the user.
async function communicate(ws, deploymentId) {
    updateStatusDisplay(`WebSocket communication channel active for ${deploymentId}.`);
    
    let terminalLoaded = false;
    let currentlyPrompting = false;

    const terminalCancelHandler = () => {
        console.log(`[DEPLOY DEBUG] 🚫 Back button clicked - cancelling deployment ${deploymentId}`);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: "cancel_deployment",
                deployment_id: deploymentId,
                reason: "user_cancelled_via_back_button"
            }));
            updateStatusDisplay(`Deployment ${deploymentId} cancelled by user`, 'info');
        } else {
            updateStatusDisplay('Deployment cancelled but connection lost', 'warning');
        }
        unregisterBackButtonHandler('terminal');
        if (returnFromTerminal) {
            returnFromTerminal();
        } else {
            loadConsoleView();
        }
    };
    
    registerBackButtonHandler('terminal', terminalCancelHandler);

    async function handlePromptMessage(promptConfig) {
        if (currentlyPrompting) {
            console.warn("Already prompting. Ignoring new prompt:", promptConfig);
            return;
        }
        currentlyPrompting = true;
        
        const onCancel = () => {
            console.log("Prompt cancelled by user.");
            currentlyPrompting = false;
            ws.send(JSON.stringify({ type: 'answer', key: promptConfig.id, value: null }));
        };

        try {
            // Special handling for the new domain registration flow
            if (promptConfig.type === 'domain_registration') {
                const domain = await new Promise((resolve, reject) => {
                    const fullPromptConfig = {
                        ...promptConfig,
                        text: "Enter the domain name you'd like to use (e.g., example.com):",
                        type: 'domain', // This type is handled by prompt.js
                        id: 'domain_registration_prompt'
                    };
                    prompt(fullPromptConfig, (answer) => {
                        if (answer && answer.status === 'answered' && answer.value) {
                            resolve(answer.value);
                        } else {
                            reject(new Error("Domain registration was cancelled."));
                        }
                    });
                });
                ws.send(JSON.stringify({ type: 'answer', key: promptConfig.id, value: domain }));
            } else {
                // Generic prompt handling
                const answer = await prompt(promptConfig, onCancel);
                if (answer.status === 'answered') {
                    ws.send(JSON.stringify({ type: 'answer', key: promptConfig.id, value: answer.value }));
                } else {
                    onCancel(); // Handle cancellation
                }
            }
        } catch (error) {
            console.error("Error handling prompt:", error);
            onCancel(); // Treat errors as cancellations
        } finally {
            currentlyPrompting = false;
            cleanupPromptUI();
        }
    }

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            const { type, content } = data;

            switch (type) {
                case 'status':
                    handleStatusMessage(content);
                    break;
                case 'terminal':
                    handleTerminalMessage(content);
                    break;
                case 'prompt':
                    // This is the main change: we delegate to a specialized handler.
                    await handlePromptMessage(content);
                    break;
                case 'error':
                    handleErrorMessage(content);
                    break;
                case 'control':
                    handleControlMessage(content);
                    break;
                default:
                    updateStatusDisplay(`Received unknown message type: ${type}`, 'warning');
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
            updateStatusDisplay('Error processing server message.', 'error');
        }
    };

    function handleStatusMessage(content) {
        // Ensure content is a string before displaying it.
        const messageText = (typeof content === 'object' && content !== null && content.text)
            ? content.text
            : (typeof content === 'object' && content !== null) ? JSON.stringify(content) : content;
        updateStatusDisplay(messageText, 'info');
    }

    async function handleTerminalMessage(content) {
        // Always extract the text from the content object for terminal messages.
        const messageText = (typeof content === 'object' && content !== null && content.text)
            ? content.text
            : (typeof content === 'object' && content !== null) ? JSON.stringify(content) : content;

        if (!terminalLoaded) {
            updateStatusDisplay('Switching to terminal view...', 'info');
            try {
                await loadTerminalView({
                    existingWs: ws,
                    targetWebsocketPath: 'unused_since_ws_is_provided',
                    initialMessage: messageText // Pass the extracted text
                });
                terminalLoaded = true;
                // Note: The back button handler is now registered inside loadTerminalView
            } catch (error) {
                console.error("Error loading terminal view:", error);
                updateStatusDisplay(`Error loading terminal: ${error.message}`, 'error');
            }
        } else {
             // If terminal is already loaded, send the *extracted text* directly to it
            if (window.addOutputToTerminal) {
                window.addOutputToTerminal(messageText, 'terminal');
            }
        }
    }

    function handleErrorMessage(content) {
        // Ensure content is a string before displaying it.
        const messageText = (typeof content === 'object' && content !== null && content.text)
            ? content.text
            : (typeof content === 'object' && content !== null) ? JSON.stringify(content) : content;
        updateStatusDisplay(messageText, 'error');

        if (terminalLoaded && window.addOutputToTerminal) {
            window.addOutputToTerminal(`[ERROR] ${messageText}`, 'error');
        }
    }

    function handleControlMessage(content) {
        if (content === 'done' || (typeof content === 'object' && content.action === 'close_and_cleanup')) {
            updateStatusDisplay('Deployment process finished.', 'success');
            ws.close();
            cleanupPrompts();
            unregisterBackButtonHandler('terminal');
        }
    }
}

// Helper function to show messages in the menu status area (if available)
function showMenuStatus(params, message, isError = false) {
    const menuContainer = params.menuContainer; // Expect menuContainer from params passed to handlers
    if (menuContainer) {
        let statusElement = menuContainer.querySelector('#menu-status-message');
        if (!statusElement) { // Create if it doesn't exist
            statusElement = document.createElement('div');
            statusElement.id = 'menu-status-message';
            const listContainer = menuContainer.querySelector('#menu-list-container');
            if (listContainer) {
                listContainer.parentNode.insertBefore(statusElement, listContainer.nextSibling);
            }
        }
        statusElement.textContent = message;
        statusElement.className = isError ? 'menu-status-error' : 'menu-status-info';
    } else {
        console.log("Menu status update:", message);
    }
}
