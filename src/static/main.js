// website/src/static/main.js

import { registerHandler } from './scripts/registry.js';
// Import the main menu initialization function from the common module
import { initializeMenu, renderMenu, cleanupCurrentMenu } from '/static/pages/menu.js';
import { getHandlers } from '/static/scripts/registry.js';
import { planToShowTutorial } from '/static/scripts/tutorial.js';
import { handleBackButtonClick, clearBackHandlers, pushBackHandler } from '/static/scripts/back.js';


// Import Stripe functions
import { initializeStripe } from '/static/menus/subscription.js';

// Import the Google Sign-In functions
import {
    initializeGoogleSignIn,
    triggerGoogleSignIn,
    configureAuthRedirect,
    configureAuthSuccessCallback
} from '/static/scripts/authenticate.js';

// Import updateStatusDisplay from menu.js for use in loadConsoleView
import {
    updateStatusDisplay,
    checkHeaderCollision,
    refreshHeaderButtonsForCurrentMenu,
    updateAuthState
} from '/static/pages/menu.js';

// Import rainbow utils
import { initializeRainbowText, applyRainbowEffect, applyWaveEffect } from '/static/scripts/effects.js';
export { applyRainbowEffect, applyWaveEffect };

// Import the music controls from landing.js
import { showMusicControls, hideMusicControls, positionMusicControls } from '/static/pages/landing.js';

// Import menu configurations
import '/static/menus/dashboard.js';
import '/static/menus/resources.js';

// --- Global State & Elements ---
let currentUser = null; // Stores { guest: true } or authenticated user object
let currentView = 'landing'; // Track current view: 'landing', 'menu', 'terminal', 'about'
// pendingReauthAction is now stored on window object by authenticate.js

// --- Site Mode State ---
let siteMode = 'serious'; // 'serious' or 'cat'
let backgroundUrl = ''; // To store the current background
export let dayOfYear;

// Cache essential static elements from index.html
let consoleContainer = null;
let accountButton = null;
let backButton = null;
let headerContainer = null;
let siteTitle = null; // Add variable for site title

let currentPageCleanup = null;
let currentTerminalAPI = null;

export const API_BASE_URL = 'https://api.servercult.com';

// --- Initialization ---

/**
 * Main initialization function for the application.
 */
async function initializeApp() {
    // Cache static elements from index.html
    consoleContainer = document.getElementById('console-container');
    headerContainer = document.getElementById('header-container');
    siteTitle = document.getElementById('site-title');
    backButton = document.getElementById('back-button');
    accountButton = document.getElementById('account-button');

    // Configure the auth module with the default redirect action
    configureAuthRedirect(loadConsoleView);

    // Configure the auth module with a success callback to update the UI immediately
    configureAuthSuccessCallback(() => {
        updateCurrentUserState(); // Refresh the user state in main.js
        updateAuthState(currentUser); // Push the new state to menu.js
        refreshHeaderButtonsForCurrentMenu(); // Re-render the header buttons with the new state
    });

    // Initialize Stripe.js
    await initializeStripe();

    // Set header site title to protocol + hostname
    const currentDomain = window.location.hostname;
    const currentProtocol = window.location.protocol;
    siteTitle.textContent = `${currentProtocol}//${currentDomain}`;
    console.log(`Site title set to: ${siteTitle.textContent}`);

    // Keep a consistent font for the title (no randomization)

    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now - start;
    const oneDay = 1000 * 60 * 60 * 24;
    dayOfYear = Math.floor(diff / oneDay);

    // Import action handlers to trigger their self-registration
    await Promise.all([
        import('/static/menus/deploy.js'),
        import('/static/menus/site.js'),
        import('/static/menus/machine.js'),
        import('/static/menus/domain.js'),
        import('/static/menus/usage.js'),
        import('/static/menus/subscription.js'),
        import('/static/menus/backup.js'),
        import('/static/menus/account.js')
    ]);

    // Register the service worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/static/service-worker.js')
                .then(registration => console.log('SW registered: ', registration))
                .catch(registrationError => console.log('SW registration failed: ', registrationError));
        });
    } else {
        console.log('Service Worker not supported in this browser.');
    }

    // Try to load user from sessionStorage
    updateCurrentUserState();
    console.log("Initial user state loaded:", currentUser);

    // Load background image, store it, and set initial state
    try {
        const manifestResp = await fetch('/static/resources/backgrounds/manifest.json');
        if (manifestResp.ok) {
            const files = await manifestResp.json();
            if (Array.isArray(files) && files.length > 0) {
                const chosenBg = files[dayOfYear % files.length];
                backgroundUrl = `url('/static/resources/backgrounds/${chosenBg}')`;
                // Initialize in serious mode (no background)
                document.body.style.backgroundImage = 'none';
            }
        }
    } catch (_) {}

    // Site title listener modification
    siteTitle.removeEventListener('click', siteTitle._clickHandler); // Remove previous if any
    siteTitle._clickHandler = () => { // Store handler reference for potential removal
        // In all views (menu, about, landing), go to the landing view.
        console.log(`Site title clicked while in ${currentView} view, loading landing view.`);
        loadLandingView();
    };
    siteTitle.addEventListener('click', siteTitle._clickHandler);

    // Back button listener - Attach directly to the button
    if (backButton) {
        backButton.removeEventListener('click', backButton._clickHandler);
        backButton._clickHandler = async (event) => {
            console.log("[Main] Back button clicked, delegating to back.js");
            handleBackButtonClick(event);
        };
        backButton.addEventListener('click', backButton._clickHandler);
    }

    // Add a resize listener to check for header collisions
    window.addEventListener('resize', checkHeaderCollision);

    window.addEventListener('popstate', handlePopState);

    setupMobileFixes();
}

