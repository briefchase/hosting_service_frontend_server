import { API_BASE_URL } from '/static/main.js';
import { getUser } from '/static/scripts/authenticate.js';
import { establishWebSocketConnection } from '/static/scripts/socket.js'; // Import the new function
import { unregisterBackButtonHandler } from '/static/main.js';

let ws = null;
let terminalOutput = null;
let terminalInput = null;
let terminalInputArea = null;
let currentParams = {};

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
    terminalInputArea = null;

    // Unregister terminal back button handler
    unregisterBackButtonHandler();
}
