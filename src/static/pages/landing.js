import {
    fetchWithAuth,
    API_BASE_URL,
    updateBackButtonHandler,
    unregisterBackButtonHandler,
    setSiteMode,
    getSiteMode,
    dayOfYear
} from '/static/main.js';
import {
    displayAndPositionTooltip,
    hideTooltip,
    updateLastMouseEvent
} from '/static/pages/menu.js';
import {
    prompt,
    cancelCurrentPrompt,
} from '/static/pages/prompt.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';

let musicControlsCleanup = null;

// --- Configuration ---
const GOOGLE_CLIENT_ID = "320840986458-539gugqm3d618e30s6qcottnu8goh5p1.apps.googleusercontent.com";
// Scopes centralized in /static/scripts/scopes.js; this page doesn't directly use them.

// --- State Variables ---
let taglineAnimationInterval = null;
const playlistIds = ['7LDlK4VLv2RNxaQ7Z4D6qI', '5K2aMLIRcHx4TKG2F1fzfR'];
let dailyPlaylistId = null;
let spotifyEmbedEl = null;
let spotifyEmbedWrapperEl = null;

// --- Music Controls ---
let musicControlsContainerEl = null;
let playPauseButtonEl = null;
let forwardButtonEl = null;
let backwardButtonEl = null;

let isPlaying = false;
let spotifyController = null;
let spotifyIframeApi = null;
let isSpotifyEmbedReady = false;
let musicControlsPositionHandlersAttached = false;

let spikeballEl = null;
let spikeballHandlersAttached = false;
let mockupEl = null;

// --- Mode Toggle ---
let modeToggleContainerEl = null;
let catModeIconEl = null;
let seriousModeIconEl = null;
let modeToggleHandlersAttached = false;


// --- Spotify Functions ---

function loadSpotifyApi() {
    return new Promise((resolve) => {
        // If the API is already loaded and cached, resolve immediately.
        if (spotifyIframeApi) {
            return resolve(spotifyIframeApi);
        }

        // Define the callback that Spotify's script will call.
        window.onSpotifyIframeApiReady = (IFrameAPI) => {
            console.log("Spotify IFrame API is ready.");
            spotifyIframeApi = IFrameAPI; // Cache the API object.
            resolve(IFrameAPI);
        };

        // Create and append the script tag to the document.
        const script = document.createElement('script');
        script.id = 'spotify-api-script';
        script.src = 'https://open.spotify.com/embed/iframe-api/v1';
        script.async = true;
        document.body.appendChild(script);
    });
}

function ensureSpotifyEmbedCreated() {
    // Find the element once and cache it.
    if (!spotifyEmbedEl) {
        spotifyEmbedEl = document.getElementById('global-spotify-embed');
        spotifyEmbedWrapperEl = document.getElementById('spotify-embed-wrapper');
    }

    if (spotifyEmbedEl) {
        spotifyEmbedEl.src = `https://open.spotify.com/embed/playlist/${dailyPlaylistId}?utm_source=generator`;
        isSpotifyEmbedReady = true;
        tryInitializeSpotifyController();
    } else {
        // This error will now only appear on the initial load if the element is missing from index.html
        console.error('Spotify embed element with ID "global-spotify-embed" not found.');
    }

    return spotifyEmbedEl;
}

function tryInitializeSpotifyController() {
    if (spotifyIframeApi && isSpotifyEmbedReady && !spotifyController) {
        initializeSpotifyController();
    }
}

function initializeSpotifyController() {
    if (!spotifyEmbedEl || spotifyController || !spotifyIframeApi) return;

    try {
        const options = {
            uri: `spotify:playlist:${dailyPlaylistId}`
        };

        spotifyIframeApi.createController(spotifyEmbedEl, options, (EmbedController) => {
            spotifyController = EmbedController;
            
            const updatePlaybackState = (state) => {
                if (!state) return;
                isPlaying = !state.isPaused;

                // Always update the button icon when we get a state update.
                if (playPauseButtonEl) {
                    playPauseButtonEl.src = isPlaying ? '/static/resources/pause.gif' : '/static/resources/play.gif';
                }
            };

            // Add listener for playback updates, which will fire immediately with the initial state
            spotifyController.addListener('playback_update', e => updatePlaybackState(e.data));
            
            // You can also listen for the 'ready' event to confirm the Embed is loaded
            spotifyController.addListener('ready', () => {
                console.log('Spotify Embed is ready.');
                // The playback_update event fires shortly after or concurrently with 'ready'
            });
        });

    } catch (error) {
        console.error('Could not initialize Spotify controller:', error);
    }
}

