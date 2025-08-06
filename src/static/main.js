// Define the base API URL here
export const API_BASE_URL = 'https://api.webserversupplyco.com';

// Import the main menu initialization function from the common module
import { initializeMenu, renderMenu, cleanupCurrentMenu } from '/static/pages/menu.js';

// Import the Google Sign-In functions
import { initializeGoogleSignIn, triggerGoogleSignIn } from '/static/scripts/authenticate.js';

// Import Stripe functions
import { initializeStripe, handleSubscribe } from '/static/menus/subscription.js';

// Import Terminal functions
import { initializeTerminal, cleanupTerminal } from '/static/pages/terminal.js';

// Import updateStatusDisplay from menu.js for use in loadConsoleView
import { updateStatusDisplay, checkHeaderCollision } from '/static/pages/menu.js';

// --- Import Menu Configurations ---
// These self-register with common.js
import '/static/menus/dashboard.js';
import '/static/menus/deploy.js';
import '/static/menus/account.js';
import '/static/menus/resources.js';
import '/static/menus/domain.js';
import '/static/menus/usage.js';
import '/static/menus/firewall.js';
import '/static/menus/instance.js'; // Imports registration and handlers
import '/static/menus/backup.js'; // <-- Add import for backup.js
import '/static/menus/subscription.js';
// --- End Menu Imports ---


// --- Global State & Elements ---
let currentUser = null; // Stores { guest: true } or authenticated user object
let actionHandlers = {}; // To be populated in DOMContentLoaded
let currentView = 'login'; // Track current view: 'login', 'menu', 'terminal', 'about'
let terminalReturnParams = null; // Store params for returning from terminal

// Global back button state management
let backButtonHandlers = {
    promptCancel: null,     // Function to call when cancelling prompts
    terminalCancel: null,   // Function to call when cancelling terminal operations
    menuNavigation: null    // Function to call for menu navigation
};

// Cache essential static elements from index.html
let consoleContainer = null;
let accountButton = null;
let backButton = null;
let headerContainer = null;
let siteTitle = null; // Add variable for site title

// --- Utility Functions ---

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
        // Unauthorized: Token might be invalid or expired
        console.warn("Received 401 Unauthorized. Clearing session and redirecting to login.");
        sessionStorage.removeItem('currentUser');
        currentUser = null;
        loadLandingView(); // Redirect to login
        // Throw an error to prevent further processing by the caller
        throw new Error('Unauthorized'); 
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
    // Rely on elements being cached by DOMContentLoaded
    // Remove internal caching attempts:
    // if (!consoleContainer) consoleContainer = document.getElementById('console-container');
    // if (!headerContainer) headerContainer = document.getElementById('header-container');
    // if (!backButton) backButton = document.getElementById('back-button');
    // if (!accountButton) accountButton = document.getElementById('account-button');

    // Check if essential containers exist (should have been cached)
    if (!consoleContainer || !headerContainer) {
        console.error("clearConsoleContent called before essential containers were cached.");
        return;
    }

    // Remove all children of consoleContainer EXCEPT the headerContainer
    while (consoleContainer.lastChild && consoleContainer.lastChild !== headerContainer) {
        consoleContainer.removeChild(consoleContainer.lastChild);
    }
}

/**
 * Adds event listeners for the dynamically loaded login view.
 */
function setupLoginViewListeners() {
    const consoleButton = document.getElementById('console-button');
    const aboutButton = document.getElementById('about-button'); // Get the about button
    const statusContainer = document.getElementById('login-status-message') || consoleContainer; // Fallback

    if (consoleButton) {
        consoleButton.addEventListener('click', handleConsoleButtonClick);
    }
    if (aboutButton) { // Add listener for about button
        aboutButton.addEventListener('click', loadAboutView);
    }

    // Initialize Google Sign-In each time the view loads to ensure it's ready
    // Pass the correct status container and success handler
    initializeGoogleSignIn(statusContainer, handleAuthenticationSuccess);
}


// --- View Loading Functions ---

/**
 * Loads and displays the landing/login view from landing.html.
 */
