// Central registry for menu configurations - Moved from menus/common.js
export const menus = {};

// Define the base API URL - Moved to variables.js
// export const API_BASE_URL = 'http://localhost:5000/api';

// Import the base API URL
// import { API_BASE_URL } from '../variables.js'; // REMOVED - Now importing from main.js
import {
    API_BASE_URL,
    updateSiteTitleVisibility,
    updateAccountButtonVisibility
} from '/static/main.js'; // Updated import path

// Import the fetch handler - needed for auto-fetching on render
// import { handleFetchResources } from './instance-menu.js'; // Keep this relative path assumption in mind

// Store action handlers provided during initialization
let actionHandlers = {};
let menuContainerElement = null;
let dynamicMenuTitleElement = null; // Renamed to avoid confusion with static site title
let currentAuthState = null; // Store user authentication state
let currentMenuId = null; // Store the ID of the currently rendered menu
let tooltipElement = null; // Reference to the tooltip DOM element
let tooltipTimeout = null; // Store the timeout ID for the tooltip
let tooltipAnimationInterval = null; // Store the interval for the typewriter effect
let lastMouseEvent = null; // Store the last mouse event for desktop positioning

// --- Deployment State Listener ---
// Listens for events from deploy.js to know when to hide the site title.
let isDeploymentActive = false;
window.addEventListener('deploymentstatechange', (e) => {
    isDeploymentActive = !!e.detail.isActive;
    // When the state changes, immediately re-run the collision check.
    checkHeaderCollision();
});

/**
 * Allows other modules to update the last known mouse event, enabling shared tooltip logic.
 * @param {MouseEvent|null} event - The latest mouse event, or null to clear it.
 */
export function updateLastMouseEvent(event) {
    lastMouseEvent = event;
}

/**
 * Updates the authentication state within the menu module.
 * @param {object} newUserState - The new user state object.
 */
export function updateAuthState(newUserState) {
    currentAuthState = newUserState;
}

/**
 * Checks for collision between the site title and header buttons.
 * Hides the site title if it overlaps with either the back or account buttons.
 */
export function checkHeaderCollision() {
    // If the menu is in a loading state, or if the terminal is active, do not interfere.
    // The functions that manage these states are responsible for title visibility.
    if ((menuContainerElement && menuContainerElement.dataset.loading === 'true') || document.body.classList.contains('terminal-view-active') || isDeploymentActive) {
        return;
    }

    const siteTitle = document.getElementById('site-title');
    const accountButton = document.getElementById('account-button');
    const backButton = document.getElementById('back-button');

    // Ensure all elements are present
    if (!siteTitle || !accountButton || !backButton) {
        return;
    }

    // Reset visibility to get accurate measurements
    updateSiteTitleVisibility(true);

    const siteTitleRect = siteTitle.getBoundingClientRect();
    const accountButtonRect = accountButton.getBoundingClientRect();
    const backButtonRect = backButton.getBoundingClientRect();

    const isAccountButtonVisible = window.getComputedStyle(accountButton).display !== 'none';
    const isBackButtonVisible = window.getComputedStyle(backButton).display !== 'none';

    let collision = false;
    // Check for overlap with account button
    if (isAccountButtonVisible && siteTitleRect.right > accountButtonRect.left) {
        collision = true;
    }

    // Check for overlap with back button
    if (isBackButtonVisible && siteTitleRect.left < backButtonRect.right + 10) { // Add 10px buffer
        collision = true;
    }

    // Set visibility based on collision detection
    updateSiteTitleVisibility(!collision);
}

