// Import the API base URL
import { fetchWithAuth, API_BASE_URL } from '/static/main.js';
import { updateStatusDisplay, clearStatusDisplay } from '/static/pages/menu.js';
import { GCP_SCOPES, PEOPLE_PHONE_SCOPE } from '/static/scripts/scopes.js';

// --- Configuration ---
const GOOGLE_CLIENT_ID = "320840986458-539gugqm3d618e30s6qcottnu8goh5p1.apps.googleusercontent.com";

// --- Helper for status updates ---
function updateAuthStatus(container, message, type = 'info') {
    const colorMap = {
        error: 'red',
        success: 'green',
        info: 'inherit'
    };
    const color = colorMap[type] || 'inherit';

    if (container) {
        if (message) {
            container.innerHTML = `<p style="color:${color};">${message.replace(/\n/g, '<br>')}</p>`;
        } else {
            container.innerHTML = '';
        }
    } else {
        if (message) {
            if (type === 'error') {
                console.error(`[Auth Status] ${message}`);
            } else {
                console.log(`[Auth Status] ${message}`);
            }
        }
    }
}

// --- Global variables ---
let codeClient = null;
let google = null; // Will be initialized by the GSI script load
let defaultAuthRedirect = () => {
    console.warn("Default auth redirect not configured. User will not be redirected after login.");
};
let onAuthSuccessCallback = null; // New callback

/**
 * Called from the main application entry point to configure the default
 * action after a successful login when no other action is pending.
 * @param {Function} redirectFn The function to call, e.g., loadConsoleView.
 */
export function configureAuthRedirect(redirectFn) {
    if (typeof redirectFn === 'function') {
        defaultAuthRedirect = redirectFn;
    }
}

/**
 * Called from the main application entry point to configure a callback
 * that runs immediately on successful authentication, before any redirect.
 * @param {Function} callbackFn The function to call.
 */
export function configureAuthSuccessCallback(callbackFn) {
    if (typeof callbackFn === 'function') {
        onAuthSuccessCallback = callbackFn;
    }
}

/**
 * Central handler for successful authentication.
 * Checks for a pending action (e.g., from a checkout flow) and executes it.
 * Otherwise, falls back to the default redirect.
 * @param {object} userSession The user session object from the backend.
 */
async function handleAuthenticationSuccess(userSession) {
    // Run the immediate success callback if it's configured
    if (onAuthSuccessCallback) {
        try {
            onAuthSuccessCallback(userSession);
        } catch (error) {
            console.error("Error executing onAuthSuccessCallback:", error);
        }
    }

    // This is now the single source of truth for post-auth actions.
    console.log("Auth success. Checking for pending action:", window.pendingReauthAction);
    const pendingAction = window.pendingReauthAction;
    window.pendingReauthAction = null; // Clear immediately

    if (pendingAction && typeof pendingAction.actionFn === 'function') {
        console.log('Re-executing interrupted action after successful reauth');
        try {
            // Re-execute the stored action.
            await pendingAction.actionFn(pendingAction.params);
        } catch (error) {
            console.error('Error re-executing pending action:', error);
            // Fall back to default redirect if the pending action fails
            defaultAuthRedirect();
        }
    } else {
        // No pending action, perform the default redirect
        defaultAuthRedirect();
    }
}

/**
 * Clears any pending action that was stored for re-execution after authentication.
 * This should be called when the user cancels an auth flow.
 */
export function clearPendingReauthAction() {
    if (window.pendingReauthAction) {
        console.log("Clearing pending re-authentication action.");
        window.pendingReauthAction = null;
    }
}


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
    updateAuthStatus(statusContainer, ''); // Clear previous status
    
    if (!response.ok) {
        // Handle all non-successful responses
        let errorMsg = `Backend authentication failed: ${response.status}`;
        try {
            const errorData = await response.json();
            const details = errorData.details || '';
            errorMsg += ` - ${errorData.error || 'Unknown error'}` + (details ? `\nDetails: ${details}` : '');
        } catch (e) {
            // Fallback if the error response isn't valid JSON
            const text = await response.text().catch(() => '');
            if (text) errorMsg += ` - ${text}`;
        }
        console.error(errorMsg);
        updateAuthStatus(statusContainer, errorMsg, 'error');
        return;
    }

    // Handle successful response
    try {
        const data = await response.json();
        const { session } = data;

        if (session && typeof session.email === 'string' && typeof session.token === 'string') {
            console.log("Backend authentication successful:", data);
            sessionStorage.setItem('currentUser', JSON.stringify(session));
            console.log("Stored user session in sessionStorage.currentUser:", session);
            await handleAuthenticationSuccess(session);
        } else {
            throw new Error("Authentication data incomplete from server.");
        }
    } catch (error) {
        console.error("Error processing successful authentication response:", error);
        updateAuthStatus(statusContainer, `Error: ${error.message}`, 'error');
    }
}

