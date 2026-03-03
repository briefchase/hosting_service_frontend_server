// website/src/static/pages/terminal.js

import { API_BASE_URL } from '/static/main.js';
import { getUser } from '/static/scripts/authenticate.js';
import { establishWebSocketConnection } from '/static/scripts/socket.js'; // Import the new function
import { pushBackHandler, popBackHandler, replaceBackHandler, getStack } from '/static/scripts/back.js';
import { prompt } from '/static/pages/prompt.js';
import { positionMusicControls } from '/static/pages/landing.js';

const TERMINAL_HTML = `
<div id="terminal-container" class="terminal-container">
    <div id="terminal-output" class="terminal-output"></div>
    <div id="terminal-input-line" class="terminal-input-line">
        <span class="terminal-prompt">&gt;</span>
        <div class="terminal-input-wrapper">
            <input type="text" id="terminal-input" class="terminal-input" spellcheck="false" autocomplete="off">
            <span id="terminal-cursor" class="terminal-cursor"></span>
        </div>
    </div>
</div>
`;

let ws = null;
let terminalOutput = null;
let terminalInput = null;
let terminalInputArea = null;
let currentParams = {};
let currentTerminalAPI = null;
let terminalQueue = [];
let terminalLoading = false;

export function getTerminalAPI() {
    return currentTerminalAPI;
}

/**
 * Public entry point for sending messages to the terminal.
 * Handles automatic loading of the terminal view and message queuing.
 */
export async function handleTerminalMessage(messageText, level = 'info', ws = null) {
    // If terminal is already loaded, print immediately
    if (currentTerminalAPI) {
        currentTerminalAPI.addOutput(messageText, level);
        return;
    }

    // Buffer the message
    terminalQueue.push({ text: messageText, level });

    // If already loading, just wait
    if (terminalLoading) return;

    // Initiate terminal load
    terminalLoading = true;
    try {
        if (!ws) {
            console.error("[Terminal] Cannot load terminal without a WebSocket.");
            return;
        }

        currentTerminalAPI = await loadTerminalView({
            existingWs: ws,
            hideInput: true
        });

        // Flush the queue
        if (currentTerminalAPI) {
            while (terminalQueue.length > 0) {
                const queued = terminalQueue.shift();
                currentTerminalAPI.addOutput(queued.text, queued.level);
            }
        }
    } catch (error) {
        console.error("[Terminal] Failed to auto-load terminal:", error);
    } finally {
        terminalLoading = false;
    }
}

/**
 * Loads and displays the terminal view.
 * @param {object} [params] - Optional parameters. Can include `output` and `type` for initial message, or `existingWs` for using an existing WebSocket.
 */
export async function loadTerminalView(params = {}) {
    console.log("loadTerminalView called with params:", params);
    
    document.body.classList.add('terminal-view-active');
    document.body.classList.add('overlay-active');
    
    // Reposition music controls if they exist
    positionMusicControls();

    // Replace the current top handler (e.g. deployment confirmation) with the terminal return handler.
    // This ensures that when we exit the terminal, we don't just "go back" to the previous view,
    // but we actually trigger the cleanup and view restoration logic.
    replaceBackHandler(() => returnFromTerminal());

    const consoleContainer = document.getElementById('console-container');
    if (!consoleContainer) {
        console.error("Console container not found. Cannot load terminal view.");
        throw new Error("Console container not found.");
    }

    // Synchronously wipe and replace content
    // We use the shared clearConsoleContent to preserve static elements (like landing view)
    const { clearConsoleContent } = await import('/static/main.js');
    clearConsoleContent();
    
    // Inject terminal HTML
    consoleContainer.insertAdjacentHTML('beforeend', TERMINAL_HTML);

    // Initialize the terminal logic AFTER its HTML is in the DOM
    try {
        currentTerminalAPI = await initializeTerminal(params);
        return currentTerminalAPI;
    } catch (error) {
        console.error("Failed to initialize terminal:", error);
        throw error;
    }
}