// --- Music Controls Functions ---

function ensureMusicControlsCreated() {
    if (musicControlsContainerEl && document.body.contains(musicControlsContainerEl)) return;

    // 1. Create Container
    musicControlsContainerEl = document.createElement('div');
    musicControlsContainerEl.id = 'music-controls-container';
    musicControlsContainerEl.style.position = 'fixed';
    musicControlsContainerEl.style.zIndex = '15';
    musicControlsContainerEl.style.display = 'none'; // Initially hidden

    // 2. Create Play/Pause Button
    playPauseButtonEl = document.createElement('img');
    playPauseButtonEl.id = 'play-pause-button';
    playPauseButtonEl.src = '/static/resources/play.gif';
    playPauseButtonEl.alt = 'play/pause';
    playPauseButtonEl.style.width = '50px';
    playPauseButtonEl.style.height = '50px';
    playPauseButtonEl.style.cursor = 'pointer';
    playPauseButtonEl.style.display = 'block'; /* Fix for inline element spacing */

    // 3. Add Event Listeners
    playPauseButtonEl.addEventListener('click', togglePlayPause);
    
    // 4. Append to container and then to body
    musicControlsContainerEl.appendChild(playPauseButtonEl);
    document.body.appendChild(musicControlsContainerEl);
}

export function positionMusicControls() {
    if (!musicControlsContainerEl) return;

    const headerHeightPx = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
    const headerHeight = parseInt(headerHeightPx, 10) || 0;
    const bottomOffset = headerHeight / 2;

    // The button is 50px high, so its center is 25px from its edge.
    const buttonHeight = 50;
    let bottomValue = Math.round(bottomOffset - (buttonHeight / 2));

    // Reset styles that might be view-specific
    musicControlsContainerEl.style.marginBottom = '';

    // When not in terminal view, apply special positioning
    if (!document.body.classList.contains('terminal-view-active')) {
        musicControlsContainerEl.style.marginBottom = '30px';
        bottomValue += 2; // Move up by 2px
    }

    musicControlsContainerEl.style.bottom = `${bottomValue}px`;
    
    musicControlsContainerEl.style.left = '50%';
    musicControlsContainerEl.style.transform = 'translateX(-50%)';
    musicControlsContainerEl.style.right = 'auto'; // Unset right property
}

function positionSpotifyEmbed() {
    if (!spotifyEmbedWrapperEl) return;
    
    const landingContainer = document.getElementById('landing-view-container');
    if (!landingContainer) return;

    // Center horizontally on the page
    spotifyEmbedWrapperEl.style.left = '50%';
    spotifyEmbedWrapperEl.style.transform = 'translateX(-50%)';

    // Position vertically below the landing container's content
    const lastChild = landingContainer.lastElementChild;
    if (lastChild) {
        const lastChildRect = lastChild.getBoundingClientRect();
        spotifyEmbedWrapperEl.style.top = `${Math.round(lastChildRect.bottom + window.scrollY + 20)}px`;
    } else {
        const rect = landingContainer.getBoundingClientRect();
        spotifyEmbedWrapperEl.style.top = `${Math.round(rect.bottom + window.scrollY + 20)}px`;
    }
}

function showSpotifyEmbed() {
    ensureSpotifyEmbedCreated();
    if (spotifyEmbedWrapperEl) {
        spotifyEmbedWrapperEl.style.display = 'block';
    }
    positionSpotifyEmbed(); // Set position when shown
}

function hideSpotifyEmbed() {
    if (!spotifyEmbedWrapperEl) return;
    spotifyEmbedWrapperEl.style.display = 'none';
}

function positionTagline() {
    const taglineEl = document.getElementById('hosting-tagline');
    if (!taglineEl) return;

    const landingContainer = document.getElementById('landing-view-container');
    if (!landingContainer) return;

    const lastChild = landingContainer.lastElementChild;
    if (lastChild) {
        const lastChildRect = lastChild.getBoundingClientRect();
        taglineEl.style.top = `${Math.round(lastChildRect.bottom + window.scrollY + 30)}px`;
    } else {
        const rect = landingContainer.getBoundingClientRect();
        taglineEl.style.top = `${Math.round(rect.bottom + window.scrollY + 30)}px`;
    }
}