// Function to generate HTML for a list of items
function generateListItemsHTML(items) {
    return items.map(item => {
        const itemType = item.type || 'button';
        const itemId = item.id ? ` id="${item.id}"` : '';

        if (itemType === 'record-group') {
            const subItemsHTML = item.items.map(subItem => {
                const text = (subItem.text === undefined || subItem.text === null || subItem.text === '') ? '&nbsp;' : subItem.text;
                // Note: sub-items in a group do not currently support actions or individual IDs.
                return `<span class="menu-record-group-item">${text}</span>`;
            }).join('');
            return `<li${itemId} class="menu-record">${subItemsHTML}</li>`;
        }

        if (itemType === 'horizontal-container') {
            const subItemsHTML = generateListItemsHTML(item.items || []);
            return `<li${itemId} class="menu-item-container"><ul class="menu-horizontal-list">${subItemsHTML}</ul></li>`;
        }

        // Collect all data attributes from the item object, excluding reserved keys.
        const reservedKeys = ['type', 'id', 'text', 'targetMenu', 'action'];
        let customDataAttrs = '';
        for (const key in item) {
            if (item.hasOwnProperty(key) && !reservedKeys.includes(key)) {
                // Convert camelCase to kebab-case for data attribute names
                const kebabKey = key.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
                // Escape attribute value to be safe
                const attrValue = String(item[key]).replace(/"/g, '&quot;');
                customDataAttrs += ` data-${kebabKey}="${attrValue}"`;
            }
        }

        // These attributes determine if an item is interactive
        const targetAttr = item.targetMenu ? ` data-target-menu="${item.targetMenu}"` : '';
        const actionAttr = item.action ? ` data-action="${item.action}"` : '';
        const tooltipDataAttr = item.tooltip ? ` data-tooltip-text="${String(item.tooltip).replace(/"/g, '&quot;')}"` : '';
        let allDataAttrs = `${targetAttr}${actionAttr}${customDataAttrs}${tooltipDataAttr}`;
        
        // Add a class for the loading indicator
        if (item.showLoading) {
            allDataAttrs += ` data-show-loading="true"`;
        }
        
        // The class determines the visual style
        const isClickable = allDataAttrs.length > 0;
        const classList = [item.type === 'button' ? 'menu-button' : 'menu-record'];
        if (isClickable && classList[0] === 'menu-record') {
            classList.push('menu-actionable'); // For hover/cursor styling
        }
        if (item.className) {
            classList.push(item.className);
        }

        const text = (item.text === undefined || item.text === null || item.text === '') ? '&nbsp;' : item.text;
        return `<li${itemId} class="${classList.join(' ')}"${allDataAttrs}>${text}</li>`;
    }).join('');
}

// Generalized function to generate HTML for any menu
function generateMenuHTML(menuConfig, menuId) {
    if (!menuConfig) {
        console.error(`Menu configuration for "${menuId}" not found.`);
        return '<p>Error: Menu not found.</p>';
    }

    // Get items HTML - Back/Account buttons are now static in index.html
    const listItemsHTML = generateListItemsHTML(menuConfig.items);

    return `
        <div id="${menuId}-view">
            <ul class="menu" id="${menuId}">
                ${listItemsHTML}
            </ul>
        </div>
    `;
}

// Function to render a specific menu
// Exporting renderMenu in case action handlers need it directly
export async function renderMenu(menuIdOrConfig) {
    if (menuContainerElement) {
        delete menuContainerElement.dataset.loading;
        delete menuContainerElement.dataset.previousMenu;
    }
    if (!menuContainerElement) {
         console.error("Menu container not initialized.");
         return;
    }

    let menuConfig;
    let menuId;

    if (typeof menuIdOrConfig === 'string') {
        menuId = menuIdOrConfig;
        // Check if the menu config is a promise (like from buildResourcesMenu)
        const configOrPromise = menus[menuId];
        if (typeof configOrPromise.then === 'function') {
            try {
                // If it's a promise, wait for it to resolve
                menuConfig = await configOrPromise;
                // Since the promise is now resolved, replace it with the actual config
                // to avoid re-fetching unless the page is reloaded.
                menus[menuId] = menuConfig;
            } catch (error) {
                console.error(`Error resolving menu promise for "${menuId}":`, error);
                menuContainerElement.innerHTML = '<p>Error loading menu.</p>';
                return;
            }
        } else if (typeof configOrPromise === 'function') { // It's a generator function
            // Render a loading state immediately, and then fetch the real menu
            // in the background.
            const loadingConfig = {
                id: menuId,
                text: 'loading...',
                items: [{ text: `fetching ${menuId.replace('-menu', '')}...`, type: 'record' }],
                backTarget: 'dashboard-menu' // Assume it returns to dashboard
            };

            // Don't await. Let it run in the background.
            configOrPromise()
                .then(resolvedConfig => {
                    // Cache the resolved config, replacing the function
                    menus[menuId] = resolvedConfig;
                    
                    // Re-render only if the user hasn't navigated away
                    const currentMenu = menuContainerElement.querySelector('.menu');
                    if (currentMenu && currentMenu.id === menuId) {
                        renderMenu(menuId);
                    }
                })
                .catch(error => {
                    console.error(`Error executing menu generator function for "${menuId}":`, error);
                    // Create and cache an error menu
                    menus[menuId] = {
                        id: menuId,
                        text: 'Error',
                        items: [{ text: 'Could not load resources.', type: 'record' }],
                        backTarget: 'dashboard-menu'
                    };
                    // Re-render to show the error
                    const currentMenu = menuContainerElement.querySelector('.menu');
                    if (currentMenu && currentMenu.id === menuId) {
                        renderMenu(menuId);
                    }
                });
            
            // Use the temporary loading config for the initial render
            menuConfig = loadingConfig;
        } else {
            menuConfig = configOrPromise;
        }
    } else if (typeof menuIdOrConfig === 'object' && menuIdOrConfig !== null) {
        // This is a dynamically generated config object (e.g., from domain.js)
        menuConfig = menuIdOrConfig;
        menuId = menuConfig.id || 'dynamic-menu'; // Use an ID from the config or a generic one
    } else {
        console.error("Invalid argument passed to renderMenu. Must be a menu ID string or a config object.");
        return;
    }
    
    if (!menuConfig) {
        console.error(`Menu configuration for "${menuId}" not found.`);
        menuContainerElement.innerHTML = '<p>Error: Menu not found.</p>';
        if (dynamicMenuTitleElement) dynamicMenuTitleElement.textContent = 'Error'; // Update dynamic title on error
        return;
    }

    // Call onLeave for the previous menu if it exists
    if (currentMenuId && currentMenuId !== menuId) {
        const previousMenuConfig = menus[currentMenuId];
        if (previousMenuConfig && typeof previousMenuConfig.onLeave === 'function') {
            try {
                previousMenuConfig.onLeave();
            } catch (error) {
                console.error(`Error during onLeave callback for menu "${currentMenuId}":`, error);
            }
        }
    }

    currentMenuId = menuId; // Store the current menu ID

    // Update static header buttons based on current menu
    // Find buttons dynamically as they might be added/removed
    const backButton = document.getElementById('back-button');
    const isAuthenticated = currentAuthState && !currentAuthState.guest;

    if (backButton) {
        if (menuConfig.backTarget) {
            backButton.style.display = 'inline-block'; // Show back button
            backButton.dataset.targetMenu = menuConfig.backTarget; // Set its target
        } else if (menuId === 'dashboard-menu') {
            // Special case: Show back button on main menu, but don't set target (handled by main.js)
            backButton.style.display = 'inline-block';
            delete backButton.dataset.targetMenu;
        } else {
            backButton.style.display = 'none'; // Hide back button
            delete backButton.dataset.targetMenu;
        }
    } else {
        console.warn("Back button not found during renderMenu");
    }

    // Centralized account button logic
    if (menuId === 'account-menu' || isDeploymentActive) {
        updateAccountButtonVisibility(false);
    } else {
        updateAccountButtonVisibility(true, isAuthenticated);
    }


    // Check for header collision after updating button visibility and content
    checkHeaderCollision();

    // Render the menu based on the current state of the config
    if (dynamicMenuTitleElement) { // Update dynamic title
        dynamicMenuTitleElement.style.display = ''; // Ensure title is visible
        if (typeof menuConfig.text === 'function') {
            dynamicMenuTitleElement.textContent = menuConfig.text(); // Call the function for dynamic title
        } else if (menuConfig.text) {
            dynamicMenuTitleElement.textContent = menuConfig.text; // Use static text
        } else {
        dynamicMenuTitleElement.textContent = ''; // Clear title if none provided
        }
    }
    // Find the dedicated list container and update its HTML
    const listContainer = menuContainerElement.querySelector('#menu-list-container');
    if (listContainer) {
        // Clear any prior status when navigating
        clearStatusDisplay();
        listContainer.innerHTML = generateMenuHTML(menuConfig, menuId);
    } else {
        console.error("Could not find #menu-list-container within #menu-container.");
        // Avoid overwriting the whole container, maybe show error differently
        menuContainerElement.innerHTML = '<p>Error: Menu structure incomplete.</p>'; 
    }

    // After rendering, check if there's an onRender callback for the menu
    if (typeof menuConfig.onRender === 'function') {
        try {
            await menuConfig.onRender();
            // Avoid immediate re-render to preserve listeners and clickability
        } catch (error) {
            console.error(`Error during onRender callback for menu "${menuId}":`, error);
        }
    }
}

// --- Tooltip Handling --- START ---

function ensureTooltipElement() {
    if (tooltipElement && document.body.contains(tooltipElement)) {
        return;
    }
    tooltipElement = document.getElementById('tooltip');
    if (!tooltipElement) {
        console.log("Creating tooltip element.");
        tooltipElement = document.createElement('div');
        tooltipElement.id = 'tooltip';
        document.body.appendChild(tooltipElement);
    }
}

/**
 * Displays and positions the tooltip. If infoText is provided, it shows the tooltip
 * after a delay. If infoText is null, it just updates the position of the visible tooltip.
 * @param {MouseEvent} event - The mouse event.
 * @param {string|null} infoText - The text to display in the tooltip.
 * @param {boolean} isImmediate - If true, bypasses the initial 500ms show delay.
 */
export function displayAndPositionTooltip(event, infoText = null, isImmediate = false) {
    ensureTooltipElement();
    if (!tooltipElement) return;

    const positionTooltip = (e) => {
        if (tooltipElement.style.display !== 'block') return;

        const isTouchEvent = e.type.startsWith('touch');
        const pos = isTouchEvent ? e.touches[0] : e;

        if (!pos) return; // Can happen on touchend

        const tooltipHeight = tooltipElement.offsetHeight;
        const tooltipWidth = tooltipElement.offsetWidth;
        const bodyRect = document.body.getBoundingClientRect();

        let top, left;

        if (isTouchEvent) {
            // Mobile: Horizontally centered ABOVE the finger, with more offset
            top = pos.pageY - tooltipHeight - 60; // Increased offset further
            left = pos.pageX - (tooltipWidth / 2);

            // Boundary checks
            if (left < bodyRect.left + 5) left = bodyRect.left + 5;
            if (left + tooltipWidth > bodyRect.right - 5) left = bodyRect.right - tooltipWidth - 5;
            if (top < bodyRect.top + 5) top = pos.pageY + 25; // Flip below
        } else {
            // Desktop: To the right of the cursor
            const offsetX = 15;
            top = pos.pageY - (tooltipHeight / 2);
            left = pos.pageX + offsetX;

            // Boundary checks
            if (left + tooltipWidth > bodyRect.right) left = pos.pageX - tooltipWidth - offsetX;
            if (left < bodyRect.left) left = bodyRect.left + 5;
            if (top < bodyRect.top) top = bodyRect.top + 5;
            if (top + tooltipHeight > bodyRect.bottom) top = bodyRect.bottom - tooltipHeight - 5;
        }

        tooltipElement.style.left = `${left}px`;
        tooltipElement.style.top = `${top}px`;
    };

    const showAndAnimate = () => {
        const isTouchEvent = event.type.startsWith('touch');

        // Prepare the tooltip element but keep it invisible.
        tooltipElement.textContent = '';
        tooltipElement.style.display = 'block';
        tooltipElement.style.visibility = 'hidden';

        let i = 0;
        clearInterval(tooltipAnimationInterval);
        tooltipAnimationInterval = setInterval(() => {
            if (i < infoText.length) {
                tooltipElement.textContent += infoText.charAt(i);

                // Position the tooltip based on its current content width.
                const currentPositionEvent = isTouchEvent ? event : lastMouseEvent;
                if (currentPositionEvent) {
                    positionTooltip(currentPositionEvent);
                }

                // Make the tooltip visible only on the first frame, after it has content and is positioned.
                if (i === 0) {
                    tooltipElement.style.visibility = 'visible';
                }

                i++;
            } else {
                clearInterval(tooltipAnimationInterval);
            }
        }, 35);
    };

    if (infoText) { // This is a "show" request
        clearTimeout(tooltipTimeout);
        clearInterval(tooltipAnimationInterval);

        const delay = isImmediate ? 0 : 500;
        tooltipTimeout = setTimeout(showAndAnimate, delay);

    } else { // This is a "reposition" request
        positionTooltip(event);
    }
}

export function hideTooltip() {
    clearTimeout(tooltipTimeout); // Clear any pending show requests
    clearInterval(tooltipAnimationInterval); // Stop any ongoing animation
    if (tooltipElement) {
        tooltipElement.style.display = 'none';
    }
}


function findItemInfo(targetLi) {
    if (!targetLi) return null;

    const itemId = targetLi.id || targetLi.dataset.resourceId;
    const menuConfig = menus[currentMenuId];

    if (!menuConfig || !menuConfig.items || !itemId) {
         return null;
    }

    // Find the corresponding item in the menu configuration to get its tooltip text.
    let allItems = [];
    if (Array.isArray(menuConfig.items)) {
        allItems = menuConfig.items;
        menuConfig.items.forEach(item => {
            if (item.instances && Array.isArray(item.instances)) {
                allItems = allItems.concat(item.instances);
            }
        });
    }
    
    return allItems.find(item => item.id === itemId);
}

// Obsolete mouse handlers removed. New logic is self-contained in initializeMenu.

// --- Tooltip Handling --- END ---

// --- Status Display Function --- START ---
export function updateStatusDisplay(message, type = 'info') {
    // Keep console output concise and avoid leaking IDs/URLs
    const condensed = typeof message === 'string' ? message
        .replace(/\b\w{8}-\w{4}-\w{4}-\w{4}-\w{12}\b/g, '[id]')
        .replace(/wss?:\/\/[^\s)]+/g, '[url]')
        : message;
    console.log(`[Status][${type}]`, condensed);

    // If the menu container isn't initialized (e.g., on the landing page),
    // just log the message to the console and do not attempt to manipulate the DOM.
    if (!menuContainerElement) {
        return;
    }

    let statusElement = menuContainerElement.querySelector('#menu-status-message');
    if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.id = 'menu-status-message';
        // Try to insert it in a reasonable place, e.g., before the menu list or at the end of the container.
        const listContainer = menuContainerElement.querySelector('#menu-list-container');
        if (listContainer) {
            // Insert after the list container, or adjust as needed for layout
            listContainer.parentNode.insertBefore(statusElement, listContainer.nextSibling);
        } else {
            // Fallback: append to the main menu container
            menuContainerElement.appendChild(statusElement);
        }

    }

    statusElement.textContent = message;
    statusElement.className = ''; // Clear existing classes
    statusElement.classList.add('menu-status-message'); // Base class for styling

    // Add type-specific class for styling
    if (type === 'error') {
        statusElement.classList.add('menu-status-error');
    } else if (type === 'success') {
        statusElement.classList.add('menu-status-success');
    } else if (type === 'warning') {
        statusElement.classList.add('menu-status-warning');
    } else { // 'info' or other types
        statusElement.classList.add('menu-status-info');
    }
}
// Clear status helper
export function clearStatusDisplay() {
    if (!menuContainerElement) return;
    let statusElement = menuContainerElement.querySelector('#menu-status-message');
    if (statusElement) {
        statusElement.textContent = '';
        statusElement.className = 'menu-status-message';
    }
}
// --- Status Display Function --- END ---

