import { API_BASE_URL } from '/static/main.js';
import { getUser } from '/static/scripts/authenticate.js';
import { establishWebSocketConnection } from '/static/scripts/socket.js'; // Import the new function

let ws = null;
let terminalOutput = null;
let terminalInput = null;
let currentParams = {};

function addOutput(message, type = 'info') {
    if (!terminalOutput) return;
    const line = document.createElement('div');
    line.textContent = message;
    line.className = `terminal-line terminal-${type}`;
    terminalOutput.appendChild(line);
    terminalOutput.scrollTop = terminalOutput.scrollHeight; // Auto-scroll
}

// Expose addOutput globally for use by other modules
window.addOutputToTerminal = addOutput;

// Function to update cursor position based on input text
function updateCursorPosition() {
    if (!terminalInput) return;
    
    const cursor = document.getElementById('terminal-cursor');
    if (!cursor) return;
    
    // Create a temporary span to measure text width
    const measureSpan = document.createElement('span');
    measureSpan.style.font = window.getComputedStyle(terminalInput).font;
    measureSpan.style.visibility = 'hidden';
    measureSpan.style.position = 'absolute';
    measureSpan.style.whiteSpace = 'pre';
    measureSpan.textContent = terminalInput.value;
    
    document.body.appendChild(measureSpan);
    const textWidth = measureSpan.offsetWidth;
    document.body.removeChild(measureSpan);
    
    cursor.style.left = textWidth + 'px';
}

function handleInput(event) {
    updateCursorPosition(); // Update cursor position as user types
    
    if (event.key === 'Enter' && ws && ws.readyState === WebSocket.OPEN) {
        const command = terminalInput.value;
        if (command.trim()) {
            addOutput(`${command}`, 'input'); // Echo user input without >
            ws.send(command);
            terminalInput.value = '';
            updateCursorPosition(); // Reset cursor position after clearing input
        }
    }
}

