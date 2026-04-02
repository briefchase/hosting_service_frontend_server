import { fetchWithAuth } from '/js/main.js';
import { CONFIG } from '/js/config.js';
import { updateStatusDisplay, clearStatusDisplay } from '/js/pages/menu.js';
import { GCP_SCOPES, PEOPLE_PHONE_SCOPE } from '/js/scripts/scopes.js';

// --- Configuration ---
const GOOGLE_CLIENT_ID = CONFIG.GOOGLE_CLIENT_ID;
const API_BASE_URL = CONFIG.API_BASE_URL;

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

// The Ballet: Resolvers for transparently resuming paused actions
let pendingAuthResolve = null;
let pendingSubResolve = null;

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
    window.__reauthInProgress = false; // Clear re-auth state

    // Run the immediate success callback if it's configured
    if (onAuthSuccessCallback) {
        try {
            onAuthSuccessCallback(userSession);
        } catch (error) {
            console.error("Error executing onAuthSuccessCallback:", error);
        }
    }

    // The Ballet: If an action was paused awaiting auth, wake it up now.
    if (pendingAuthResolve) {
        console.log("Auth success. Resolving transparent guard.");
        
        // Pop the re-auth back handler we pushed in initiateReauthUI
        // before resolving, so the stack is clean for the resumed action.
        const { popBackHandler, getStack } = await import('/js/scripts/back.js');
        if (getStack().length > 0) {
            try { popBackHandler(); } catch (_) {}
        }

        const resolve = pendingAuthResolve;
        pendingAuthResolve = null;
        resolve(userSession);
        return; // The original action will take it from here
    }

    // Fallback for legacy flows or direct logins
    console.log("Auth success. No pending transparent guard, checking legacy pending action.");
    const pendingAction = window.pendingReauthAction;
    window.pendingReauthAction = null; 

    if (pendingAction && typeof pendingAction.actionFn === 'function') {
        console.log('Re-executing interrupted action after successful reauth');
        try {
            const executionParams = { ...pendingAction.params };
            await pendingAction.actionFn(executionParams);
        } catch (error) {
            console.error('Error re-executing pending action:', error);
            defaultAuthRedirect();
        }
    } else {
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
        // The redirect_uri must match exactly what was used to get the code.
        // We use the current origin (including port) to ensure consistency.
        const dynamicRedirectUri = window.location.origin;
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
                    updateAuthStatus(statusContainer, 'authenticating with server...', 'info'); // Indicate progress
                    try {
                        console.log('[Auth][Frontend] Posting auth code to backend with Origin:', window.location.origin);
                        const backendResponse = await fetch(`${API_BASE_URL}/authenticate`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ authorization_code: response.code, redirect_origin: window.location.origin }),
                        });
                        await handleAuthResponse(backendResponse, statusContainer);
                    } catch (error) {
                        window.__reauthInProgress = false; // Clear re-auth state
                        console.error('Network or other error sending code to backend:', error);
                        updateAuthStatus(statusContainer, 'Network error communicating with server. Please try again.', 'error');
                    }
                } else {
                    window.__reauthInProgress = false; // Clear re-auth state
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
                window.__reauthInProgress = false; // Clear re-auth state
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
 * Triggers the re-authentication flow and updates the UI.
 * Fails spectacularly if the UI cannot be initialized.
 */
export async function initiateReauthUI(params = {}) {
    // Prevent multiple concurrent reauth popups
    if (window.__reauthInProgress) {
        console.log("[Auth] Re-authentication already in progress, skipping UI trigger.");
        return;
    }
    window.__reauthInProgress = true;

    let { updateStatusDisplay: statusFn, menuContainer } = params;

    if (!statusFn) {
        // Fallback to finding the element directly
        const statusEl = document.getElementById('menu-status-message');
        if (statusEl) {
            statusFn = (msg, type) => {
                statusEl.textContent = msg;
                statusEl.className = `menu-status-message menu-status-${type}`;
            };
        }
    }

    const message = 'please sign in to continue';
    if (statusFn) {
        statusFn(message, 'info');
    } else {
        // Fallback to finding the element directly if statusFn is missing
        const statusEl = document.getElementById('menu-status-message');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = 'menu-status-message menu-status-info';
        } else {
            // If we're on the landing page or the menu isn't loaded, 
            // we don't need to fail spectacularly. The Google popup itself 
            // is a clear enough indicator that sign-in is required.
            console.log("[Auth] UI status element missing, skipping 'please sign in' message.");
        }
    }

    // Register a back button handler to cancel the re-auth flow
    const { pushBackHandler } = await import('/js/scripts/back.js');
    const { renderMenu } = await import('/js/pages/menu.js');

    const backHandler = () => {
        console.log("[Auth] Back button pressed during re-auth, cancelling.");
        window.__reauthInProgress = false;
        window.pendingReauthAction = null;
        
        // Signal cancellation to the caller (e.g. menu.js click handler)
        // This is the key to the Promise Ballet: the guard rejects, 
        // allowing the caller's finally block to clean up its own handler.
        if (params && params.reject) {
            params.reject(new Error('UserCancelled'));
        } else {
            // Fallback for direct calls
            import('/js/scripts/back.js').then(m => {
                // The Ballet: A handler must be self-consuming, but since we are in a fallback
                // that doesn't use the Promise race, we must pop manually.
                try { m.popBackHandler(); } catch (_) {}
                if (menuContainer && menuContainer.dataset.previousMenu) {
                    renderMenu(menuContainer.dataset.previousMenu);
                } else {
                    renderMenu('dashboard-menu');
                }
            });
        }
    };
    pushBackHandler(backHandler);

    // Determine where to attach the Google popup
    const isLandingPage = !!document.getElementById('landing-view-container');
    const statusContainer = isLandingPage ? null : (menuContainer?.querySelector('#menu-status-message') || document.getElementById('menu-status-message') || document.getElementById('prompt-container') || document.body);

    initializeGoogleSignIn(statusContainer);
    triggerGoogleSignIn(statusContainer);
}