/**
 * Sets up CSS variables and listeners to fix common mobile layout issues.
 */
function setupMobileFixes() {
    // Set CSS var for header height so overlays (prompt) can position below it
    try {
        const setHeaderVar = () => {
            const h = headerContainer.getBoundingClientRect().height || 0;
            document.documentElement.style.setProperty('--header-height', `${Math.ceil(h)}px`);
        };
        setHeaderVar();
        window.addEventListener('resize', setHeaderVar, { passive: true });
    } catch (_) {}

    try {
        // Set a CSS variable for the initial viewport height to create a stable background
        // that doesn't resize when the mobile URL bar appears/disappears.
        const setStableViewportHeight = () => {
            document.documentElement.style.setProperty('--stable-vh', `${window.innerHeight}px`);
        };
        setStableViewportHeight();
        // We do not add a resize listener, as that would defeat the purpose.
    } catch (_) {}
}


/**
 * Determines and loads the initial view based on the current URL and state.
 */
async function loadInitialView() {
    const specialPage = window.location.pathname === '/what' || window.location.pathname === '/special';

    if (specialPage) {
        // Handle the /what or /special route
        console.log("Detected /what or /special route. Loading landing view and showing prompt.");
        
        // Secret cookie for special - Await this to ensure it's set before landing view initializes
        if (window.location.pathname === '/special') {
            try {
                const cookieModule = await import('/static/scripts/cookies.js');
                cookieModule.give_secret_cookie();
            } catch (e) {
                console.error("Failed to set secret cookie:", e);
            }
        }

        // Clean the URL, then load the landing view, instructing it not to start its own timer.
        window.history.replaceState({}, document.title, "/");
        loadLandingView({ startTutorialTimer: false });
        
        // Use a small delay to ensure the view is rendered before the prompt appears
        setTimeout(async () => {
            try {
                const { showWhatPrompt } = await import('/static/scripts/what.js');
                // Wait for the prompt to be dismissed
                await showWhatPrompt();
                // Then wait 1 second before showing the tutorial
                planToShowTutorial(1000);
            } catch (error) {
                console.error("Failed to show 'what' prompt:", error);
            }
        }, 100);
    } else {
        // Standard initial load
        console.log("Initial load, always loading landing view.");
        loadLandingView(); // This will start the default 10-second timer
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM fully loaded and parsed");
    await initializeApp();
    await loadInitialView();
});

// --- View Loading Functions ---

/**
 * Loads and displays the main menu view from menu.html.
 * @param {string} [initialMenuId] - Optional menu ID to render initially.
 */