/**
 * Initializes the Google Sign-In code client.
 * Needs the status container element and a success callback function.
 */
export function initializeGoogleSignIn(statusContainer) {
    // This function no longer accepts a `successCallback`.
    // It always uses the internal `handleAuthenticationSuccess`.

     if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
        console.error("Google Identity Services library not loaded.");
        updateAuthStatus(statusContainer, 'Error: Google Sign-In library failed to load.', 'error');
        return;
    }

    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('YOUR_GOOGLE_CLIENT_ID')) {
        console.error("Google Client ID is not configured.");
        updateAuthStatus(statusContainer, 'Error: Google Sign-In is not configured (Missing Client ID).', 'error');
        return;
    }

    try {
        // Initialize the Google OAuth 2.0 Code Client
        const dynamicRedirectUri = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:8080'
            : window.location.origin;
        console.log('[Auth][Frontend] Using redirect_uri for Google Code flow:', dynamicRedirectUri);
        console.log('[Auth][Frontend] API endpoint for auth:', `${API_BASE_URL}/authenticate`);

        codeClient = window.google.accounts.oauth2.initCodeClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: `openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile ${GCP_SCOPES} ${PEOPLE_PHONE_SCOPE}`,
            prompt: 'consent',
            ux_mode: 'popup',
            redirect_uri: dynamicRedirectUri,
            callback: async (response) => {
                updateAuthStatus(statusContainer, ''); // Clear status on new attempt
                console.log("Received authorization code from Google:", response.code ? response.code.substring(0, 10) + '...' : 'Error/Cancelled');
                if (response.code) {
                    updateAuthStatus(statusContainer, 'Authenticating with server...', 'info'); // Indicate progress
                    try {
                        console.log('[Auth][Frontend] Posting auth code to backend with Origin:', window.location.origin);
                        const backendResponse = await fetch(`${API_BASE_URL}/authenticate`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ authorization_code: response.code, redirect_origin: window.location.origin }),
                        });
                        await handleAuthResponse(backendResponse, statusContainer);
                    } catch (error) {
                        console.error('Network or other error sending code to backend:', error);
                        updateAuthStatus(statusContainer, 'Network error communicating with server. Please try again.', 'error');
                    }
                } else {
                    // Handle user closing the popup gracefully
                    if (response.error === 'popup_closed' || response.error === 'popup_closed_by_user') {
                        console.log('Google Sign-In popup closed by user.');
                        updateAuthStatus(statusContainer, 'Sign-in cancelled.', 'info');
                    } else {
                        console.error("Error receiving authorization code from Google:", response);
                        const googleError = response.error ? ` (${response.error})` : '';
                        updateAuthStatus(statusContainer, `Google Sign-In failed or was cancelled${googleError}.`, 'error');
                    }
                }
            },
            error_callback: (error) => {
                // Don't show an error if the user closed the popup
                if (error.type === 'popup_closed') {
                    console.log('Google Sign-In popup closed by user.');
                    updateAuthStatus(statusContainer, 'Sign-in cancelled.', 'info');
                    return;
                }
                console.error('Google Code Client Error:', error);
                updateAuthStatus(statusContainer, `Google Sign-In Error: ${error.type || 'Unknown error'}. Check console.`, 'error');
            }
        });
        console.log('Google Code Client Initialized.');
    } catch(error) {
         console.error('Error during Google Code Client Initialization:', error);
         updateAuthStatus(statusContainer, 'Critical Error initializing Google Sign-In. Check console.', 'error');
         codeClient = null; // Ensure client is null if init fails
    }
}

/**
 * Triggers the Google Sign-In flow.
 * Needs the status container element from the calling page.
 */