// Cleanup function to call onLeave for current menu
export function cleanupCurrentMenu() {
    if (currentMenuId) {
        const currentMenuConfig = menus[currentMenuId];
        if (currentMenuConfig && typeof currentMenuConfig.onLeave === 'function') {
            try {
                currentMenuConfig.onLeave();
            } catch (error) {
                console.error(`Error during onLeave cleanup for menu "${currentMenuId}":`, error);
            }
        }
        currentMenuId = null;
    }
}

// Re-apply header back button state based on the current menu configuration
export function refreshHeaderButtonsForCurrentMenu() {
    try {
        const backButton = document.getElementById('back-button');
        const isAuthenticated = currentAuthState && !currentAuthState.guest;
        const menuConfig = menus[currentMenuId];

        if (backButton) {
            if (menuConfig && menuConfig.backTarget) {
                backButton.style.display = 'inline-block';
                backButton.dataset.targetMenu = menuConfig.backTarget;
            } else if (currentMenuId === 'dashboard-menu') {
                backButton.style.display = 'inline-block';
                delete backButton.dataset.targetMenu;
            } else {
                backButton.style.display = 'none';
                delete backButton.dataset.targetMenu;
            }
        }

        // Centralized account button logic
        if (currentMenuId === 'account-menu') {
            updateAccountButtonVisibility(false);
        } else {
            updateAccountButtonVisibility(true, isAuthenticated);
        }

        // Re-run header collision check
        checkHeaderCollision();
    } catch (_) {}
}