/**
 * A higher-order function that wraps an action with an authentication check.
 * @param {Function} actionFn The async function to execute if authentication passes.
 * @param {string} actionName A user-friendly name for the action.
 * @returns {Function} An async function that takes a `params` object and executes the guarded action.
 */
export function requireAuth(actionFn, actionName) {
    // The Ballet: Centralized helper for triggering re-authentication.
    // Creates a promise that pauses execution until the user signs in via the popup.
    const _withReauth = async (params) => {
        const authPromise = new Promise(resolve => {
            pendingAuthResolve = resolve;
        });

        // Store the original action for legacy fallback re-execution
        if (typeof window !== 'undefined') {
            window.pendingReauthAction = { actionFn, params };
        }

        await initiateReauthUI(params);
        return await authPromise;
    };

    const guarded = async function(params) {
        let { menuContainer, updateStatusDisplay } = params || {};

        if (!updateStatusDisplay) {
            updateStatusDisplay = (message, type = 'info') => {
                console[type === 'error' ? 'error' : 'log'](`[Auth Guard] ${message}`);
            };
        }

        const user = getUser();

        // Case A: No user in session
        if (!user) {
            console.log("[Auth Guard] No user found, initiating reauth.");
            await _withReauth(params);
            // After reauth, proceed to the action
            return await actionFn(params);
        }

        // Case B: User exists, try the action (which might fail with 401)
        try {
            return await actionFn(params);
        } catch (error) {
            if (error && error.message === 'ReauthInitiated') {
                console.log("[Auth Guard] Session expired (401), initiating reauth.");
                await _withReauth(params);
                // After reauth, retry the action
                return await actionFn(params);
            }
            throw error;
        }
    };
    return guarded;
}

