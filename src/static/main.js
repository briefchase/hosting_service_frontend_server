// website/src/static/main.js

// Define the base API URL here
export const API_BASE_URL = 'https://api.servercult.com';

// Import the main menu initialization function from the common module
import { initializeMenu, renderMenu, cleanupCurrentMenu } from '/static/pages/menu.js';

// Import the Google Sign-In functions
import {
    initializeGoogleSignIn,
    triggerGoogleSignIn,
    configureAuthRedirect,
    configureAuthSuccessCallback
} from '/static/scripts/authenticate.js';

// Import Stripe functions
import { initializeStripe, handleSubscribe } from '/static/menus/subscription.js';

// Import Terminal functions
import { initializeTerminal, cleanupTerminal } from '/static/pages/terminal.js';
import { initializeRainbowText } from '/static/scripts/utils.js';


// Import updateStatusDisplay from menu.js for use in loadConsoleView
import {
    updateStatusDisplay,
    checkHeaderCollision,
    refreshHeaderButtonsForCurrentMenu,
    updateAuthState
} from '/static/pages/menu.js';

// Import the music controls from landing.js
import { showMusicControls, hideMusicControls, positionMusicControls } from '/static/pages/landing.js';

// --- Import Menu Configurations ---
// These self-register with common.js
import '/static/menus/dashboard.js';
import '/static/menus/deploy.js';
import '/static/menus/account.js';
import '/static/menus/resources.js';
import '/static/menus/domain.js';
import '/static/menus/usage.js';
import '/static/menus/firewall.js';
import '/static/menus/site.js';
import '/static/menus/backup.js'; // <-- Add import for backup.js
import '/static/menus/subscription.js';
import '/static/menus/machine.js';
// --- End Menu Imports ---


// --- Global State & Elements ---
let currentUser = null; // Stores { guest: true } or authenticated user object
let actionHandlers = {}; // To be populated in DOMContentLoaded
let currentView = 'landing'; // Track current view: 'landing', 'menu', 'terminal', 'about'
let terminalReturnParams = null; // Store params for returning from terminal
// pendingReauthAction is now stored on window object by authenticate.js

// --- Site Mode State ---
let siteMode = 'serious'; // 'serious' or 'cat'
let backgroundUrl = ''; // To store the current background
export let dayOfYear;

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

// Global back button state management
let backButtonHandler = null;

// Cache essential static elements from index.html
let consoleContainer = null;
let accountButton = null;
let backButton = null;
let headerContainer = null;
let siteTitle = null; // Add variable for site title

let currentPageCleanup = null;
let currentTerminalAPI = null;

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
        // If the caller has requested to suppress re-authentication, just throw the error.
        if (options.suppressReauth) {
            throw new Error('ReauthSuppressed');
        }

        // Unauthorized: Token invalid/expired. Silently re-initiate authentication globally.
        console.warn("Received 401 Unauthorized. Clearing session and re-initiating authentication.");
        try { sessionStorage.removeItem('currentUser'); } catch (_) {}
        currentUser = null;
        // Prevent multiple concurrent reauth popups
        if (!window.__reauthInProgress) {
            window.__reauthInProgress = true;
            try {
                const statusContainer = currentView === 'landing'
                    ? null
                    : document.getElementById('menu-status-message')
                        || document.getElementById('console-container')
                        || document.body;
                initializeGoogleSignIn(statusContainer);
                triggerGoogleSignIn(statusContainer);
            } catch (e) {
                console.error('Failed to trigger re-authentication flow:', e);
            }
        }
        // Signal to callers that reauth has begun; callers should avoid user-facing errors
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


// --- View Loading Functions ---

/**
 * Loads and displays the landing view from landing.html.
 */
async function loadLandingView() {
    currentView = 'landing'; // Update view state to 'landing'
    terminalReturnParams = null; // Clear return params
    unregisterBackButtonHandler(); // Clear any existing handler
    
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
    landingModule.initialize(dayOfYear);
    currentPageCleanup = landingModule.cleanup;

    // Apply special text effects after content is loaded
    initializeRainbowText();

    console.log("Landing view loaded and listeners attached.");
}

/**
 * Loads and displays the main menu view from menu.html.
 * @param {string} [initialMenuId] - Optional menu ID to render initially.
 */