async function loadLandingView() {
    currentView = 'landing'; // Update view state to 'landing'
    terminalReturnParams = null; // Clear return params
    
    // Cleanup any active menu polling/handlers
    cleanupCurrentMenu();
    
    console.log("Loading landing view...");
    // Ensure essential elements are cached
    if (!consoleContainer) consoleContainer = document.getElementById('console-container');
    if (!headerContainer) headerContainer = document.getElementById('header-container');
    if (!backButton) backButton = document.getElementById('back-button');
    if (!accountButton) accountButton = document.getElementById('account-button');


    // --- Start: Hide header buttons ---
    if (backButton) {
        backButton.style.display = 'none';
        delete backButton.dataset.targetMenu; // Clear any nav data
    }
    if (accountButton) {
        accountButton.style.display = 'none';
        delete accountButton.dataset.targetMenu; // Clear any nav data
    }
    // --- End: Hide header buttons ---

    if (!consoleContainer) return; // Console container needed for content

    clearConsoleContent(); // Clear previous content (menu, etc.)
    const loginHTML = await fetchHTML('/templates/landing.html');
    consoleContainer.insertAdjacentHTML('beforeend', loginHTML);

    // Setup listeners for the newly added landing elements
    setupLoginViewListeners();
    console.log("Landing view loaded and listeners attached.");
}

/**
 * Loads and displays the main menu view from menu.html.
 * @param {string} [initialMenuId] - Optional menu ID to render initially.
 */