export async function loadConsoleView(param) {
    if (history.state?.view !== 'app') {
        history.pushState({ view: 'app' }, '', '#app');
    }
    // Refresh user state from sessionStorage every time the console is loaded
    updateCurrentUserState();

    currentView = 'menu';
    clearBackHandlers(); // Let the menu system manage its own handlers
    updateSiteTitleVisibility(true); // Explicitly show site title for menu views
    if (getSiteMode() === 'cat') {
        showMusicControls(); // Show music controls on console view
    } else {
        hideMusicControls();
    }

    // Cleanup landing page specifics if the cleanup function exists
    if (currentPageCleanup) {
        currentPageCleanup();
        currentPageCleanup = null;
    }

    if (!headerContainer) headerContainer = document.getElementById('header-container');
    if (!backButton) backButton = document.getElementById('back-button');
    if (!accountButton) accountButton = document.getElementById('account-button');

    if (accountButton && !accountButton.dataset.listenerAdded) {
        accountButton.dataset.listenerAdded = 'true';
        accountButton.addEventListener('click', () => {
            if (accountButton.textContent === 'authenticate') {
                const statusContainerForAuth = document.getElementById('menu-status-message') || consoleContainer.querySelector('#menu-status-message');
                if (statusContainerForAuth) {
                    initializeGoogleSignIn(statusContainerForAuth);
                    triggerGoogleSignIn(statusContainerForAuth);
                } else {
                    console.error("Critical: Could not find status message container for menu authentication.");
                    updateStatusDisplay("Cannot initiate authentication: UI element missing.", "error"); // Use the imported updateStatusDisplay
                }
            }
        });
    }

    if (!consoleContainer) {
        console.error("Console container not found. Cannot load console view.");
        return;
    }

    clearConsoleContent();
    const menuHTML = await fetchHTML('/templates/menu.html');
    consoleContainer.insertAdjacentHTML('beforeend', menuHTML);

    const menuContainerElement = consoleContainer.querySelector('#menu-container');

    if (!menuContainerElement) {
        console.error("Failed to find #menu-container within loaded menu.html");
        updateStatusDisplay("Error loading menu structure.", "error"); // Use the imported updateStatusDisplay
        return;
    }

    initializeMenu(menuContainerElement, currentUser);

    // logic for special navigation
    if (param && typeof param === 'object' && param.specialNav === 'viewSite') {
        if (param.siteId) {
            const { viewSite } = await import('/static/menus/site.js');
            await viewSite(param.siteId);
        }
        return; // Stop further processing to prevent default menu render
    }

    let initialMenuIdToRender = 'dashboard-menu'; // Default
    let onComplete = null;

    if (param) {
        if (typeof param === 'object' && param.onComplete) {
            onComplete = param.onComplete;
        }

        if (typeof param === 'string') {
            initialMenuIdToRender = param;
            console.log(`Rendering specific initial menu: ${initialMenuIdToRender}`);
            renderMenu(initialMenuIdToRender);
        } else if (typeof param === 'object' && param.menuId) {
            initialMenuIdToRender = param.menuId;
            console.log(`Rendering specific initial menu from object: ${initialMenuIdToRender}`);
            
            if (param.output && param.type) {
                // This is likely an error/status message from a previous operation
                console.log(`Displaying status message in console view: ${param.output} (Type: ${param.type})`);
                
                // Still render the menu in the background for structure
                (async () => {
                    await renderMenu(initialMenuIdToRender); 
                    // Now that the menu is rendered, update the status display
                    updateStatusDisplay(param.output, param.type); 
                })();
            } else {
                renderMenu(initialMenuIdToRender);
            }
        } else if (typeof param === 'object' && param.output && param.type) {
            // This case now handles the onComplete object without other params
            renderMenu(initialMenuIdToRender);
        }
    } else {
        // No parameter, render default menu
        renderMenu(initialMenuIdToRender);
    }
    console.log("Console view loaded and initialized.");

    // Apply special text effects after content is loaded
    initializeRainbowText();

    // Execute the onComplete callback if it exists
    if (onComplete) {
        onComplete();
    }
}

/**
 * Loads and displays the landing view from landing.html.
 */