// Function to handle returning from terminal (used by back button and site title)
export async function returnFromTerminal(params) {
    console.log("Returning from terminal view. Loading console view with params:", params);
    
    // If the terminal handler is still on the stack, pop it.
    // This handles the case where returnFromTerminal is called manually (e.g. from site title).
    // If called via back button, back.js already popped it.
    if (getStack().length > 0) {
        try { popBackHandler(); } catch (_) {}
    }

    if (currentTerminalAPI) {
        currentTerminalAPI.cleanup();
        currentTerminalAPI = null;
    }

    // Remove terminal-specific styling from the body
    document.body.classList.remove('terminal-view-active');
    document.body.classList.remove('overlay-active');
    
    // Reposition music controls for the menu view
    positionMusicControls();
    
    const { loadConsoleView } = await import('/static/main.js');
    loadConsoleView(params);
}

function addOutput(message, type = 'info') {
    if (!terminalOutput) return;

    // Map error type to terminal type for consistent white color
    const displayType = (type === 'error' || type === 'info') ? 'terminal' : type;

    const line = document.createElement('div');
    line.className = `terminal-line terminal-${displayType}`;

    line.textContent = message;

    terminalOutput.appendChild(line);
    terminalOutput.scrollTop = terminalOutput.scrollHeight; // Auto-scroll
}

// Expose addOutput globally for use by other modules
// window.addOutputToTerminal = addOutput;

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
    const isInteractive = params.interactive !== false; // Default to true

    terminalOutput = document.getElementById('terminal-output');
    terminalInput = document.getElementById('terminal-input');
    terminalInputArea = document.getElementById('terminal-input-line'); // The container for the input field

    if (!terminalOutput || !terminalInput || !terminalInputArea) {
        console.error('Terminal HTML elements not found! Make sure terminal-output, terminal-input, and terminal-input-line exist.');
        return Promise.reject(new Error("Terminal HTML elements not found!"));
    }

    // Dynamically calculate header height and set CSS custom property
    const headerContainer = document.getElementById('header-container');
    if (headerContainer) {
        const headerHeight = headerContainer.offsetHeight;
        const consoleContainer = document.getElementById('console-container');
        if (consoleContainer) {
            consoleContainer.style.setProperty('--header-height', `${headerHeight}px`);
        }
    }

    if (isInteractive) {
        terminalInput.addEventListener('keypress', handleInput);
        terminalInput.addEventListener('input', updateCursorPosition); // Update cursor on all input changes
        terminalInput.addEventListener('keyup', updateCursorPosition); // Update cursor on keyup (for backspace, delete, etc.)
    } else {
        terminalInputArea.style.display = 'none';
    }

    terminalInput.disabled = true;
    if (params.hideInput) {
        terminalInputArea.style.display = 'none';
    }
    terminalOutput.innerHTML = '';
    
    // Initialize cursor position
    setTimeout(updateCursorPosition, 0);

    if (params.existingWs && params.existingWs.readyState === WebSocket.OPEN) {
        console.log("[Terminal] Using existing WebSocket connection.");
        ws = params.existingWs;
        
        // The calling module (e.g., deploy.js) is responsible for writing all output.
        
        if (!params.hideInput) {
            terminalInput.disabled = false;
            terminalInput.focus();
        }
        updateCursorPosition();
        
        return Promise.resolve({
            addOutput,
            disableInput: () => { 
                if (terminalInput) terminalInput.disabled = true; 
                if (terminalInputArea) terminalInputArea.style.display = 'none';
            },
            enableInput: () => {
                if (!isInteractive) return;
                if (terminalInputArea) terminalInputArea.style.display = '';
                if (terminalInput) {
                    terminalInput.disabled = false;
                    terminalInput.focus();
                    updateCursorPosition();
                }
            },
            cleanup: cleanupTerminal,
            ws
        });
    } else {
        const errorMsg = "Terminal requires an active WebSocket connection.";
        addOutput(errorMsg, "error");
        return Promise.reject(new Error(errorMsg));
    }
}

export function cleanupTerminal() {
    console.log('Cleaning up terminal...');
    if (ws) {
        // Don't close the shared websocket, just remove its listeners
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
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
    terminalInputArea = null;
}

// End of terminal.js logic