export async function loadConsoleView(param) {
    currentView = 'menu';
    terminalReturnParams = null;

    if (!headerContainer) headerContainer = document.getElementById('header-container');
    if (!backButton) backButton = document.getElementById('back-button');
    if (!accountButton) accountButton = document.getElementById('account-button');

    if (accountButton && !accountButton.dataset.listenerAdded) {
        accountButton.dataset.listenerAdded = 'true';
        accountButton.addEventListener('click', () => {
            if (accountButton.textContent === 'authenticate') {
                const statusContainerForLogin = document.getElementById('menu-status-message') || consoleContainer.querySelector('#menu-status-message');
                if (statusContainerForLogin) {
                    initializeGoogleSignIn(statusContainerForLogin, handleAuthenticationSuccess);
                    triggerGoogleSignIn(statusContainerForLogin);
                } else {
                    console.error("Critical: Could not find status message container for menu login.");
                    updateStatusDisplay("Cannot initiate login: UI element missing.", "error"); // Use the imported updateStatusDisplay
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

    let initialMenuIdToRender = 'dashboard-menu'; // Default

    if (param) {
        if (typeof param === 'string') {
            initialMenuIdToRender = param;
            console.log(`Rendering specific initial menu: ${initialMenuIdToRender}`);
            renderMenu(initialMenuIdToRender);
        } else if (typeof param === 'object' && param.output && param.type) {
            // This is likely an error/status message from a previous operation
            console.log(`Displaying status message in console view: ${param.output} (Type: ${param.type})`);
            updateStatusDisplay(param.output, param.type); // Use the imported updateStatusDisplay
            // Still render the default menu in the background for structure
            renderMenu(initialMenuIdToRender); 
        } else {
            console.warn(`loadConsoleView called with unexpected parameter type: ${param}. Rendering default menu.`);
            renderMenu(initialMenuIdToRender);
        }
    } else {
        // No parameter, render default menu
        renderMenu(initialMenuIdToRender);
    }
    console.log("Console view loaded and initialized.");
}

/**
 * Loads and displays the terminal view.
 * @param {object} [params] - Optional parameters. Can include `output` and `type` for initial message, or `existingWs` for using an existing WebSocket.
 */
export async function loadTerminalView(params = {}) {
    console.log("loadTerminalView called with params:", params);
    currentView = 'terminal'; // Set current view state
    terminalReturnParams = { view: 'menu' }; // Default return to menu

    // Cleanup any active menu polling/handlers
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
    consoleContainer.innerHTML = ''; // Clear previous content from console-container
    const terminalHTML = await fetchHTML('/templates/terminal.html');
    consoleContainer.insertAdjacentHTML('beforeend', terminalHTML);
    console.log("Terminal HTML loaded into console-container.");

    if (promptContainer) promptContainer.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
    
    if (consoleContainer) consoleContainer.style.display = 'block';

    // Configure header buttons for terminal view
    if (headerContainer) {
        headerContainer.style.display = 'flex'; // Show header
        if (siteTitle) siteTitle.style.display = 'inline-block'; // Ensure site title is visible
        if (backButton) {
            backButton.style.display = 'inline-block'; // Explicitly show back button
            delete backButton.dataset.targetMenu;      // Clear any menu-specific target
        }
        if (accountButton) {
            accountButton.style.display = 'none';      // Explicitly hide account button
        }
    }
    document.body.classList.add('terminal-view-active');

    const terminalParams = { ...params };
    delete terminalParams.initialMessageToServer;

    // Initialize the terminal logic AFTER its HTML is in the DOM
    // Pass the params object which may contain output or an existing WebSocket
    try {
        await initializeTerminal(params);
    } catch (error) {
        console.error("Failed to initialize terminal:", error);
        // Show error in the terminal output area itself if possible
        const outputArea = document.getElementById('terminal-output');
        if (outputArea) {
            outputArea.innerHTML = `<div class="terminal-line terminal-error">Critical Error: Could not initialize terminal. ${error.message}</div>`;
        }
    }
}

// Function to handle returning from terminal (used by back button and site title)
export function returnFromTerminal() {
    console.log("Returning from terminal view. Loading console view.");
    cleanupTerminal(); // Clean up any terminal-specific resources or intervals

    // --- START: Reset menu title ---
    // This handles the case where a deployment was running and we are returning.
    const menuTitleElement = document.getElementById('menu-text');
    if (menuTitleElement && menuTitleElement.classList.contains('rainbow-text')) {
        menuTitleElement.classList.remove('rainbow-text');
        // The title will be reset automatically when renderMenu is called in loadConsoleView
    }
    // --- END: Reset menu title ---

    loadConsoleView();
}

/**
 * Loads and displays the About view from about.html.
 */
async function loadAboutView() {
    currentView = 'about'; // Update view state
    terminalReturnParams = null; // Clear terminal params
    
    // Cleanup any active menu polling/handlers
    cleanupCurrentMenu();
    
    console.log("Loading about view...");

    // Ensure essential elements are cached
    if (!consoleContainer) consoleContainer = document.getElementById('console-container');
    if (!headerContainer) headerContainer = document.getElementById('header-container');
    if (!backButton) backButton = document.getElementById('back-button');
    if (!accountButton) accountButton = document.getElementById('account-button');

    // --- Configure Header Buttons ---
    if (backButton) {
        backButton.style.display = 'inline-block'; // Show back button
        delete backButton.dataset.targetMenu; // Clear menu nav data
    }
    if (accountButton) {
        accountButton.style.display = 'none'; // Hide account button
        delete accountButton.dataset.targetMenu;
    }
    // --- End Header Buttons ---

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
 * Handles successful authentication via Google Sign-In.
 */
function handleAuthenticationSuccess(userSession) {
    // userSession is now the object {email, token} from data.session
    currentUser = userSession; 
    loadConsoleView();
}

/**
 * Handles the logout action (called from account menu usually).
 */
const handleLogout = async () => { // Made async
    console.log("Logging out: Calling /api/logout and clearing local session.");
    
    let token = null;
    const storedUserString = sessionStorage.getItem('currentUser');
    if (storedUserString) {
        try {
            const storedUser = JSON.parse(storedUserString);
            if (storedUser && storedUser.token) {
                token = storedUser.token;
            }
        } catch (e) {
            console.error("Error parsing stored user for token during logout:", e);
        }
    }

    let unauthorizedRedirectHandled = false; // Flag to track if fetchWithAuth handled the 401 redirect

    if (token) {
        try {
            // Call the backend logout endpoint
            const response = await fetchWithAuth(`${API_BASE_URL}/logout`, { 
                method: 'POST' 
            });
            if (response.ok) {
                console.log("Successfully logged out on the server.");
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.error("Server logout failed:", response.status, errorData.error || 'Unknown error');
            }
        } catch (error) {
            // Errors like network errors or the 401 handler in fetchWithAuth throwing
            if (error.message === 'Unauthorized') { 
                // fetchWithAuth already handled clearing session and calling loadLandingView
                unauthorizedRedirectHandled = true;
            } else {
                console.error("Error during server logout:", error);
            }
        }
    }

    // If a 401 error (Unauthorized) was handled by fetchWithAuth, it already cleared the session
    // and called loadLandingView. In that case, we don't call loadLandingView again.
    // If there was no token (already logged out locally) or if another error occurred,
    // we proceed to ensure local session is cleared and redirect to landing.
    if (!unauthorizedRedirectHandled) {
        console.log("Performing local session cleanup and redirecting to landing view (handleLogout).");
        sessionStorage.removeItem('currentUser');
        currentUser = null; 
        loadLandingView(); 
    }
};

// --- Back Button Management ---

/**
 * Registers a cancellation handler for the current operation
 * @param {string} type - 'prompt', 'terminal', or 'menu'
 * @param {function} handler - Function to call when back button is pressed
 */
export function registerBackButtonHandler(type, handler) {
    if (type === 'prompt') {
        backButtonHandlers.promptCancel = handler;
        console.log('🔙 Registered prompt cancellation handler');
    } else if (type === 'terminal') {
        backButtonHandlers.terminalCancel = handler;
        console.log('🔙 Registered terminal cancellation handler');
    } else if (type === 'menu') {
        backButtonHandlers.menuNavigation = handler;
        console.log('🔙 Registered menu navigation handler');
    }
}

/**
 * Unregisters a cancellation handler
 * @param {string} type - 'prompt', 'terminal', or 'menu'
 */
export function unregisterBackButtonHandler(type) {
    if (type === 'prompt') {
        backButtonHandlers.promptCancel = null;
        console.log('🔙 Unregistered prompt cancellation handler');
    } else if (type === 'terminal') {
        backButtonHandlers.terminalCancel = null;
        console.log('🔙 Unregistered terminal cancellation handler');
    } else if (type === 'menu') {
        backButtonHandlers.menuNavigation = null;
        console.log('🔙 Unregistered menu navigation handler');
    }
}

/**
 * Global back button handler that delegates to appropriate handlers
 */
function handleBackButtonClick() {
    console.log(`🔙 Back button clicked in ${currentView} view`);
    
    // Priority order: prompt > terminal > menu > default navigation
    if (backButtonHandlers.promptCancel) {
        console.log('🔙 Delegating to prompt cancellation handler');
        backButtonHandlers.promptCancel();
        return;
    }
    
    if (backButtonHandlers.terminalCancel) {
        console.log('🔙 Delegating to terminal cancellation handler');
        backButtonHandlers.terminalCancel();
        return;
    }
    
    if (backButtonHandlers.menuNavigation) {
        console.log('🔙 Delegating to menu navigation handler');
        backButtonHandlers.menuNavigation();
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

    // Initialize Stripe.js
    await initializeStripe();

    // Set dynamic site title based on current domain
    const currentDomain = window.location.hostname;
    const currentProtocol = window.location.protocol;
    siteTitle.textContent = `${currentProtocol}//${currentDomain}`;
    console.log(`Site title set to: ${siteTitle.textContent}`);

    // --- START: Action Handler Imports ---
    // Import all functions that can be triggered by menu actions.
    const { handleDeployWordPress, handleDeployGrapes, handleDeployVM } = await import('/static/menus/deploy.js');
    const { listInstances } = await import('/static/menus/instance.js');
    const { listDomains, registerDomain } = await import('/static/menus/domain.js');
    const { listBillingAccounts } = await import('/static/menus/usage.js');
    const { handleSubscribe } = await import('/static/menus/subscription.js');
    // --- END: Action Handler Imports ---

    // Define the map of action handlers after all modules have loaded
    actionHandlers = {
        // Deployment actions
        handleDeployWordPress: handleDeployWordPress,
        handleDeployGrapes: handleDeployGrapes,
        handleDeployVM: handleDeployVM,
        // Resource listing actions
        listInstances: listInstances,
        listDomains: listDomains,
        registerDomain: registerDomain,
        listBillingAccounts: listBillingAccounts,
        // Authentication actions
        handleLogout: handleLogout,
        // Terminal/View actions
        loadTerminalView: loadTerminalView,
        // Subscription actions
        handleSubscribe: handleSubscribe
    };

    // Try to load user from sessionStorage
    let initialUser = null;
    const storedUserString = sessionStorage.getItem('currentUser');
    if (storedUserString) {
        try {
            const potentialUser = JSON.parse(storedUserString);
            // Check if the stored user has a token (implies valid authenticated session)
            if (potentialUser && potentialUser.token) {
                initialUser = potentialUser;
                console.log("Found active user session in sessionStorage:", initialUser);
            } else {
                // Stored user is incomplete or guest, treat as no active session
                console.log("Found incomplete or guest user session in sessionStorage. Will load landing view.");
                sessionStorage.removeItem('currentUser'); // Clear incomplete/guest session
            }
        } catch (e) {
            console.error("Error parsing stored user from sessionStorage:", e);
            sessionStorage.removeItem('currentUser'); // Clear corrupted data
        }
    }
    currentUser = initialUser; // Set the global currentUser


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
                handleBackButtonClick();
            }
            // Account button authentication clicks are handled by its own listener added in loadConsoleView
            // Account button navigation clicks are handled by the listener in menu.js
        };
        headerContainer.addEventListener('click', headerContainer._clickHandler);
    }

    // Add a resize listener to check for header collisions
    window.addEventListener('resize', checkHeaderCollision);

    // Initial load: Always show the landing view first
    console.log("Initial load, always loading landing view.");
    loadLandingView();

    // Register the service worker (restored original code)
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => console.log('SW registered: ', registration))
                .catch(registrationError => console.log('SW registration failed: ', registrationError));
        });
    } else {
        console.log('Service Worker not supported in this browser.');
    }
});