/**
 * A higher-order function that wraps an action with a subscription check.
 * Assumes authentication has already been verified.
 * @param {Function} actionFn The async function to execute if subscription is active.
 * @returns {Function} An async function that takes a `params` object and executes the guarded action.
 */
export function requireSubscription(actionFn) {
    return async function(params) {
        let { menuContainer, renderMenu, updateStatusDisplay, skipSubscription } = params || {};

        if (!updateStatusDisplay) {
            updateStatusDisplay = (message, type = 'info') => {
                console[type === 'error' ? 'error' : 'log'](`[Subscription Guard] ${message}`);
            };
        }

        if (skipSubscription) {
            return await actionFn(params);
        }

        updateStatusDisplay("checking subscription...", "info");
        try {
            console.log("[Subscription Guard] Fetching subscription status...");
            const response = await fetchWithAuth(`${API_BASE_URL}/subscription-status`);
            
            // If fetchWithAuth threw ReauthInitiated, this code won't run.
            // If it returned a non-ok response, handle it.
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`failed to fetch subscription status: ${errorData.error || response.statusText}`);
            }
            const subscriptionData = await response.json();
            if (subscriptionData.status !== 'active') {
                const { initializeStripe, handleSubscribe } = await import('/js/menus/subscription.js');
                
                // The Ballet: Create a promise that resolves when subscription is successful
                const subPromise = new Promise(resolve => {
                    pendingSubResolve = resolve;
                });

                try {
                    await initializeStripe();
                    
                    // Pass a custom callback to handleSubscribe so it can resolve our promise
                    // handleSubscribe will call this when checkout is complete or already active
                    await handleSubscribe(async (res) => {
                        if (pendingSubResolve) {
                            console.log("[Subscription Guard] Resolving transparent guard via callback.");
                            const resolve = pendingSubResolve;
                            pendingSubResolve = null;
                            resolve(res);
                        }
                    }, params);
                } catch (error) {
                    if (error && error.message === 'ReauthInitiated') {
                        throw error;
                    }
                    console.error("Subscription flow failed:", error);
                }
                
                // Wait for the user to complete checkout
                await subPromise;

                // Now that they are subscribed, proceed with the original action
                return await actionFn(params);
            }
            return await actionFn(params);
        } catch (error) {
            if (error && error.message === 'ReauthInitiated') {
                // Re-throw so the outer requireAuth guard can catch it and save the pending action
                throw error;
            }
            if (error && error.message === 'UserCancelled') {
                console.log("[Subscription Guard] UserCancelled caught, propagating.");
                throw error; // Let menu.js handle the transition back silently
            }
            console.error(`Error during subscription check:`, error);
            // Do not set the status display to technical internal errors like ReauthInitiated
            // Only show actual business logic errors.
            return;
        }
    };
}

/**
 * A higher-order function that wraps an action with both authentication and subscription checks.
 * @param {Function} actionFn The async function to execute if all checks pass.
 * @param {string} actionName A user-friendly name for the action.
 * @returns {Function} An async function that takes a `params` object and executes the guarded action.
 */
export function requireAuthAndSubscription(actionFn, actionName, options = {}) {
    const { skipSubscriptionCheck } = options || {};
    
    // First require authentication
    const authGuarded = requireAuth(async (params) => {
        console.log(`[Auth Guard] Auth confirmed for ${actionName}, checking subscription...`);
        // Then require subscription (if not skipped)
        if (skipSubscriptionCheck) {
            return await actionFn(params);
        }
        const subGuarded = requireSubscription(actionFn);
        // Ensure we pass the latest params to the subscription guard
        return await subGuarded(params);
    }, actionName);

    return authGuarded;
}

// Note: These functions are now globally accessible.
// Ensure this script is loaded before any script that uses these functions.
// Consider using JavaScript modules (import/export) for better organization in larger projects.