export function initializeTerminal(params) {
    console.log('Initializing terminal with params:', params);
    currentParams = params; // Store params

    terminalOutput = document.getElementById('terminal-output');
    terminalInput = document.getElementById('terminal-input');

    if (!terminalOutput || !terminalInput) {
        console.error('Terminal HTML elements not found!');
        return Promise.reject(new Error("Terminal HTML elements not found!"));
    }

    terminalInput.addEventListener('keypress', handleInput);
    terminalInput.addEventListener('input', updateCursorPosition); // Update cursor on all input changes
    terminalInput.addEventListener('keyup', updateCursorPosition); // Update cursor on keyup (for backspace, delete, etc.)
    terminalInput.disabled = true;
    terminalOutput.innerHTML = '';
    
    // Initialize cursor position
    setTimeout(updateCursorPosition, 0);

    // Define callbacks for establishWebSocketConnection or for attaching to existingWs
    const onOpen = (socketInstance, event) => {
        ws = socketInstance; // Assign to module-level ws
        addOutput(`Connected`, 'success');
        terminalInput.disabled = false;
        terminalInput.focus();
        updateCursorPosition();
        // If there was an initial message to send (e.g. from processIncomingPrompts)
        if (params.initialMessageToServer && ws && ws.readyState === WebSocket.OPEN) {
            addOutput(`${params.initialMessageToServer}`, 'input'); // Echo initial message without >
            ws.send(params.initialMessageToServer);
        }
    };

    const onMessage = (event) => {
        // Check if the message is a command to trigger processIncomingPrompt
        try {
            const messageData = JSON.parse(event.data);
            if (messageData.action === 'REQUEST_SINGLE_PROMPT') {
                console.log("[Terminal] Received REQUEST_SINGLE_PROMPT, but terminal.js doesn't handle prompts directly.");
                addOutput(`[Server instruction]: ${event.data}`, 'special');
            } else if (messageData.type === 'control' && messageData.content === 'done') {
                addOutput('✅ Process complete. The terminal is now idle.', 'success');
                // You could re-enable the input for further commands here if needed.
                terminalInput.disabled = false;
                terminalInput.focus();
                updateCursorPosition();
            } else if (typeof messageData.content !== 'undefined') {
                // New structured payloads `{type, content}` from server
                let styleType = messageData.type || 'message';
                if (styleType === 'error') styleType = 'error';
                if (styleType === 'terminal') styleType = 'terminal';
                addOutput(messageData.content, styleType);
            } else {
                // Fallback: treat raw JSON string as message
                addOutput(event.data, 'message');
            }
        } catch (e) {
            addOutput(event.data, 'message'); // Not JSON or not the expected action, treat as regular message
        }
    };

    const onError = (event) => {
        console.error('WebSocket Error (from terminal.js via callback):', event);
        addOutput(`WebSocket error: A connection issue occurred.`, 'error');
        terminalInput.disabled = true;
    };

    const onClose = (event) => {
        let closeMessage = `Connection closed (Code: ${event.code})`;
        if (event.reason) closeMessage += ` Reason: ${event.reason}`;
        if (event.code === 1006) {
            closeMessage = `Connection closed abnormally (Code: 1006). Server process might have finished or connection interrupted.`;
            if (event.reason) closeMessage += ` Reason: ${event.reason}`;
        }
        addOutput(closeMessage, 'info');
        terminalInput.disabled = true;
        // ws = null; // Handled by cleanupTerminal
    };

    const statusUpdateCallback = (statusMsg) => {
        // Just add connection status to terminal output
        if (statusMsg.startsWith("Connecting") || statusMsg.startsWith("WebSocket") || statusMsg.startsWith("Error")){
            addOutput(statusMsg, 'system');
        }
    };

    if (params.existingWs && params.existingWs.readyState === WebSocket.OPEN) {
        console.log("[Terminal] Using existing WebSocket connection.");
        ws = params.existingWs;
        
        // The existing onmessage handler from deploy.js is designed to route
        // different message types. We need to replace it with one that is
        // specific to the terminal's needs (i.e., just printing messages).
        ws.onmessage = onMessage;
        
        // Also take over the error and close handlers for terminal-specific UI updates.
        ws.onerror = onError;
        ws.onclose = onClose;
        
        // Set up terminal UI as connected and ready
        addOutput(`Connected to deployment session.`, 'success');
        terminalInput.disabled = false;
        terminalInput.focus();
        updateCursorPosition();
        
        // If there was an initial message (e.g., from a prompt response), send it.
        if (params.initialMessageToServer) {
            addOutput(`${params.initialMessageToServer}`, 'input');
            ws.send(params.initialMessageToServer);
        }
        
        return Promise.resolve(ws);
    } else if (params.existingWs) {
        console.warn("[Terminal] existingWs provided but not open. State:", params.existingWs.readyState, "Attempting new connection.");
        // Fall through to establish new connection
    }
    
    // This path is now a fallback for cases where a WS is not provided.
    if (!params.targetWebsocketPath) {
        const errorMsg = "No active WebSocket connection or target path provided.";
        addOutput(errorMsg, "error");
        return Promise.reject(new Error(errorMsg));
    }

    return establishWebSocketConnection(
        params.targetWebsocketPath, 
        onOpen, 
        onMessage, 
        onError, 
        onClose,
        statusUpdateCallback
    );
}

export function cleanupTerminal() {
    console.log('Cleaning up terminal...');
    if (ws) {
        ws.close();
        ws = null;
    }
    if (terminalInput) {
        terminalInput.removeEventListener('keypress', handleInput);
        terminalInput.removeEventListener('input', updateCursorPosition);
        terminalInput.removeEventListener('keyup', updateCursorPosition);
        terminalInput.value = '';
        terminalInput.disabled = true;
    }
    if (terminalOutput) {
        terminalOutput.innerHTML = '';
    }
    currentParams = {}; // Clear stored params
    terminalOutput = null;
    terminalInput = null;
}