function showTagline() {
    const taglineEl = document.getElementById('hosting-tagline');
    if (taglineEl) {
        taglineEl.style.display = 'block';
        positionTagline();
        if (!taglineAnimationInterval) {
            initializeTaglineAnimation();
        }
    }
}

function hideTagline() {
    const taglineEl = document.getElementById('hosting-tagline');
    if (taglineEl) {
        taglineEl.style.display = 'none';
        if (taglineAnimationInterval) {
            clearInterval(taglineAnimationInterval);
            taglineAnimationInterval = null;
        }
    }
}

export function showMusicControls() {
    ensureMusicControlsCreated();
    if (musicControlsContainerEl) {
        musicControlsContainerEl.style.display = 'block';
        if (playPauseButtonEl) {
            playPauseButtonEl.src = isPlaying ? '/static/resources/pause.gif' : '/static/resources/play.gif';
        }
        positionMusicControls();
        if (!musicControlsPositionHandlersAttached) {
            window.addEventListener('resize', positionMusicControls);
            musicControlsPositionHandlersAttached = true;
        }
    }
}

export function hideMusicControls() {
    if (!musicControlsContainerEl) return;
    musicControlsContainerEl.style.display = 'none';
    if (musicControlsPositionHandlersAttached) {
        window.removeEventListener('resize', positionMusicControls);
        musicControlsPositionHandlersAttached = false;
    }
}

function initializeMusicControls() {
    ensureMusicControlsCreated();
    // Initially hide them until they are explicitly shown
    hideMusicControls();
    
    // Return a cleanup function
    return () => {
        const musicControlsContainer = document.getElementById('music-controls-container');
        if (musicControlsContainer) {
            document.body.removeChild(musicControlsContainer);
        }
        playPauseButtonEl = null;
        musicControlsContainerEl = null;
    };
}

function togglePlayPause() {
    if (spotifyController) {
        try {
            spotifyController.togglePlay();
            console.log('Toggling Spotify playback');
        } catch (error) {
            console.log('Error controlling Spotify:', error);
            // The UI will be corrected by the next playback_update event.
        }
    } else {
        console.log('Spotify controller not ready yet');
    }
}

function skipToPrevious() {
    if (spotifyController) {
        try {
            spotifyController.previousTrack();
            console.log('Skipping to previous track');
        } catch (error) {
            console.log('Error skipping track:', error);
        }
    }
}

function skipToNext() {
    if (spotifyController) {
        try {
            spotifyController.nextTrack();
            console.log('Skipping to next track');
        } catch (error) {
            console.log('Error skipping track:', error);
        }
    }
}

// --- Spikeball Functions ---

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
    mockupEl.style.cursor = 'pointer';
    mockupEl.onclick = handleMockupClick;
    document.body.appendChild(mockupEl);
    return mockupEl;
}

const _initiateStripeCheckout = async (params) => {
    const { selectedSize } = params;

    const resp = await fetchWithAuth(`${API_BASE_URL}/create-product-checkout-session`, {
        method: 'POST',
        body: {
            embedded: true,
            size: selectedSize
        }
    });
    const data = await resp.json();

    if (!resp.ok || !data.client_secret) {
        throw new Error(data.error || 'Unable to start checkout');
    }

    const backHandler = () => {
        console.log("Back button pressed during checkout, cancelling prompt.");
        cancelCurrentPrompt();
    };

    try {
        updateBackButtonHandler(backHandler);
        await prompt({
            id: 'embedded_checkout_prompt',
            text: 'Complete your purchase',
            type: 'embedded_checkout',
            client_secret: data.client_secret
        });
    } finally {
        unregisterBackButtonHandler();
    }


    console.log("Checkout prompt closed.");
};

const guardedInitiateStripeCheckout = requireAuthAndSubscription(
    _initiateStripeCheckout,
    'purchase a product',
    { skipSubscriptionCheck: true }
);

