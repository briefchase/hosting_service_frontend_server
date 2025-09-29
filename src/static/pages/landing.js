// --- Configuration (Copied from login.js) ---
const GOOGLE_CLIENT_ID = "320840986458-539gugqm3d618e30s6qcottnu8goh5p1.apps.googleusercontent.com";
// Scopes centralized in /static/scripts/scopes.js; this page doesn't directly use them.
// Define API_BASE_URL locally as common-menu.js is not imported
const API_BASE_URL = '/api';

// --- Global variables ---
let loginStatusContainer = null; // Reference to the status container element

// Authentication handlers are centralized in authenticate.js

/**
 * Main function to set up the login interface.
 * (Adapted for self-contained login.html)
 */
function setupLoginInterface() {
    const contentContainer = document.getElementById('login-content');
    loginStatusContainer = document.getElementById('login-status-message'); // Find status container
    const consoleButton = document.getElementById('console-button'); // Find existing console button

    if (!contentContainer || !loginStatusContainer || !consoleButton) { // Adjusted condition
        console.error('Required elements (#login-content, #login-status-message, #console-button) not found.'); // Adjusted error message
        if (loginStatusContainer) loginStatusContainer.innerHTML = '<p style="color:red;">Page structure error.</p>';
        return;
    }

    // Ensure authentication functions are available (loaded from authenticate.js)
    if (typeof initializeGoogleSignIn !== 'function' ||
        typeof triggerGoogleSignIn !== 'function') {
        console.error('Authentication functions (from authenticate.js) not found. Make sure authenticate.js is loaded before landing.js.');
        if (loginStatusContainer) loginStatusContainer.innerHTML = '<p style="color:red;">Error: Authentication script failed to load.</p>';
        return;
    }

    // Initialize Google Sign-In Client using the function from authenticate.js
    initializeGoogleSignIn(loginStatusContainer);

    // --- Add Event Listeners ---

    // Console Button Listener (unchanged: guest access)
    consoleButton.addEventListener('click', () => {
        console.log('Console button clicked.');
        window.location.href = '/';
    });

    console.log('Login interface initialized.');
}

// --- Entry Point ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Login page DOM loaded.");
    setupLoginInterface();
}); 