export async function loadConsoleView(param) {
    // Refresh user state from sessionStorage every time the console is loaded
    updateCurrentUserState();

    currentView = 'menu';
    terminalReturnParams = null;
    unregisterBackButtonHandler(); // Clear any existing handler
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

    initializeMenu(menuContainerElement, actionHandlers, currentUser);

    // --- Start: New logic for special navigation ---
    if (param && typeof param === 'object' && param.specialNav === 'viewSite') {
        if (param.siteId) {
            const { viewSite } = await import('/static/menus/site.js');
            await viewSite(param.siteId);
        }
        return; // Stop further processing to prevent default menu render
    }
    // --- End: New logic ---

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
        } else if (typeof param === 'object' && param.output && param.type) {
            // This is likely an error/status message from a previous operation
            console.log(`Displaying status message in console view: ${param.output} (Type: ${param.type})`);
            updateStatusDisplay(param.output, param.type); // Use the imported updateStatusDisplay
            // Still render the menu in the background for structure
            renderMenu(param.menuId || initialMenuIdToRender); 
        } else {
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
 * Loads and displays the terminal view.
 * @param {object} [params] - Optional parameters. Can include `output` and `type` for initial message, or `existingWs` for using an existing WebSocket.
 */
export async function loadTerminalView(params = {}) {
    console.log("loadTerminalView called with params:", params);
    currentView = 'terminal'; // Set current view state
    document.body.classList.add('terminal-view-active');
    document.body.classList.add('overlay-active');
    try { positionMusicControls(); } catch (_) {} // Reposition music controls for terminal view
    terminalReturnParams = { view: 'menu' }; // Default return to menu

    // Cleanup any active menu polling/handlers
    if (currentPageCleanup) {
        currentPageCleanup();
        currentPageCleanup = null;
    }
    cleanupCurrentMenu();

    const consoleContainer = document.getElementById('console-container');
    const headerContainer = document.getElementById('header-container');
    const promptContainer = document.getElementById('prompt-container');
    const mainContent = document.getElementById('main-content');

    if (!consoleContainer) {
        console.error("Critical: #console-container not found in DOM for loadTerminalView.");
        return Promise.reject(new Error("#console-container not found"));
    }

    // Ensure terminal HTML is loaded first
    // Clear previous content from console-container, preserving landing page elements
    clearConsoleContent();
    const terminalHTML = await fetchHTML('/templates/terminal.html');
    consoleContainer.insertAdjacentHTML('beforeend', terminalHTML);
    console.log("Terminal HTML loaded into console-container.");

    if (promptContainer) promptContainer.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
    
    // Hide account button, but keep header visible for back button
    updateAccountButtonVisibility(false);

    // Header/back visibility is tied to handler registration now
    if (headerContainer) headerContainer.style.display = 'flex';
    document.body.classList.add('terminal-view-active');
    document.body.classList.add('overlay-active');

    const terminalParams = { ...params };
    delete terminalParams.initialMessageToServer;

    // Initialize the terminal logic AFTER its HTML is in the DOM
    // Pass the params object which may contain output or an existing WebSocket
    try {
        // Initialize the terminal and store its API object
        currentTerminalAPI = await initializeTerminal(params);
        // The caller is now responsible for handling all output, including initial messages.
        return currentTerminalAPI;
    } catch (error) {
        console.error("Failed to initialize terminal:", error);
        // Try to display an error in the terminal UI itself as a fallback
        const outputArea = document.getElementById('terminal-output');
        if (outputArea) {
            outputArea.innerHTML = `<div class="terminal-line terminal-terminal">Critical Error: Could not initialize terminal. ${error.message}</div>`;
        }
        // Re-throw the error so the calling function can handle it gracefully
        throw error;
    }
}

// Function to handle returning from terminal (used by back button and site title)
export function returnFromTerminal(params) {
    console.log("Returning from terminal view. Loading console view with params:", params);
    if (currentTerminalAPI) {
        currentTerminalAPI.cleanup();
        currentTerminalAPI = null;
    }
    cleanupTerminal(); // Clean up any terminal-specific resources or intervals

    // Restore visibility of main content containers that were hidden for terminal view
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.style.display = ''; // Reset to default display
    const promptContainer = document.getElementById('prompt-container');
    if (promptContainer) promptContainer.style.display = ''; // Reset to default display

    // Remove terminal-specific styling from the body
    document.body.classList.remove('terminal-view-active');
    document.body.classList.remove('overlay-active');
    try { positionMusicControls(); } catch (_) {} // Reposition music controls for menu view

    const menuTitleElement = document.getElementById('menu-text');
    if (menuTitleElement && menuTitleElement.classList.contains('rainbow-text')) {
        menuTitleElement.classList.remove('rainbow-text');
    }

    loadConsoleView(params);
}

/**
 * Loads and displays the About view from about.html.
 */
async function loadAboutView() {
    currentView = 'about'; // Update view state
    terminalReturnParams = null; // Clear terminal params
    
    // Cleanup any active menu polling/handlers
    if (currentPageCleanup) {
        currentPageCleanup();
        currentPageCleanup = null;
    }
    cleanupCurrentMenu();
    
    console.log("Loading about view...");

    // Ensure essential elements are cached
    if (!consoleContainer) consoleContainer = document.getElementById('console-container');
    if (!headerContainer) headerContainer = document.getElementById('header-container');
    if (!backButton) backButton = document.getElementById('back-button');
    if (!accountButton) accountButton = document.getElementById('account-button');

    // Back button visibility tied to handler registration
    try {
        updateBackButtonHandler(() => {
            unregisterBackButtonHandler();
            loadLandingView();
        });
    } catch (_) {}

    if (!consoleContainer) return;

    clearConsoleContent(); // Clear previous content
    const aboutHTML = await fetchHTML('/templates/about.html');
    consoleContainer.insertAdjacentHTML('beforeend', aboutHTML);

    console.log("About view loaded.");
}

// --- Action Handlers ---

/**
 * Handles the click on the 'console' (guest access) button.
 */
function handleConsoleButtonClick() {
    console.log('Console button clicked on landing page, loading console view.');
    // currentUser will be null if the landing page was loaded due to no active session.
    // loadConsoleView will handle this state and present authentication options within the menu.
    loadConsoleView();
}

/**
 * Handles the logout action (called from account menu usually).
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

// --- Back Button Management ---

/**
 * Registers a cancellation handler for the current operation
 * @param {function} handler - Function to call when back button is pressed
 */
export function updateBackButtonHandler(handler) {
    backButtonHandler = handler;
    const backButton = document.getElementById('back-button');
    if (backButton) {
        backButton.style.display = 'inline-block';
        delete backButton.dataset.targetMenu;
    }
    const hdr = document.getElementById('header-container');
    if (hdr) hdr.style.display = 'flex';
    document.body.classList.add('back-button-active');
    try { checkHeaderCollision(); } catch (_) {}
}

/**
 * Unregisters a cancellation handler
 */
export function unregisterBackButtonHandler() {
    backButtonHandler = null;
    const backButton = document.getElementById('back-button');
    if (backButton && !backButton.dataset.targetMenu) {
        backButton.style.display = 'none';
    }
    document.body.classList.remove('back-button-active');
    try { checkHeaderCollision(); } catch (_) {}
}


/**
 * Global back button handler that delegates to appropriate handlers
 */
function handleBackButtonClick(event) {
    console.log(`🔙 Back button clicked in ${currentView} view`);
    
    // Priority order: prompt > terminal > menu > default navigation
    if (backButtonHandler) {
        console.log('🔙 Delegating to back button handler');
        backButtonHandler();
        event.stopPropagation(); // Stop propagation to prevent default navigation
        return;
    }
    
    // Default navigation based on current view
    if (currentView === 'terminal') {
        console.log("🔙 Default terminal navigation - returning from terminal");
        returnFromTerminal();
    } else if (currentView === 'about') {
        console.log("🔙 Default about navigation - returning to landing");
        loadLandingView();
    } else if (currentView === 'menu' && (!backButton.dataset.targetMenu)) {
        console.log("🔙 Default menu navigation - returning to landing");
        loadLandingView();
    }
    // Menu-to-menu navigation with data-target-menu is handled by menu.js
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM fully loaded and parsed");

    // Cache static elements from index.html
    consoleContainer = document.getElementById('console-container');
    headerContainer = document.getElementById('header-container');
    siteTitle = document.getElementById('site-title');
    backButton = document.getElementById('back-button');
    accountButton = document.getElementById('account-button');

    if (!consoleContainer || !headerContainer || !siteTitle || !backButton || !accountButton) {
        console.error('Critical Error: Essential elements missing from index.html (#console-container, #header-container, #site-title, #back-button, #account-button).');
        if (document.body) document.body.innerHTML = '<h1>Critical Page Error</h1>';
        return;
    }

    // Configure the auth module with the default redirect action
    configureAuthRedirect(loadConsoleView);

    // Configure the auth module with a success callback to update the UI immediately
    configureAuthSuccessCallback(() => {
        updateCurrentUserState(); // Refresh the user state in main.js
        updateAuthState(currentUser); // Push the new state to menu.js
        refreshHeaderButtonsForCurrentMenu(); // Re-render the header buttons with the new state
    });

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

    // Import all functions that can be triggered by menu actions.
    const { handleDeploySimple, handleDeployAdvanced } = await import('/static/menus/deploy.js');
    const { listSites, destroySite, destroyDeployment, openAddress } = await import('/static/menus/site.js');
    const { listMachines, destroyMachine, renameMachine } = await import('/static/menus/machine.js');
    const { listDomains, handleRegisterNewDomain } = await import('/static/menus/domain.js');
    const { getUsage } = await import('/static/menus/usage.js');
    const { handleSubscribe, handleCancelSubscription } = await import('/static/menus/subscription.js');
    const { listDeploymentsForBackup, createScriptBackup, showRestoreMenu, selectDeploymentForRestore, confirmRestore, showScheduleMenu, promptBackupSchedule } = await import('/static/menus/backup.js');
    const { handleRescind } = await import('/static/menus/account.js');
    // --- END: Action Handler Imports ---

    // Define the map of action handlers after all modules have loaded
    actionHandlers = {
        // Deployment actions
        handleDeploySimple: handleDeploySimple,
        handleDeployAdvanced: handleDeployAdvanced,
        // Resource listing actions
        listSites: listSites,
        listMachines: listMachines,
        destroySite: destroySite,
        destroyDeployment: destroyDeployment,
        openAddress: openAddress,
        destroyMachine: destroyMachine,
        renameMachine: renameMachine,
        listDomains: listDomains,
        registerDomain: handleRegisterNewDomain,
        getUsage: getUsage,
        // Backup actions
        listDeploymentsForBackup: listDeploymentsForBackup,
        createScriptBackup: createScriptBackup,
        showRestoreMenu: showRestoreMenu,
        selectDeploymentForRestore: selectDeploymentForRestore,
        confirmRestore: confirmRestore,
        showScheduleMenu: showScheduleMenu,
        promptBackupSchedule: promptBackupSchedule,
        // Authentication actions
        handleLogout: handleLogout,
        handleRescind: handleRescind,
        // Terminal/View actions
        loadTerminalView: loadTerminalView,
        // Subscription actions
        handleSubscribe: handleSubscribe,
        handleCancelSubscription: handleCancelSubscription
    };

    // Try to load user from sessionStorage
    updateCurrentUserState();
    console.log("Initial user state loaded:", currentUser);


    // Site title listener modification
    siteTitle.removeEventListener('click', siteTitle._clickHandler); // Remove previous if any
    siteTitle._clickHandler = () => { // Store handler reference for potential removal
        if (currentView === 'terminal') {
            console.log("Site title clicked while in terminal view, returning...");
            returnFromTerminal();
        } else {
            // In all other views (menu, about, landing), go to the landing view.
            console.log(`Site title clicked while in ${currentView} view, loading landing view.`);
            loadLandingView();
        }
    };
    siteTitle.addEventListener('click', siteTitle._clickHandler);

    // Back button listener - Use the new global handler
    // Remove previous listener if re-attaching (e.g., during development hot-reload)
    if (headerContainer) {
        headerContainer.removeEventListener('click', headerContainer._clickHandler);
        headerContainer._clickHandler = (event) => {
            // Handle back button clicks specifically
            if (event.target.id === 'back-button') {
                handleBackButtonClick(event);
            }
            // Account button authentication clicks are handled by its own listener added in loadConsoleView
            // Account button navigation clicks are handled by the listener in menu.js
        };
        headerContainer.addEventListener('click', headerContainer._clickHandler);
    }

    // Add a resize listener to check for header collisions
    window.addEventListener('resize', checkHeaderCollision);

    // Initial load logic
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    const isOrderReturn = window.location.pathname.includes('/order/return');

    if (isOrderReturn && sessionId) {
        // The user has returned from a Stripe checkout session.
        try {
            const { prompt } = await import('/static/pages/prompt.js');
            await prompt({
                id: 'order-success-prompt',
                text: 'Your order was successful!',
                type: 'options',
                options: [{ label: 'OK', value: 'ok' }]
            });
        } catch (error) {
            console.error("Failed to show success prompt:", error);
        } finally {
            // Clean up the URL and load the default view
            window.history.replaceState({}, document.title, "/");
            loadLandingView();
        }
    } else {
        // Standard initial load
        console.log("Initial load, always loading landing view.");
        loadLandingView();
    }

    // Register the service worker (restored original code)
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/static/service-worker.js')
                .then(registration => console.log('SW registered: ', registration))
                .catch(registrationError => console.log('SW registration failed: ', registrationError));
        });
    } else {
        console.log('Service Worker not supported in this browser.');
    }
});