const _checkoutProcess = async () => {
    const backHandler = () => {
        console.log("Back button pressed during checkout flow, cancelling prompt.");
        cancelCurrentPrompt();
    };

    try {
        updateBackButtonHandler(backHandler);

        const result = await prompt({
            id: 'mockup-purchase-prompt',
            text: 'Froggo Tee ($20)',
            imageUrl: '/static/resources/clothes/froggo.png',
            type: 'form',
            items: [
                {
                    type: 'select',
                    id: 'size',
                    label: 'Size',
                    options: [
                        { label: 'S', value: 'S' },
                        { label: 'M', value: 'M' },
                        { label: 'L', value: 'L' },
                        { label: 'XL', value: 'XL' },
                    ]
                }
            ],
            buttons: [
                { label: 'Checkout', isSubmit: true, value: 'checkout' },
            ],
            cancelable: true
        });

        if (result.status !== 'answered' || !result.value) {
            return; // User cancelled or closed the prompt
        }

        const selectedSize = result.value.size;
        await guardedInitiateStripeCheckout({ selectedSize });

    } finally {
        unregisterBackButtonHandler();
    }
};

const handleMockupClick = (event) => {
    // Stop propagation to prevent any other listeners from firing.
    if (event) event.stopPropagation();
    
    // Call the guarded function without any parameters.
    _checkoutProcess();
};