export async function loadLandingView(options = {}) {
    history.replaceState({ view: 'landing' }, '', window.location.pathname.split('#')[0]);
    currentView = 'landing'; // Update view state to 'landing'
    clearBackHandlers(); // Ensure no handlers leak to the landing page
    
    // Cleanup any active menu polling/handlers
    if (currentPageCleanup) {
        currentPageCleanup();
        currentPageCleanup = null;
    }
    cleanupCurrentMenu();
    
    console.log("Loading landing view...");
    // Ensure essential elements are cached
    if (!consoleContainer) consoleContainer = document.getElementById('console-container');
    if (!headerContainer) headerContainer = document.getElementById('header-container');
    if (!backButton) backButton = document.getElementById('back-button');
    if (!accountButton) accountButton = document.getElementById('account-button');

    // --- Start: Hide header buttons ---
    updateSiteTitleVisibility(true); // Show site title on landing
    updateAccountButtonVisibility(false); // Hide account button on landing
    if (backButton) {
        backButton.style.display = 'none';
        delete backButton.dataset.targetMenu; // Clear any nav data
    }
    // --- End: Hide header buttons ---

    if (!consoleContainer) return; // Console container needed for content

    clearConsoleContent(); // Clear previous content (menu, etc.)
    
    // Show the pre-rendered landing view content
    const landingView = document.getElementById('landing-view-container');
    if (landingView) landingView.style.display = 'flex';
    const footerView = document.querySelector('.footer-container');
    if (footerView) footerView.style.display = 'block';


    // Setup listeners for the now-visible landing elements
    setupLandingViewListeners();

    const landingModule = await import('/static/pages/landing.js');
    landingModule.initialize(dayOfYear, options); // Pass options through here
    currentPageCleanup = landingModule.cleanup;

    // Apply special text effects after content is loaded
    initializeRainbowText();

    console.log("Landing view loaded and listeners attached.");
}

export function getSiteMode() {
    return siteMode;
}

export function setSiteMode(newMode) {
    if (newMode === siteMode) return;

    siteMode = newMode;
    console.log(`Site mode changed to: ${siteMode}`);

    if (siteMode === 'serious') {
        document.body.style.backgroundImage = 'none';
    } else {
        document.body.style.backgroundImage = backgroundUrl;
    }

    // Dispatch an event to notify other modules (like landing.js) of the change
    window.dispatchEvent(new CustomEvent('modechange', { detail: { mode: siteMode } }));
}

function handlePopState(event) {
    const state = event.state;
    // Determine the target view from the state. Default to landing.
    const targetView = (state && state.view === 'app') ? 'app' : 'landing';

    // Determine current view category
    const currentViewCategory = (currentView === 'landing') ? 'landing' : 'app';

    if (targetView === currentViewCategory) {
        // We are already displaying the correct category of view.
        // This might happen with forward/back inside the same state.
        return;
    }

    if (targetView === 'app') {
        loadConsoleView();
    } else { // targetView is 'landing'
        loadLandingView();
    }
}

// --- Utility Functions ---

/**
 * Updates the global currentUser state by reading from sessionStorage.
 */
function updateCurrentUserState() {
    const storedUserString = sessionStorage.getItem('currentUser');
    if (storedUserString) {
        try {
            const potentialUser = JSON.parse(storedUserString);
            // Check if the stored user has a token (implies valid authenticated session)
            if (potentialUser && potentialUser.token) {
                currentUser = potentialUser;
            } else {
                // Stored user is incomplete or guest, treat as no active session
                sessionStorage.removeItem('currentUser'); // Clear incomplete/guest session
                currentUser = null;
            }
        } catch (e) {
            console.error("Error parsing stored user from sessionStorage:", e);
            sessionStorage.removeItem('currentUser'); // Clear corrupted data
            currentUser = null;
        }
    } else {
        currentUser = null;
    }
}

/**
 * Helper function to make authenticated API calls.
 * Retrieves the session token from sessionStorage and adds it to the Authorization header.
 * @param {string} url - The URL to fetch from.
 * @param {object} options - Fetch options (method, headers, body, etc.).
 * @returns {Promise<Response>} - Promise resolving to the Fetch API Response object.
 */
export async function fetchWithAuth(url, options = {}) {
    const storedUserString = sessionStorage.getItem('currentUser');
    let token = null;
    if (storedUserString) {
        try {
            const storedUser = JSON.parse(storedUserString);
            if (storedUser && storedUser.token) {
                token = storedUser.token;
            }
        } catch (e) {
            console.error("Error parsing stored user for token:", e);
        }
    }
    const headers = { ...options.headers }; // Copy existing headers

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    // Ensure Content-Type is set for POST/PUT requests if a body is present
    if (options.body && !headers['Content-Type'] && typeof options.body === 'object') {
        headers['Content-Type'] = 'application/json';
        // Stringify body if it's an object and Content-Type is application/json
        options.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (response.status === 401) {
        // Unauthorized: Token invalid/expired. 
        // We clear the session and throw ReauthInitiated.
        // We DO NOT trigger the UI here; we let the high-level guards (requireAuth)
        // handle saving the pending action and triggering the UI.
        console.warn("Received 401 Unauthorized. Clearing session and signaling re-authentication.");
        try { sessionStorage.removeItem('currentUser'); } catch (_) {}
        currentUser = null;
        
        // Signal to callers that reauth is needed.
        throw new Error('ReauthInitiated');
    }
    return response;
}

/**
 * Fetches HTML content from a given URL.
 * @param {string} url - The URL to fetch HTML from.
 * @returns {Promise<string>} - Promise resolving to the HTML text.
 */
async function fetchHTML(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        console.error(`Error fetching HTML from ${url}:`, error);
        return `<p style="color:red;">Error loading component: ${error.message}</p>`; // Return error message HTML
    }
}