// Exported function to initialize the menu
export function initializeMenu(containerElement, handlers, userState) {
    if (!containerElement) {
        console.error("Menu container element is required for initialization.");
        return;
    }
    menuContainerElement = containerElement;
    // Search for the title element *within* the provided container
    dynamicMenuTitleElement = containerElement.querySelector('#menu-text'); 
    actionHandlers = handlers || {};      // Store the provided handlers
    currentAuthState = userState;         // Store the user authentication state

    // --- Tooltip Setup --- START ---
    ensureTooltipElement();
    // --- Tooltip Setup --- END ---

    // Initial Render - Start with the main menu (assuming it's registered)
    if (menus['dashboard-menu']) {
         renderMenu('dashboard-menu');
    } else {
        console.error("Main menu configuration not found. Ensure main-menu.js is imported before initialization.");
        menuContainerElement.innerHTML = '<p>Error: Main menu not loaded.</p>';
        if (dynamicMenuTitleElement) dynamicMenuTitleElement.textContent = 'Error';
    }

    // Event Listener using Delegation - Attach to a higher-level static element (#console-container)
    // Ensure listener is only added once
    const siteContainer = document.getElementById('console-container');
    if (siteContainer && !siteContainer.dataset.listenerAttached) {
        siteContainer.dataset.listenerAttached = 'true'; // Mark as attached

        // --- Event Listener using Delegation ---
        // We define the handlers first, then attach the main click listener at the end
        // so it can close over the necessary cleanup functions.

        const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
        let onMouseLeave = () => {}; // No-op for touch devices, redefined for desktop

        if (isTouchDevice) {
            // --- Mobile: Press and Hold Logic ---
            let pressHoldTimeout = null;
            let tooltipIsVisible = false;

            const onTouchMoveToReposition = (event) => {
                if (tooltipIsVisible) {
                    displayAndPositionTooltip(event); // Just reposition
                }
            };

            const cancelPressAndHold = () => {
                clearTimeout(pressHoldTimeout);
                if (tooltipIsVisible) {
                    hideTooltip();
                    tooltipIsVisible = false;
                }
                siteContainer.removeEventListener('touchmove', onTouchMoveToReposition);
            };

            siteContainer.addEventListener('touchstart', (event) => {
                if (tooltipIsVisible) return;
                const targetLi = event.target.closest('li');
                if (!targetLi) return;

                const itemInfo = findItemInfo(targetLi);
                if (itemInfo && itemInfo.tooltip) {
                    pressHoldTimeout = setTimeout(() => {
                        tooltipIsVisible = true;
                        displayAndPositionTooltip(event, itemInfo.tooltip, true);
                        siteContainer.addEventListener('touchmove', onTouchMoveToReposition, { passive: true });
                    }, 500); // 500ms hold duration
                }
            }, { passive: true });

            siteContainer.addEventListener('touchend', cancelPressAndHold);
            siteContainer.addEventListener('touchcancel', cancelPressAndHold);

        } else {
            // --- Desktop: Mouseover Logic ---
            let currentLi = null;

            const onMouseMove = (event) => {
                lastMouseEvent = event; // Continuously update the last mouse event
                displayAndPositionTooltip(event);
            };

            // Redefine the outer-scoped onMouseLeave with the desktop-specific logic.
            onMouseLeave = () => {
                hideTooltip();
                if (currentLi) {
                    currentLi.removeEventListener('mousemove', onMouseMove);
                    currentLi.removeEventListener('mouseleave', onMouseLeave);
                }
                currentLi = null;
                lastMouseEvent = null; // Clear the event when the mouse leaves
            };

            siteContainer.addEventListener('mouseover', (event) => {
                const targetLi = event.target.closest('li');
                if (!targetLi || targetLi === currentLi) return;
                if (currentLi) onMouseLeave();
                currentLi = targetLi;

                const itemInfo = findItemInfo(currentLi);
                if (itemInfo && itemInfo.tooltip) {
                    lastMouseEvent = event; // Store the initial mouse event
                    displayAndPositionTooltip(event, itemInfo.tooltip);
                    currentLi.addEventListener('mousemove', onMouseMove);
                    currentLi.addEventListener('mouseleave', onMouseLeave);
                }
            });
        }
        
        // --- Main Click Handler ---
        // Attaching this last allows it to use the `onMouseLeave` function defined above.
        siteContainer.addEventListener('click', async (event) => {
            // On any click within the container, perform a full tooltip state cleanup.
            // For desktop, this clears hover state. For mobile, touchend has already fired.
            onMouseLeave();

            const target = event.target;

            // Handle static header buttons first
            if (target.id === 'back-button') {
                if (menuContainerElement && menuContainerElement.dataset.loading === 'true') {
                    // If loading, cancel and restore the previous menu
                    console.log('Back clicked during loading, restoring previous menu.');
                    const previousMenuId = menuContainerElement.dataset.previousMenu;
                    if (previousMenuId) {
                        renderMenu(previousMenuId);
                    }
                    // The renderMenu call will clear the loading state attributes and status
                    return; 
                }
                
                if (target.dataset.targetMenu) {
                    console.log(`Navigating (back) to menu: ${target.dataset.targetMenu}`);
                    renderMenu(target.dataset.targetMenu);
                    return; // Handled
                }
            }

            // Account button clicks are now handled differently:
            // - If text is 'authenticate', main.js listener handles it.
            // - If text is 'account', it has data-target-menu, so this listener handles it.
            if (target.id === 'account-button' && target.dataset.targetMenu) {
                 console.log(`Navigating to menu via account button: ${target.dataset.targetMenu}`);
                 renderMenu(target.dataset.targetMenu);
                 return; // Handled
            }

            // Then handle dynamic menu item clicks (LI elements) using closest to support nested clicks/text nodes
            const li = (target && target.closest) ? target.closest('li') : null;
            if (!li) return;
            if (!li.dataset.targetMenu && !li.dataset.action) return;

            const targetMenu = li.dataset.targetMenu;
            const action = li.dataset.action;
            const resourceId = li.dataset.resourceId;
            const directive = li.dataset.directive;
            const returnPage = li.dataset.returnPage;
            const returnMenu = li.dataset.returnMenu;

            if (targetMenu) {
                // Clear status before navigating to a new menu
                try { clearStatusDisplay(); } catch (_) {}
                console.log(`Navigating to menu: ${targetMenu}`);
                renderMenu(targetMenu);
            } else if (action) {
                // --- Generic Loading UI ---
                if (li.dataset.showLoading === 'true') {
                    // Hide menu items
                    if (menuContainerElement) {
                        const listContainer = menuContainerElement.querySelector('#menu-list-container');
                        if (listContainer) {
                            listContainer.innerHTML = ''; // Just clear the menu buttons
                        }
                    }
                    // Hide both titles
                    if (dynamicMenuTitleElement) {
                        dynamicMenuTitleElement.style.display = 'none';
                    }
                    updateSiteTitleVisibility(false);
                    updateAccountButtonVisibility(false);

                    // Set loading state and store the menu to return to
                    if (menuContainerElement) {
                        menuContainerElement.dataset.loading = "true";
                        menuContainerElement.dataset.previousMenu = currentMenuId;
                    }
                }

                // Construct params object by collecting all data attributes from the element
                const params = { ...li.dataset }; // Clone the dataset object
                
                // Pass other necessary context if needed by handlers
                params.renderMenu = renderMenu;
                params.updateStatusDisplay = updateStatusDisplay;
                params.menuContainer = menuContainerElement;
                params.menuTitle = dynamicMenuTitleElement;
                
                console.log(`Action triggered: ${action} with params:`, params);
                // Call the appropriate handler from the provided map
                if (actionHandlers[action]) {
                    try {
                        // Pass the constructed params object
                        await actionHandlers[action](params);
                    } catch (error) {
                        console.error(`Error executing action "${action}":`, error);
                         // Display error in the menu container
                         // Update the menu config to show the error temporarily
                         const currentMenuId = menuContainerElement.querySelector('.menu')?.id || 'dashboard-menu'; // Guess current menu or default
                         menuContainerElement.innerHTML = `<p>Error performing action: ${error.message}</p><span class="back-button" data-target-menu="${currentMenuId}">&lt; back</span>`;
                         if (dynamicMenuTitleElement) dynamicMenuTitleElement.textContent = 'Error'; // Update title on action error
                    } finally {
                        // Action handlers are now responsible for setting the final title.
                        // We no longer need to generically remove rainbow text.
                    }
                } else {
                    console.warn(`No handler found for action: ${action}`);
                }
            } else {
                 // This case should ideally not happen if it's a menu-button without target/action
                 console.log(`Menu button clicked (no action/nav defined): ${target.textContent} (id: ${target.id})`);
            }
        });
    }
}

