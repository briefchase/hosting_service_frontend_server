// Import the API base URL
import { fetchWithAuth, API_BASE_URL } from '/static/main.js';
import { updateStatusDisplay } from '/static/pages/menu.js';

// --- Configuration ---
const GOOGLE_CLIENT_ID = "320840986458-539gugqm3d618e30s6qcottnu8goh5p1.apps.googleusercontent.com";
const GCP_SCOPES = "https://www.googleapis.com/auth/cloud-platform";

// --- Global variables ---
let codeClient = null;
let authSuccessCallback = null; // Store the success callback
let google = null; // Will be initialized by the GSI script load
let onSignInSuccessCallback = null;

// --- Core Logic ---

/**
 * Redirects the user upon successful login or 'Console' click.
 * This function might be called from multiple places (e.g., landing page console button).
 * Kept for compatibility with landing page Console button, but main auth flow uses callback.
 */
export function handleLoginSuccess(user) {
    console.log("Login success (direct redirect), redirecting to main application.", user);
    // Redirect to the root or main application page
    window.location.href = '/'; // Adjust if your main app is elsewhere (e.g., '/app')
}

/**
 * Handles the response from the backend /api/authenticate endpoint.
 * Calls the stored success callback on successful authentication.
 */
async function handleAuthResponse(response, statusContainer) {
    statusContainer.innerHTML = ''; // Clear previous status
    if (response.ok) {
        const data = await response.json();
        console.log("Backend authentication successful:", data);

        if (data.session && typeof data.session.email === 'string' && typeof data.session.token === 'string') {
            // Store the data.session object directly
            sessionStorage.setItem('currentUser', JSON.stringify(data.session));
            console.log("Stored user session in sessionStorage.currentUser:", data.session);

            if (typeof authSuccessCallback === 'function') {
                authSuccessCallback(data.session); // Pass the data.session object to the callback
            } else {
                console.error("Authentication successful, but no success callback was provided.");
                statusContainer.innerHTML = '<p style="color:green;">Authentication successful.</p>';
            }
        } else {
            console.error("Backend response is missing 'session' object or 'session.email'/'session.token'.", data);
            statusContainer.innerHTML = '<p style="color:red;">Authentication data incomplete from server.</p>';
            return; // Exit if data is incomplete
        }
    } else {
        // Handle backend authentication errors
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
 * Needs the status container element and a success callback function.
 */
export function initializeGoogleSignIn(statusContainer, successCallback) {
    // Store the success callback for later use
    authSuccessCallback = successCallback;

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

    try {
        // Initialize the Google OAuth 2.0 Code Client
        codeClient = window.google.accounts.oauth2.initCodeClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: `openid email profile ${GCP_SCOPES} https://www.googleapis.com/auth/user.phonenumbers.read`,
            ux_mode: 'popup',
            redirect_uri: 'http://localhost:8080',
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
    } catch(error) {
         console.error('Error during Google Code Client Initialization:', error);
         statusContainer.innerHTML = `<p style="color:red;">Critical Error initializing Google Sign-In. Check console.</p>`;
         codeClient = null; // Ensure client is null if init fails
    }
}

/**
 * Triggers the Google Sign-In flow.
 * Needs the status container element from the calling page.
 */
export function triggerGoogleSignIn(statusContainer) {
    if (codeClient) {
        statusContainer.innerHTML = ''; // Clear previous status/error messages
        console.log('Requesting authorization code...');
        console.log('[DEBUG] Attempting to call codeClient.requestCode()');
        codeClient.requestCode();
    } else {
        console.error("Google Code Client not initialized or initialization failed.");
        statusContainer.innerHTML = '<p style="color:red;">Error: Sign-in client failed to initialize. Please refresh.</p>';
    }
}

/**
 * Retrieves the current user session from sessionStorage.
 * @returns {object|null} The user session object {email, token} or null if not found/invalid.
 */
export function getUser() {
    try {
        const storedUserString = sessionStorage.getItem('currentUser');
        if (storedUserString) {
            const user = JSON.parse(storedUserString);
            // Ensure it has the expected properties (e.g., email and token)
            if (user && user.email && user.token) {
                return user;
            }
        }
    } catch (error) {
        console.error("Error retrieving user from sessionStorage:", error);
    }
    return null; // Return null if no valid user session is found
}

/**
 * A higher-order function that wraps an action with authentication and subscription checks.
 * @param {Function} actionFn The async function to execute if all checks pass. It will receive the `params` object.
 * @param {string} actionName A user-friendly name for the action, used in status messages (e.g., "view instances").
 * @returns {Function} An async function that takes a `params` object and executes the guarded action.
 */
export function requireAuthAndSubscription(actionFn, actionName) {
    return async function(params) {
        // Destructure all required functions and elements from params
        const { menuContainer, renderMenu, updateStatusDisplay } = params;
        
        if (!updateStatusDisplay) {
            console.error("PANIC: updateStatusDisplay was not provided to requireAuthAndSubscription. Cannot proceed.");
            // Show a native alert as a last resort because the UI is unavailable.
            alert(`A critical error occurred. The status display function is missing.`);
            return;
        }

        const user = getUser();

        // 1. Authentication Check
        if (!user) {
            updateStatusDisplay(`please sign in to ${actionName}`, 'info');
            const onLoginSuccess = () => {
                updateStatusDisplay('', 'info');
                // After login, re-attempt the guarded action.
                requireAuthAndSubscription(actionFn, actionName)(params);
            };
            const statusContainer = menuContainer.querySelector('#menu-status-message') || menuContainer;
            initializeGoogleSignIn(statusContainer, onLoginSuccess);
            triggerGoogleSignIn(statusContainer);
            return;
        }

        // 2. Subscription Check
        try {
            updateStatusDisplay("checking subscription status...", "info");
            const response = await fetchWithAuth(`${API_BASE_URL}/subscription-status`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})); // try to get error details
                throw new Error(`failed to fetch subscription status: ${errorData.error || response.statusText}`);
            }
            const subscriptionData = await response.json();

            if (subscriptionData.status !== 'active') {
                updateStatusDisplay(`active subscription required to ${actionName}.`, 'info');
                
                // Dynamically import and use Stripe to redirect to checkout
                const { initializeStripe, handleSubscribe } = await import('/static/menus/subscription.js');
                await initializeStripe();
                await handleSubscribe(); // This navigates away to Stripe
                return; // Stop execution
            }

            // 3. All checks passed, execute the original action
            updateStatusDisplay('', 'info'); // Clear status message
            await actionFn(params);

        } catch (error) {
            console.error(`Error during subscription check for ${actionName}:`, error);
            updateStatusDisplay(`unable to verify subscription: ${error.message}`, "error");
            // Optionally, render an error menu
            if (renderMenu) {
                renderMenu({
                    id: 'auth-error-menu',
                    text: 'error',
                    items: [{ text: `could not verify subscription.`, type: 'record' }, {text: 'please try again later.', type: 'record'}],
                    backTarget: 'dashboard-menu'
                });
            }
        }
    };
}

// Note: These functions are now globally accessible.
// Ensure this script is loaded before any script that uses these functions.
// Consider using JavaScript modules (import/export) for better organization in larger projects.
