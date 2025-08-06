// --- Configuration (Copied from login.js) ---
const GOOGLE_CLIENT_ID = "320840986458-539gugqm3d618e30s6qcottnu8goh5p1.apps.googleusercontent.com";
const GCP_SCOPES = "https://www.googleapis.com/auth/cloud-platform";
// Define API_BASE_URL locally as common-menu.js is not imported
const API_BASE_URL = '/api';

// --- Global variables (Copied from login.js) ---
let codeClient = null;
let loginStatusContainer = null; // Reference to the status container element

// --- Core Logic (Adapted from login.js) ---

/**
 * Redirects the user upon successful login or 'Console' click.
 */
function handleLoginSuccess(user) {
    console.log("Login success, redirecting to main application.", user);
    // Redirect to the root or main application page
    window.location.href = '/'; // Adjust if your main app is elsewhere (e.g., '/app')
}

/**
 * Handles the response from the backend /api/authenticate endpoint.
 * (Adapted to use handleLoginSuccess for redirection)
 */
async function handleAuthResponse(response, statusContainer) {
    statusContainer.innerHTML = ''; // Clear previous status
    if (response.ok) {
        const data = await response.json();
        console.log("Backend authentication successful:", data);
        // Instead of clearing UI, call the success handler to redirect
        handleLoginSuccess(data.user);
    } else {
        // Handle backend authentication errors (same as before)
        let errorMsg = `Backend authentication failed: ${response.status}`;
        try {
            const errorData = await response.json();
            errorMsg += ` - ${errorData.error || 'Unknown error'}`;
        } catch (e) { /* Ignore */ }
        console.error(errorMsg);
        statusContainer.innerHTML = `<p style="color:red;">${errorMsg}. Please try again.</p>`;
    }
}

/**
 * Initializes the Google Sign-In code client.
 * (Adapted to use handleLoginSuccess)
 */
function initializeGoogleSignIn(statusContainer) {
     if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
        console.error("Google Identity Services library not loaded.");
        statusContainer.innerHTML = '<p style="color:red;">Error: Google Sign-In library failed to load.</p>';
        return;
    }

    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('YOUR_GOOGLE_CLIENT_ID')) {
        console.error("Google Client ID is not configured.");
        statusContainer.innerHTML = '<p style="color:red;">Error: Google Sign-In is not configured (Missing Client ID).</p>';
        return;
    }

    // Initialize the Google OAuth 2.0 Code Client
    codeClient = window.google.accounts.oauth2.initCodeClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: `openid email profile ${GCP_SCOPES}`,
        ux_mode: 'popup',
        callback: async (response) => {
            statusContainer.innerHTML = ''; // Clear status on new attempt
            console.log("Received authorization code from Google:", response.code ? response.code.substring(0, 10) + '...' : 'Error/Cancelled');
            if (response.code) {
                statusContainer.innerHTML = '<p>Authenticating with server...</p>'; // Indicate progress
                try {
                    const backendResponse = await fetch(`${API_BASE_URL}/authenticate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ authorization_code: response.code }),
                    });
                    // Pass only statusContainer, as we redirect on success now
                    await handleAuthResponse(backendResponse, statusContainer);
                } catch (error) {
                    console.error('Network or other error sending code to backend:', error);
                    statusContainer.innerHTML = '<p style="color:red;">Network error communicating with server. Please try again.</p>';
                }
            } else {
                console.error("Error receiving authorization code from Google:", response);
                 const googleError = response.error ? ` (${response.error})` : '';
                 statusContainer.innerHTML = `<p style="color:red;">Google Sign-In failed or was cancelled${googleError}.</p>`;
            }
        },
        error_callback: (error) => {
             console.error('Google Code Client Error:', error);
             statusContainer.innerHTML = `<p style="color:red;">Google Sign-In Error: ${error.type || 'Unknown error'}. Check console.</p>`;
        }
    });
    console.log('Google Code Client Initialized.');
}

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
        typeof handleLoginSuccess !== 'function' ||
        typeof triggerGoogleSignIn !== 'function') {
        console.error('Authentication functions (from authenticate.js) not found. Make sure authenticate.js is loaded before landing.js.');
        if (loginStatusContainer) loginStatusContainer.innerHTML = '<p style="color:red;">Error: Authentication script failed to load.</p>';
        return;
    }

    // Initialize Google Sign-In Client using the function from authenticate.js
    initializeGoogleSignIn(loginStatusContainer);

    // --- Add Event Listeners ---

    // Console Button Listener
    consoleButton.addEventListener('click', () => {
        console.log('Console button clicked.');
        // Call the login success handler from authenticate.js
        handleLoginSuccess({ guest: true });
    });

    console.log('Login interface initialized.');
}

// --- Entry Point ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Login page DOM loaded.");
    setupLoginInterface();
}); 