function positionSpikeball() {
    if (!spikeballEl) return;
    const landingContainer = document.getElementById('landing-view-container');
    if (!landingContainer) return;
    const firstChild = landingContainer.firstElementChild;

    if (firstChild) {
        const firstChildRect = firstChild.getBoundingClientRect();
        const spikeballHeight = spikeballEl.offsetHeight || 200;
        const top = Math.round(firstChildRect.top + window.scrollY - spikeballHeight + 20);
        spikeballEl.style.top = `${top}px`;
    } else {
        // Fallback: Position relative to the container itself if it has no children.
        const containerRect = landingContainer.getBoundingClientRect();
        spikeballEl.style.top = `${Math.round(containerRect.top + window.scrollY)}px`;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const desiredOffsetFromCenter = 130;
    const minRightMargin = 12;
    const elWidth = spikeballEl.offsetWidth || 200;

    const desiredCenterX = Math.round(viewportWidth / 2 + desiredOffsetFromCenter);
    let left = Math.round(desiredCenterX - elWidth / 2);

    const maxLeft = Math.max(0, viewportWidth - minRightMargin - elWidth);
    if (left > maxLeft) left = maxLeft;
    if (left < 0) left = 0;

    spikeballEl.style.left = `${left}px`;
    spikeballEl.style.right = 'auto';

    positionMockupRelativeToSpikeball();
}

function positionMockupRelativeToSpikeball() {
    if (!mockupEl || !spikeballEl) return;

    const spikeballRect = spikeballEl.getBoundingClientRect();
    const mockupWidth = mockupEl.offsetWidth || 100;
    const mockupHeight = mockupEl.offsetHeight || 100;

    const mockupLeft = Math.round(spikeballRect.left + window.scrollX + (spikeballRect.width - mockupWidth) / 2 + 9);
    const mockupTop = Math.round(spikeballRect.top + window.scrollY + (spikeballRect.height - mockupHeight) / 2 - 18);

    mockupEl.style.left = `${mockupLeft}px`;
    mockupEl.style.top = `${mockupTop}px`;
}

function showSpikeball() {
    const el = ensureSpikeballCreated();
    el.style.display = 'block';

    if (mockupEl) {
        mockupEl.style.display = 'block';
    }

    positionSpikeball();

    if (!spikeballHandlersAttached) {
        spikeballHandlersAttached = true;
        window.addEventListener('resize', positionSpikeball);
        window.addEventListener('scroll', positionSpikeball, { passive: true });
    }
}

function hideSpikeball() {
    if (!spikeballEl) return;
    spikeballEl.style.display = 'none';

    if (mockupEl) {
        mockupEl.style.display = 'none';
    }
}

// --- Mode Toggle Functions ---

function setupModeToggle() {
    modeToggleContainerEl = document.getElementById('mode-toggle-container');
    catModeIconEl = document.getElementById('mode-toggle-cat');
    seriousModeIconEl = document.getElementById('mode-toggle-serious');
    if (!modeToggleContainerEl || !catModeIconEl || !seriousModeIconEl) return;

    // Set initial image
    updateModeToggleImage(getSiteMode());

    // Click handler is the same for both
    modeToggleContainerEl.addEventListener('click', () => {
        hideTooltip();
        const currentMode = getSiteMode();
        const newMode = currentMode === 'serious' ? 'cat' : 'serious';
        setSiteMode(newMode);
    });

    // Prevent the default context menu (e.g., on long press on mobile)
    modeToggleContainerEl.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    // Use the reliable check for the primary input method
    const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;

    if (isTouchDevice) {
        // --- Mobile: Press and Hold Logic ---
        let pressHoldTimeout = null;
        let tooltipIsVisible = false;

        const onTouchMove = (event) => {
            if (tooltipIsVisible) {
                displayAndPositionTooltip(event);
            }
        };

        const onTouchEnd = () => {
            clearTimeout(pressHoldTimeout);
            if (tooltipIsVisible) {
                hideTooltip();
                tooltipIsVisible = false;
            }
            modeToggleContainerEl.removeEventListener('touchmove', onTouchMove);
        };

        modeToggleContainerEl.addEventListener('touchstart', (event) => {
            if (tooltipIsVisible) return;
            const tooltipText = modeToggleContainerEl.dataset.tooltipText;
            if (tooltipText) {
                pressHoldTimeout = setTimeout(() => {
                    tooltipIsVisible = true;
                    displayAndPositionTooltip(event, tooltipText, true);
                    modeToggleContainerEl.addEventListener('touchmove', onTouchMove, { passive: true });
                }, 500);
            }
        }, { passive: true });

        modeToggleContainerEl.addEventListener('touchend', onTouchEnd);
        modeToggleContainerEl.addEventListener('touchcancel', onTouchEnd);
    } else {
        // --- Desktop: Mouseover Logic ---
        const onMouseMove = (event) => {
            updateLastMouseEvent(event); // Keep the shared state updated
            displayAndPositionTooltip(event); // Reposition the tooltip
        };

        const onMouseLeave = () => {
            hideTooltip();
            updateLastMouseEvent(null); // Clear the shared state
            modeToggleContainerEl.removeEventListener('mousemove', onMouseMove);
            modeToggleContainerEl.removeEventListener('mouseleave', onMouseLeave);
        };

        modeToggleContainerEl.addEventListener('mouseover', (event) => {
            const tooltipText = modeToggleContainerEl.dataset.tooltipText;
            if (tooltipText) {
                updateLastMouseEvent(event); // Set the initial mouse position
                displayAndPositionTooltip(event, tooltipText); // Trigger the animation
                modeToggleContainerEl.addEventListener('mousemove', onMouseMove);
                modeToggleContainerEl.addEventListener('mouseleave', onMouseLeave);
            }
        });
    }
}

function updateModeToggleImage(mode) {
    if (catModeIconEl && seriousModeIconEl && modeToggleContainerEl) {
        if (mode === 'serious') {
            catModeIconEl.style.display = 'block';
            seriousModeIconEl.style.display = 'none';
            modeToggleContainerEl.dataset.tooltipText = 'cat mode';
        } else { // cat mode
            catModeIconEl.style.display = 'none';
            seriousModeIconEl.style.display = 'block';
            modeToggleContainerEl.dataset.tooltipText = 'serious mode';
        }
    }
}


function positionModeToggle() {
    if (!modeToggleContainerEl) return;
    const landingContainer = document.getElementById('landing-view-container');
    if (!landingContainer) return;
    const firstChild = landingContainer.firstElementChild;

    if (firstChild) {
        const firstChildRect = firstChild.getBoundingClientRect();
        const toggleWidth = modeToggleContainerEl.offsetWidth || 80;
        const toggleHeight = modeToggleContainerEl.offsetHeight || 80;

        let top = Math.round(firstChildRect.top + window.scrollY - toggleHeight);
        let left = Math.round(firstChildRect.left + window.scrollX - toggleWidth);

        // Shift briefcase 1px down in cat mode
        if (getSiteMode() === 'cat') {
            top += 1;
        }

        modeToggleContainerEl.style.top = `${top}px`;
        modeToggleContainerEl.style.left = `${left}px`;
    }
}

function showModeToggle() {
    // The setup function now finds the elements
    if (!modeToggleContainerEl) {
        setupModeToggle();
    }
    if (!modeToggleContainerEl) return; // Exit if still not found

    modeToggleContainerEl.style.display = 'flex';
    positionModeToggle();

    if (!modeToggleHandlersAttached) {
        modeToggleHandlersAttached = true;
        window.addEventListener('resize', positionModeToggle);
        window.addEventListener('scroll', positionModeToggle, { passive: true });
        window.addEventListener('modechange', (e) => {
            updateModeToggleImage(e.detail.mode);
            updateLandingElementsForMode(e.detail.mode);
        });
    }
}

function hideModeToggle() {
    if (modeToggleContainerEl) {
        modeToggleContainerEl.style.display = 'none';
    }
    if (modeToggleHandlersAttached) {
        window.removeEventListener('resize', positionModeToggle);
        window.removeEventListener('scroll', positionModeToggle);
        // It's tricky to remove anonymous functions, this is a simplified approach.
        // For a robust solution, named functions should be used for event listeners.
        modeToggleHandlersAttached = false;
    }
}

function updateLandingElementsForMode(mode) {
    // The music controls should never be visible on the landing page itself.
    hideMusicControls();

    if (mode === 'serious') {
        hideSpotifyEmbed();
        hideSpikeball();
        showTagline();
    } else { // cat mode
        showSpotifyEmbed();
        showSpikeball();
        hideTagline();
    }
}


// --- Initialization and Cleanup ---

export function initialize(dayOfYear) {
    console.log("Initializing landing page specifics...");
    
    // Set daily playlist ID
    dailyPlaylistId = playlistIds[dayOfYear % playlistIds.length];

    
    // Original setup for console/about buttons
    setupLandingInterface();

    // Dynamically load the Spotify API. Once loaded, the controller can be initialized.
    loadSpotifyApi().then(() => {
        // Now that the API is available, try initializing the controller.
        // This function will succeed if the embed is also ready.
        tryInitializeSpotifyController();
    });

    // Get a reference to the Spotify embed and initialize the controller
    ensureSpotifyEmbedCreated();
    
    // The music controls are created on-demand by showMusicControls,
    // but we hide them here in case they were visible from another page.

    // Get a reference to the Spotify embed
    ensureSpotifyEmbedCreated();

    // Add resize listener to keep spotify embed positioned correctly
    window.addEventListener('resize', positionSpotifyEmbed);
    window.addEventListener('resize', positionTagline);

    try { showModeToggle(); } catch (_) {}
    
    // Set initial visibility of landing page elements based on the current mode
    updateLandingElementsForMode(getSiteMode());
    
    // Update legal year dynamically if present
    const legalYearEl = document.getElementById('legal-year');
    if (legalYearEl) {
        const year = new Date().getFullYear();
        legalYearEl.textContent = String(year);
    }
}

export function cleanup() {
    console.log("Cleaning up landing page specifics...");
    hideSpotifyEmbed();
    hideSpikeball();
    hideModeToggle();
    hideTagline();
    
    // Clean up the resize listener
    window.removeEventListener('resize', positionSpotifyEmbed);
    window.removeEventListener('resize', positionTagline);

    // NOTE: The Spotify embed is now part of landing.html and will be removed
    // on page navigation. Music will not persist. The controller and API script
    // are still intentionally left to avoid re-loading them.
}

/**
 * Main function to set up the landing interface.
 * (Adapted for self-contained landing.html)
 */
function setupLandingInterface() {
    // This is called by initialize() now, no need for DOMContentLoaded listener
}

function initializeTaglineAnimation() {
    const taglineEl = document.getElementById('hosting-tagline');
    if (!taglineEl) return;
    taglineEl.innerText = ''; // Clear static HTML text to ensure first animation runs.

    class TextScramble {
        constructor(el) {
            this.el = el;
            this.chars = '!<>-_\\/[]{}—=+*^?#________';
            this.update = this.update.bind(this);
        }
        setText(newText) {
            const oldText = this.el.innerText;
            const length = Math.max(oldText.length, newText.length);
            const promise = new Promise((resolve) => this.resolve = resolve);
            this.queue = [];
            for (let i = 0; i < length; i++) {
                const from = oldText[i] || '';
                const to = newText[i] || '';
                const start = Math.floor(Math.random() * 40);
                const end = start + Math.floor(Math.random() * 40);
                this.queue.push({ from, to, start, end });
            }
            if (this.frameRequest) {
                cancelAnimationFrame(this.frameRequest);
            }
            this.frame = 0;
            this.update();
            return promise;
        }
        update() {
            let output = '';
            let complete = 0;
            for (let i = 0, n = this.queue.length; i < n; i++) {
                let { from, to, start, end, char } = this.queue[i];
                if (this.frame >= end) {
                    complete++;
                    output += to;
                } else if (this.frame >= start) {
                    if (!char || Math.random() < 0.28) {
                        char = this.randomChar();
                        this.queue[i].char = char;
                    }
                    output += `<span class="dud">${char}</span>`;
                } else {
                    output += from;
                }
            }
            this.el.innerHTML = output;
            if (complete === this.queue.length) {
                this.resolve();
            } else {
                this.frameRequest = requestAnimationFrame(this.update);
                this.frame++;
            }
        }
        randomChar() {
            return this.chars[Math.floor(Math.random() * this.chars.length)];
        }
    }

    const allPhrases = [
        "Least boring hosting service.",
        "We make websites.",
        "Zero extortion.",
        "Leave anytime, and take your website with you.",
        "Automatic backups to Google Drive.",
        "Access your infrastructure through GCP.",
        "24 hour customer support.",
        "The only open source hosting platform.",
        "We <3 our customers."
    ];

    // Shuffle the rest of the phrases
    for (let i = allPhrases.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allPhrases[i], allPhrases[j]] = [allPhrases[j], allPhrases[i]];
    }

    const phrases = ["We host websites.", ...allPhrases];
    let currentIndex = 0;
    const scramble = new TextScramble(taglineEl);
    let idleAnimationTimeout = null;

    let stopAllIdleAnimations = false;
    let idleScrambleTimeouts = [];

    const animateOneCharScramble = (position) => {
        if (stopAllIdleAnimations) return;

        const text = taglineEl.innerText;
        const originalChar = text[position];
        if (!originalChar || originalChar.trim() === '') return;

        let changesCount = 0;
        
        // Skew towards lower numbers. 1 is most common, 5 is rarest.
        const maxChanges = Math.floor(Math.pow(Math.random(), 3) * 5) + 1;

        const changeChar = () => {
            if (stopAllIdleAnimations) {
                if (taglineEl.innerText[position] !== originalChar) {
                    let textArray = taglineEl.innerText.split('');
                    textArray[position] = originalChar;
                    taglineEl.innerText = textArray.join('');
                }
                return;
            }

            if (changesCount >= maxChanges) {
                if (taglineEl.innerText[position] !== originalChar) {
                    let textArray = taglineEl.innerText.split('');
                    textArray[position] = originalChar;
                    taglineEl.innerText = textArray.join('');
                }
                return;
            }

            changesCount++;

            let textArray = taglineEl.innerText.split('');
            textArray[position] = scramble.randomChar();
            taglineEl.innerText = textArray.join('');
            
            const delay = Math.pow(Math.random(), 5) * 999 + 1; // Skewed heavily towards shorter delays
            setTimeout(changeChar, delay);
        };

        changeChar();
    };

    const scheduleIdleScramblesForInterval = () => {
        if (stopAllIdleAnimations) return;

        // 50% chance of no spawns. If spawns occur, skew towards fewer.
        const numScrambles = Math.random() < 0.5 ? 0 : Math.floor(Math.pow(Math.random(), 2) * 3) + 1;

        for (let i = 0; i < numScrambles; i++) {
            const startDelay = Math.random() * 7000;
            const timeoutId = setTimeout(() => {
                if (stopAllIdleAnimations) return;
                const text = taglineEl.innerText;
                const len = text.length;
                if (len > 0) {
                    const position = Math.floor(Math.random() * len);
                    animateOneCharScramble(position);
                }
            }, startDelay);
            idleScrambleTimeouts.push(timeoutId);
        }
    };

    function cyclePhrases() {
        stopAllIdleAnimations = true;
        idleScrambleTimeouts.forEach(clearTimeout);
        idleScrambleTimeouts = [];

        scramble.setText(phrases[currentIndex]).then(() => {
            stopAllIdleAnimations = false;
            scheduleIdleScramblesForInterval();
        });
        currentIndex = (currentIndex + 1) % phrases.length;
    }

    const handleTaglineClick = () => {
        if (taglineAnimationInterval) {
            clearInterval(taglineAnimationInterval);
        }
        cyclePhrases();
        taglineAnimationInterval = setInterval(cyclePhrases, 8000);
    };
    
    if (!taglineEl.dataset.clickAttached) {
        taglineEl.addEventListener('click', handleTaglineClick);
        taglineEl.dataset.clickAttached = 'true';
    }

    cyclePhrases();
    taglineAnimationInterval = setInterval(cyclePhrases, 8000);
}

// --- Global Setup (runs when module is loaded) ---
// No longer needed here, handled by dynamic script loader.

document.addEventListener('DOMContentLoaded', () => {
    if (typeof musicControlsCleanup !== 'function') {
        musicControlsCleanup = initializeMusicControls();
    }
}); 