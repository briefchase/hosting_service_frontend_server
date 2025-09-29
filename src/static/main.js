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
// pendingReauthAction is now stored on window object by authenticate.js

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
let spotifyEmbedEl = null; // Persistent Spotify embed element
let spotifyPositionHandlersAttached = false; // Track if resize/scroll handlers are attached

// Spikeball gif shown only on landing view
let spikeballEl = null;
let spikeballHandlersAttached = false;

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
        // Unauthorized: Token invalid/expired. Silently re-initiate authentication globally.
        console.warn("Received 401 Unauthorized. Clearing session and re-initiating authentication.");
        try { sessionStorage.removeItem('currentUser'); } catch (_) {}
        currentUser = null;
        // Prevent multiple concurrent reauth popups
        if (!window.__reauthInProgress) {
            window.__reauthInProgress = true;
            try {
                const statusContainer = document.getElementById('menu-status-message')
                    || document.getElementById('console-container')
                    || document.body;
                initializeGoogleSignIn(statusContainer, handleAuthenticationSuccess);
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
 * Ensures a persistent Spotify embed exists and is attached to document.body.
 * If the landing template provided an iframe with data-testid="embed-iframe",
 * it will be moved to the body and reused; otherwise a new one is created.
 * The element is kept visible/hidden via opacity so playback can persist.
 */
function ensureSpotifyEmbedCreated() {
    if (spotifyEmbedEl && document.body.contains(spotifyEmbedEl)) return spotifyEmbedEl;

    // Prefer an existing iframe from the landing template if present
    const templateEmbed = document.querySelector('iframe[data-testid="embed-iframe"]');
    if (templateEmbed) {
        spotifyEmbedEl = templateEmbed;
    } else {
        spotifyEmbedEl = document.createElement('iframe');
        spotifyEmbedEl.setAttribute('data-testid', 'embed-iframe');
        spotifyEmbedEl.src = 'https://open.spotify.com/embed/playlist/7LDlK4VLv2RNxaQ7Z4D6qI?utm_source=generator';
        spotifyEmbedEl.frameBorder = '0';
        spotifyEmbedEl.allowFullscreen = '';
        spotifyEmbedEl.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
        spotifyEmbedEl.loading = 'lazy';
    }

    // Apply persistent, full-bleed styling
    spotifyEmbedEl.id = 'global-spotify-embed';
    spotifyEmbedEl.style.borderRadius = '12px';
    spotifyEmbedEl.style.display = 'block';
    spotifyEmbedEl.style.zIndex = '10';
    spotifyEmbedEl.style.position = 'fixed';
    spotifyEmbedEl.style.left = '50%';
    spotifyEmbedEl.style.transform = 'translateX(-50%)';
    spotifyEmbedEl.style.opacity = '0';
    spotifyEmbedEl.style.pointerEvents = 'none';

    // Remove presentational attributes to avoid conflicts; CSS will control size
    try { spotifyEmbedEl.removeAttribute('width'); } catch (_) {}
    try { spotifyEmbedEl.removeAttribute('height'); } catch (_) {}

    // Move to body so it persists across view changes
    if (spotifyEmbedEl.parentElement !== document.body) {
        document.body.appendChild(spotifyEmbedEl);
    }

    return spotifyEmbedEl;
}

function refreshSpotifyEmbedPosition() {
    if (!spotifyEmbedEl) return;
    // Only compute relative to landing view elements
    const loginContainer = document.getElementById('login-view-container');
    const consoleBtn = document.getElementById('console-button');
    const anchorEl = (consoleBtn && consoleBtn.parentElement) ? consoleBtn : loginContainer;
    if (!anchorEl) return;

    const rect = anchorEl.getBoundingClientRect();
    // Fixed pixel sizing (2:1 aspect)
    const targetWidthPx = 320;
    const targetHeightPx = 120;

    spotifyEmbedEl.style.width = `${targetWidthPx}px`;
    spotifyEmbedEl.style.height = `${targetHeightPx}px`;
    // Position just below the buttons container
    spotifyEmbedEl.style.top = `${Math.round(rect.bottom + 16)}px`;
}

function showSpotifyEmbed() {
    const el = ensureSpotifyEmbedCreated();
    // Recalculate size/position relative to landing buttons
    refreshSpotifyEmbedPosition();
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';

    // Attach resize/scroll handlers once for responsive positioning
    if (!spotifyPositionHandlersAttached) {
        spotifyPositionHandlersAttached = true;
        window.addEventListener('resize', refreshSpotifyEmbedPosition);
        window.addEventListener('scroll', refreshSpotifyEmbedPosition, { passive: true });
    }
}

function hideSpotifyEmbed() {
    // Keep in DOM and keep dimensions so playback persists
    if (!spotifyEmbedEl) return;
    spotifyEmbedEl.style.opacity = '0';
    spotifyEmbedEl.style.pointerEvents = 'none';
}

// --- Spikeball (landing only) helpers ---
let mockupEl = null; // Add global variable for mockup image

function ensureSpikeballCreated() {
    if (spikeballEl && document.body.contains(spikeballEl)) {
        ensureMockupCreated();
        return spikeballEl;
    }
    spikeballEl = document.createElement('img');
    spikeballEl.id = 'landing-spikeball-gif';
    spikeballEl.src = '/static/resources/spikeball.gif';
    spikeballEl.alt = 'spikeball';
    spikeballEl.style.position = 'absolute';
    spikeballEl.style.width = '200px';
    spikeballEl.style.height = '200px';
    spikeballEl.style.left = '0px';
    spikeballEl.style.zIndex = '20';
    document.body.appendChild(spikeballEl);
    ensureMockupCreated();
    return spikeballEl;
}

function ensureMockupCreated() {
    if (mockupEl && document.body.contains(mockupEl)) return mockupEl;
    mockupEl = document.createElement('img');
    mockupEl.id = 'landing-mockup-img';
    mockupEl.src = '/static/resources/clothes/froggo.png';
    mockupEl.alt = 'mockup';
    mockupEl.style.position = 'absolute';
    mockupEl.style.width = '100px';
    mockupEl.style.height = '100px';
    mockupEl.style.zIndex = '21'; // On top of spikeball
    mockupEl.style.transform = 'rotate(15deg)';
    document.body.appendChild(mockupEl);
    return mockupEl;
}

function positionSpikeballBelowHeader() {
    if (!spikeballEl) return;
    const header = headerContainer || document.getElementById('header-container');
    if (!header) return;
    const rect = header.getBoundingClientRect();
    const top = Math.round(rect.bottom + window.scrollY);
    spikeballEl.style.top = `${top}px`;

    // Position horizontally relative to page center with a +200px offset,
    // while keeping at least a small right margin when near the edge.
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const desiredOffsetFromCenter = 130; // px to the right of center
    const minRightMargin = 12; // px
    const elWidth = spikeballEl.offsetWidth || 200;

    const desiredCenterX = Math.round(viewportWidth / 2 + desiredOffsetFromCenter);
    let left = Math.round(desiredCenterX - elWidth / 2);

    // Clamp so the right edge keeps a minimum margin
    const maxLeft = Math.max(0, viewportWidth - minRightMargin - elWidth);
    if (left > maxLeft) left = maxLeft;
    if (left < 0) left = 0;

    spikeballEl.style.left = `${left}px`;
    spikeballEl.style.right = 'auto';

    // Position mockup to track spikeball exactly (with slight offset for visual interest)
    positionMockupRelativeToSpikeball();
}

function positionMockupRelativeToSpikeball() {
    if (!mockupEl || !spikeballEl) return;

    const spikeballRect = spikeballEl.getBoundingClientRect();
    const mockupWidth = mockupEl.offsetWidth || 100;
    const mockupHeight = mockupEl.offsetHeight || 100;

    // Position mockup on top of spikeball (centered) with 11px offset right and 18px offset up
    const mockupLeft = Math.round(spikeballRect.left + (spikeballRect.width - mockupWidth) / 2 + 11);
    const mockupTop = Math.round(spikeballRect.top + (spikeballRect.height - mockupHeight) / 2 - 18);

    mockupEl.style.left = `${mockupLeft}px`;
    mockupEl.style.top = `${mockupTop}px`;
}

function showSpikeball() {
    const el = ensureSpikeballCreated();
    positionSpikeballBelowHeader();
    el.style.display = 'block';

    // Show mockup too
    if (mockupEl) {
        mockupEl.style.display = 'block';
    }

    if (!spikeballHandlersAttached) {
        spikeballHandlersAttached = true;
        window.addEventListener('resize', positionSpikeballBelowHeader);
        window.addEventListener('scroll', positionSpikeballBelowHeader, { passive: true });
    }
}

function hideSpikeball() {
    if (!spikeballEl) return;
    spikeballEl.style.display = 'none';

    // Hide mockup too
    if (mockupEl) {
        mockupEl.style.display = 'none';
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

    // Promote the landing iframe to persistent player and ensure only one exists
    const existingGlobal = document.getElementById('global-spotify-embed');
    const newlyInserted = document.querySelector('#console-container iframe[data-testid="embed-iframe"]');
    if (!existingGlobal && newlyInserted) {
        // Move and configure it as persistent
        ensureSpotifyEmbedCreated();
    } else if (existingGlobal && newlyInserted && newlyInserted !== existingGlobal) {
        // Remove duplicate from template
        newlyInserted.remove();
    }
    showSpotifyEmbed();
    // Show landing-only spikeball gif below the header on the right
    try { showSpikeball(); } catch (_) {}
    // Update legal year dynamically if present
    const legalYearEl = document.getElementById('legal-year');
    if (legalYearEl) {
        const year = new Date().getFullYear();
        legalYearEl.textContent = String(year);
    }
    console.log("Landing view loaded and listeners attached.");
}

/**
 * Loads and displays the main menu view from menu.html.
 * @param {string} [initialMenuId] - Optional menu ID to render initially.
 */
// UI mode helpers
export function enterPromptMode() {
    try {
        document.body.classList.add('prompt-active');
    } catch (_) {}
}

export function exitPromptMode() {
    try {
        document.body.classList.remove('prompt-active');
        // Header visibility is managed by the subsequent view
    } catch (_) {}
}

// Overlay toggle used by prompt.js to hide menu/content only while the prompt is visible
export function enterPromptOverlay() {
    try { document.body.classList.add('prompt-overlay-active'); } catch (_) {}
    try { document.documentElement.classList.add('prompt-overlay-active'); } catch (_) {}
}
export function exitPromptOverlay() {
    try { document.body.classList.remove('prompt-overlay-active'); } catch (_) {}
    try { document.documentElement.classList.remove('prompt-overlay-active'); } catch (_) {}
}

export async function loadConsoleView(param) {
    currentView = 'menu';
    terminalReturnParams = null;

    // Hide embed before clearing content so playback persists
    try { hideSpotifyEmbed(); } catch (_) {}
    try { hideSpikeball(); } catch (_) {}

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

    // Hide embed before clearing content so playback persists
    try { hideSpotifyEmbed(); } catch (_) {}
    try { hideSpikeball(); } catch (_) {}

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

    // Header/back visibility is tied to handler registration now
    if (headerContainer) headerContainer.style.display = 'flex';
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
        if (window.addOutputToTerminal) {
            window.addOutputToTerminal(`Critical Error: Could not initialize terminal. ${error.message}`, 'error');
        } else {
            const outputArea = document.getElementById('terminal-output');
            if (outputArea) {
                outputArea.innerHTML = `<div class="terminal-line terminal-terminal">Critical Error: Could not initialize terminal. ${error.message}</div>`;
            }
        }
    }
}

// Function to handle returning from terminal (used by back button and site title)
export function returnFromTerminal() {
    console.log("Returning from terminal view. Loading console view.");
    cleanupTerminal(); // Clean up any terminal-specific resources or intervals

    const menuTitleElement = document.getElementById('menu-text');
    if (menuTitleElement && menuTitleElement.classList.contains('rainbow-text')) {
        menuTitleElement.classList.remove('rainbow-text');
    }

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

    // Back button visibility tied to handler registration
    try {
        registerBackButtonHandler('menu', () => {
            unregisterBackButtonHandler('menu');
            loadLandingView();
        });
    } catch (_) {}

    if (!consoleContainer) return;

    // Hide embed before clearing content so playback persists
    try { hideSpotifyEmbed(); } catch (_) {}
    try { hideSpikeball(); } catch (_) {}

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
    try { window.__reauthInProgress = false; } catch (_) {}

    // If there's a pending action from reauth, re-execute it
    if (window.pendingReauthAction) {
        const { actionFn, params } = window.pendingReauthAction;
        window.pendingReauthAction = null; // Clear before re-execution to prevent loops
        console.log('Re-executing interrupted action after successful reauth');
        try {
            actionFn(params);
        } catch (error) {
            console.error('Error re-executing pending action:', error);
            // If re-execution fails, fall back to loading console view
            loadConsoleView();
        }
    } else {
        // No pending action, just load the console view
        loadConsoleView();
    }
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
    try {
        const hdr = document.getElementById('header-container');
        const btn = document.getElementById('back-button');
        if (hdr) hdr.style.display = 'flex';
        if (btn) {
            btn.style.display = 'inline-block';
            delete btn.dataset.targetMenu;
        }
        // Ensure visibility even if styles were previously toggled
        document.body.classList.add('terminal-view-active');
        // Recompute header collision state after showing button
        try { checkHeaderCollision(); } catch (_) {}
    } catch (_) {}
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
    try {
        const btn = document.getElementById('back-button');
        const hdr = document.getElementById('header-container');
        const hasAnyHandler = !!(backButtonHandlers.promptCancel || backButtonHandlers.terminalCancel || backButtonHandlers.menuNavigation);
        if (!hasAnyHandler) {
            // If no active handler and no explicit menu navigation target, hide the back button
            if (btn && !btn.dataset.targetMenu) {
                btn.style.display = 'none';
            }
            // Header visibility is governed by views; keep as-is but ensure collision is recalculated
        }
        try { checkHeaderCollision(); } catch (_) {}
    } catch (_) {}
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

    // Set CSS var for header height so overlays (prompt) can position below it
    try {
        const setHeaderVar = () => {
            const h = headerContainer.getBoundingClientRect().height || 0;
            document.documentElement.style.setProperty('--header-height', `${Math.ceil(h)}px`);
        };
        setHeaderVar();
        window.addEventListener('resize', setHeaderVar, { passive: true });
    } catch (_) {}

    // Initialize Stripe.js
    await initializeStripe();

    // Set header site title to protocol + hostname
    const currentDomain = window.location.hostname;
    const currentProtocol = window.location.protocol;
    siteTitle.textContent = `${currentProtocol}//${currentDomain}`;
    console.log(`Site title set to: ${siteTitle.textContent}`);

    // Keep a consistent font for the title (no randomization)

    // Random background image from /static/resources/backgrounds on each load (via manifest)
    try {
        const manifestResp = await fetch('/static/resources/backgrounds/manifest.json');
        if (manifestResp.ok) {
            const files = await manifestResp.json();
            if (Array.isArray(files) && files.length > 0) {
                const chosenBg = files[Math.floor(Math.random() * files.length)];
                const bgUrl = `/static/resources/backgrounds/${chosenBg}`;
                document.documentElement.style.height = '100%';
                document.body.style.minHeight = '100%';
                document.body.style.backgroundImage = `url('${bgUrl}')`;
                document.body.style.backgroundRepeat = 'no-repeat';
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundPosition = 'center center';
                document.body.style.backgroundAttachment = 'fixed';
            }
        }
    } catch (_) {}

    // --- START: Action Handler Imports ---
    // Import all functions that can be triggered by menu actions.
    const { handleDeployWordPress, handleDeployGrapes, handleDeployVM } = await import('/static/menus/deploy.js');
    const { listInstances, destroyInstance } = await import('/static/menus/instance.js');
    const { listDomains, registerDomain } = await import('/static/menus/domain.js');
    const { listBillingAccounts } = await import('/static/menus/usage.js');
    const { handleSubscribe, handleCancelSubscription } = await import('/static/menus/subscription.js');
    // --- END: Action Handler Imports ---

    // Define the map of action handlers after all modules have loaded
    actionHandlers = {
        // Deployment actions
        handleDeployWordPress: handleDeployWordPress,
        handleDeployGrapes: handleDeployGrapes,
        handleDeployVM: handleDeployVM,
        // Resource listing actions
        listInstances: listInstances,
        destroyInstance: destroyInstance,
        listDomains: listDomains,
        registerDomain: registerDomain,
        listBillingAccounts: listBillingAccounts,
        // Authentication actions
        handleLogout: handleLogout,
        // Terminal/View actions
        loadTerminalView: loadTerminalView,
        // Subscription actions
        handleSubscribe: handleSubscribe,
        handleCancelSubscription: handleCancelSubscription
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
            navigator.serviceWorker.register('/static/service-worker.js')
                .then(registration => console.log('SW registered: ', registration))
                .catch(registrationError => console.log('SW registration failed: ', registrationError));
        });
    } else {
        console.log('Service Worker not supported in this browser.');
    }
});