/**
 * Clears the content of the main console area.
 */
function clearConsoleContent() {
    if (!consoleContainer || !headerContainer) {
        console.error("clearConsoleContent called before essential containers were cached.");
        return;
    }

    // Hide the pre-rendered landing view content instead of removing it
    const landingView = document.getElementById('landing-view-container');
    if (landingView) landingView.style.display = 'none';
    const footerView = document.querySelector('.footer-container');
    if (footerView) footerView.style.display = 'none';


    // Remove all children of consoleContainer EXCEPT the headerContainer and pre-rendered elements
    const spotifyWrapper = document.getElementById('spotify-embed-wrapper');
    const modeToggle = document.getElementById('mode-toggle-container');
    const hostingTagline = document.getElementById('hosting-tagline');
    const elementsToKeep = [headerContainer, landingView, footerView, spotifyWrapper, modeToggle, hostingTagline];
    let child = consoleContainer.lastChild;
    while (child) {
        let nextChild = child.previousSibling;
        if (!elementsToKeep.includes(child)) {
            consoleContainer.removeChild(child);
        }
        child = nextChild;
    }
}

// --- UI State Management ---

export function updateSiteTitleVisibility(isVisible) {
    if (siteTitle) {
        // Use a boolean check to determine visibility.
        siteTitle.style.visibility = isVisible ? 'visible' : 'hidden';
    }
}

export function updateAccountButtonVisibility(isVisible, isAuthenticated = false) {
    if (accountButton) {
        if (isVisible) {
            accountButton.style.display = 'inline-block';
            accountButton.style.visibility = 'visible';
            // Update text and data attribute based on authentication status.
            if (isAuthenticated) {
                accountButton.textContent = 'account';
                accountButton.dataset.targetMenu = 'account-menu';
            } else {
                accountButton.textContent = 'authenticate';
                delete accountButton.dataset.targetMenu;
            }
        } else {
            accountButton.style.display = 'none';
        }
    }
}


/**
 * Adds event listeners for the dynamically loaded landing view.
 */
function setupLandingViewListeners() {
    const consoleButton = document.getElementById('console-button');
    const aboutButton = document.getElementById('about-button'); // Get the about button

    if (consoleButton) {
        consoleButton.addEventListener('click', handleConsoleButtonClick);
    }
    if (aboutButton) { // Add listener for about button
        aboutButton.addEventListener('click', loadAboutView);
    }

    // Note: Authentication is not possible from the landing page
}

// --- Action Handlers ---

/**
 * Handles the click on the 'console'
 */
function handleConsoleButtonClick() {
    console.log('Console button clicked on landing page, loading console view.');
    // currentUser will be null if the landing page was loaded due to no active session.
    // loadConsoleView will handle this state and present authentication options within the menu.
    loadConsoleView();
}

/**
 * Handles the logout action (called from account menu usually). NOTE: Should be moved to authenticate
 */
const handleLogout = async () => {
    console.log("Logging out...");

    // Attempt to log out on the server.
    try {
        await fetchWithAuth(`${API_BASE_URL}/logout`, { 
            method: 'POST',
            suppressReauth: true // Add this option to prevent re-authentication on 401
        });
        console.log("Successfully logged out on the server.");
    } catch (error) {
        // The fetchWithAuth will throw an error on 401, which we want to ignore here.
        // We also ignore other network errors, as the goal is simply to log out the frontend.
        if (error.message === 'ReauthSuppressed') {
            console.log("Server session was already invalid. Proceeding with local logout.");
        } else {
            console.warn("Server logout call failed, but proceeding with local logout. Error:", error);
        }
    }

    // Always perform local logout actions regardless of server response.
    console.log("Performing local session cleanup and redirecting to landing view.");
    sessionStorage.removeItem('currentUser');
    currentUser = null; 
    loadLandingView(); 
};

// Register the logout handler
registerHandler('handleLogout', handleLogout);