export function triggerGoogleSignIn(statusContainer) {
    if (codeClient) {
        // updateAuthStatus(statusContainer, ''); // This was too aggressive, clearing the "please sign in" message.
        console.log('Requesting authorization code...');
        console.log('[DEBUG] Attempting to call codeClient.requestCode()');
        codeClient.requestCode();
    } else {
        console.error("Google Code Client not initialized or initialization failed.");
        updateAuthStatus(statusContainer, 'Error: Sign-in client failed to initialize. Please refresh.', 'error');
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
 * @param {string} actionName A user-friendly name for the action, used in status messages (e.g., "view sites").
 * @returns {Function} An async function that takes a `params` object and executes the guarded action.
 */
export function requireAuthAndSubscription(actionFn, actionName, options = {}) {
    const { skipSubscriptionCheck } = options || {};

    // DRY helper for triggering a re-authentication flow. It is self-contained.
    const _initiateReauth = (guardedFn, params) => {
        const { updateStatusDisplay } = params || {};
        
        // Use a consistent message for both initial sign-in and re-auth.
        const message = 'please sign in to continue';
        if (updateStatusDisplay) {
            updateStatusDisplay(message, 'info');
        }

        // Store the original action for re-execution after successful auth (only if not already set)
        if (typeof window !== 'undefined' && !window.pendingReauthAction) {
            window.pendingReauthAction = { actionFn: guardedFn, params };
        }
    };

    const guarded = async function(params) {
        // Destructure all required functions and elements from params
        let { menuContainer, renderMenu, updateStatusDisplay, skipSubscription } = params || {};

        if (!updateStatusDisplay) {
            // Fallback for when no UI status updater is provided.
            updateStatusDisplay = (message, type = 'info') => {
                console[type === 'error' ? 'error' : 'log'](`[Auth Guard] ${message}`);
            };
        }

        const user = getUser();

        // 1. Authentication Check
        if (!user) {
            _initiateReauth(guarded, params);
            
            const isLandingPage = !!document.getElementById('landing-view-container');
            let statusContainer = isLandingPage ? null : (menuContainer?.querySelector('#menu-status-message') || menuContainer || document.getElementById('prompt-container') || document.body);

            initializeGoogleSignIn(statusContainer);
            triggerGoogleSignIn(statusContainer);
            return;
        }

        try {
            // 2. Subscription Check (conditional)
            if (!skipSubscription && !skipSubscriptionCheck) {
                updateStatusDisplay("checking subscription...", "info");
                const response = await fetchWithAuth(`${API_BASE_URL}/subscription-status`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(`failed to fetch subscription status: ${errorData.error || response.statusText}`);
                }
                const subscriptionData = await response.json();
                if (subscriptionData.status !== 'active') {
                    updateStatusDisplay(`active subscription required to ${actionName}.`, 'info');
                    const { initializeStripe, handleSubscribe } = await import('/static/menus/subscription.js');
                    const { updateBackButtonHandler, unregisterBackButtonHandler } = await import('/static/main.js');
                    const { cancelCurrentPrompt } = await import('/static/pages/prompt.js');
                    const backHandler = () => cancelCurrentPrompt();
                    updateBackButtonHandler(backHandler);
                    try {
                        await initializeStripe();
                        await handleSubscribe();
                    } finally {
                        unregisterBackButtonHandler();
                    }
                    return;
                }
            }

            // 4. All checks passed, execute the original action
            await actionFn(params);

        } catch (error) {
            console.error(`Error during guarded action for ${actionName}:`, error);
            if (error && error.message === 'ReauthInitiated') {
                _initiateReauth(guarded, params);
                return;
            }
            
            updateStatusDisplay(`unable to verify subscription: ${error.message}`, "error");
            if (renderMenu) {
                renderMenu({
                    id: 'auth-error-menu',
                    text: 'error',
                    items: [{ text: `could not verify subscription.`, type: 'record' }, {text: 'please try again later.', type: 'record'}],
                    backTarget: 'dashboard-menu'
                });
            }
            return;
        }
    };
    return guarded;
}

// Note: These functions are now globally accessible.
// Ensure this script is loaded before any script that uses these functions.
// Consider using JavaScript modules (import/export) for better organization in larger projects.
