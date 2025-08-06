// Central registry for menu configurations - Moved from menus/common.js
export const menus = {};

// Define the base API URL - Moved to variables.js
// export const API_BASE_URL = 'http://localhost:5000/api';

// Import the base API URL
// import { API_BASE_URL } from '../variables.js'; // REMOVED - Now importing from main.js
import { API_BASE_URL } from '/static/main.js'; // Updated import path

// Import the fetch handler - needed for auto-fetching on render
// import { handleFetchResources } from './instance-menu.js'; // Keep this relative path assumption in mind

// Store action handlers provided during initialization
let actionHandlers = {};
let menuContainerElement = null;
let dynamicMenuTitleElement = null; // Renamed to avoid confusion with static site title
let currentLoginState = null; // Store user login state
let currentMenuId = null; // Store the ID of the currently rendered menu
let tooltipElement = null; // Reference to the tooltip DOM element
let tooltipTimeout = null; // Store the timeout ID for the tooltip

/**
 * Checks for collision between the site title and header buttons.
 * Hides the site title if it overlaps with either the back or account buttons.
 */
export function checkHeaderCollision() {
    const siteTitle = document.getElementById('site-title');
    const accountButton = document.getElementById('account-button');
    const backButton = document.getElementById('back-button');

    // Ensure all elements are present
    if (!siteTitle || !accountButton || !backButton) {
        return;
    }

    // Reset visibility to get accurate measurements
    siteTitle.style.visibility = 'visible';

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
    if (isBackButtonVisible && siteTitleRect.left < backButtonRect.right) {
        collision = true;
    }

    // Set visibility based on collision detection
    siteTitle.style.visibility = collision ? 'hidden' : 'visible';
}

// Function to generate HTML for a list of items
function generateListItemsHTML(items) {
    return items.map(item => {
        const itemType = item.type || 'button';
        const itemId = item.id ? ` id="${item.id}"` : '';

        // These attributes determine if an item is interactive
        const targetAttr = item.targetMenu ? ` data-target-menu="${item.targetMenu}"` : '';
        const actionAttr = item.action ? ` data-action="${item.action}"` : '';
        const resourceIdAttr = item.resourceId ? ` data-resource-id="${item.resourceId}"` : '';
        const allDataAttrs = `${targetAttr}${actionAttr}${resourceIdAttr}`;
        
        // The class determines the visual style
        const isClickable = allDataAttrs.length > 0;
        let className = itemType === 'button' ? 'menu-button' : 'menu-record';
        if (isClickable && className === 'menu-record') {
            className += ' menu-actionable'; // For hover/cursor styling
        }

        return `<li${itemId} class="${className}"${allDataAttrs}>${item.text}</li>`;
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
    const accountButton = document.getElementById('account-button');

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

    if (accountButton) {
        // Visibility: Hide only on the account menu itself.
        if (menuId === 'account-menu') {
            accountButton.style.display = 'none';
            delete accountButton.dataset.targetMenu;
        } else {
            accountButton.style.display = 'inline-block';
            // Text and Target: Based on login state.
            if (currentLoginState && !currentLoginState.guest) {
                // Logged in user
                accountButton.textContent = 'account';
                accountButton.dataset.targetMenu = 'account-menu';
            } else {
                // Guest or logged out
                accountButton.textContent = 'authenticate';
                delete accountButton.dataset.targetMenu;
            }
        }
    } else {
        console.warn("Account button not found during renderMenu");
    }

    // Check for header collision after updating button visibility and content
    checkHeaderCollision();

    // Render the menu based on the current state of the config
    if (dynamicMenuTitleElement) { // Update dynamic title
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
        listContainer.innerHTML = generateMenuHTML(menuConfig, menuId);
    } else {
        console.error("Could not find #menu-list-container within #menu-container.");
        // Avoid overwriting the whole container, maybe show error differently
        menuContainerElement.innerHTML = '<p>Error: Menu structure incomplete.</p>'; 
    }

    // After rendering, check if there's an onRender callback for the menu
    if (typeof menuConfig.onRender === 'function') {
        // We wrap this in a timeout to allow the DOM to update first from the render
        // This is a bit of a hack; a more robust solution might use MutationObserver or a framework
        setTimeout(async () => {
            try {
                // Re-find the menu in case it was modified by another process
                const currentRenderedMenuId = menuContainerElement.querySelector('.menu')?.id;
                // Only execute if the user is still on the same menu
                if (currentRenderedMenuId === menuId) {
                    await menuConfig.onRender();
                    // Re-render the menu to show the updated state from the callback
                    renderMenu(menuId);
                } else {
                    console.log(`onRender for ${menuId} skipped; user navigated to ${currentRenderedMenuId}.`);
                }
            } catch (error) {
                console.error(`Error during onRender callback for menu "${menuId}":`, error);
            }
        }, 0);
    }
}

// --- Tooltip Handling --- START ---

// Function to calculate and apply tooltip position
function updateTooltipPosition(event) {
    if (!tooltipElement || tooltipElement.style.display !== 'block') return;

    const offsetX = 15; // Fixed horizontal offset to the right of the cursor

    // Get tooltip dimensions *after* it's potentially filled with content
    const tooltipHeight = tooltipElement.offsetHeight;
    const tooltipWidth = tooltipElement.offsetWidth;

    // Calculate desired position: centered vertically, offset to the right
    let top = event.pageY - (tooltipHeight / 2);
    let left = event.pageX + offsetX;

    // Boundary Checks
    const bodyRect = document.body.getBoundingClientRect();

    // Adjust left if it goes off the right edge
    if (left + tooltipWidth > bodyRect.right) {
        left = event.pageX - tooltipWidth - offsetX; // Place it to the left instead
    }
    // Adjust left if it goes off the left edge (in case it was flipped)
    if (left < bodyRect.left) {
        left = bodyRect.left + 5; // Add a small padding from the edge
    }

    // Adjust top if it goes off the top edge
    if (top < bodyRect.top) {
        top = bodyRect.top + 5; // Add small padding
    }
    // Adjust top if it goes off the bottom edge
    if (top + tooltipHeight > bodyRect.bottom) {
        top = bodyRect.bottom - tooltipHeight - 5; // Add small padding
    }

    tooltipElement.style.left = `${left}px`;
    tooltipElement.style.top = `${top}px`;
}

function showTooltip(event, infoText) {
    if (!tooltipElement || !infoText) return;

    // Use a short delay before showing the tooltip
    clearTimeout(tooltipTimeout); // Clear any existing timeout
    tooltipTimeout = setTimeout(() => {
        tooltipElement.textContent = infoText;
        tooltipElement.style.display = 'block';
        updateTooltipPosition(event);
    }, 500); // 500ms delay
}

function hideTooltip() {
    clearTimeout(tooltipTimeout); // Clear timeout when mouse leaves
    if (tooltipElement) {
        tooltipElement.style.display = 'none';
    }
}

async function handleMenuMouseOver(event) {
    const target = event.target;
    // Ensure we are hovering over a list item with a resource ID
    if (target.tagName === 'LI' && target.dataset.resourceId) {
        const resourceId = target.dataset.resourceId;
        const menuConfig = menus[currentMenuId];

        if (!menuConfig || !menuConfig.items) {
             console.log("No menu config or items for tooltip.");
             return;
        }

        // The item might be nested inside a dynamic configuration (e.g., under 'instances')
        // We need a more robust way to find the item data.
        let allItems = [];
        if (Array.isArray(menuConfig.items)) {
            allItems = menuConfig.items;
            // If items have nested 'instances' arrays, flatten them
            menuConfig.items.forEach(item => {
                if (item.instances && Array.isArray(item.instances)) {
                    allItems = allItems.concat(item.instances);
                }
            });
        }
        
        const itemInfo = allItems.find(item => item.id === resourceId);

        if (itemInfo && itemInfo.tooltip) {
            showTooltip(event, itemInfo.tooltip);
        }
    }
}

function handleMenuMouseOut(event) {
    // Hide the tooltip when the mouse leaves the list item or the menu container
    hideTooltip();
}

// --- Tooltip Handling --- END ---

// --- Status Display Function --- START ---
export function updateStatusDisplay(message, type = 'info') {
    if (!menuContainerElement) {
        console.warn("Menu container not initialized. Status update only to console:", message);
        // Fallback for critical messages if UI isn't ready
        if (type === 'error' || type === 'warning') {
            alert(`Status [${type.toUpperCase()}]: ${message}`);
        }
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
    statusElement.classList.add('menu-status-message'); // Base class

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
    console.log(`[MenuStatus][${type.toUpperCase()}] ${message}`);
}
// --- Status Display Function --- END ---

// Function to explicitly hide the main console container
export function hideConsoleContainer() {
    const consoleContainer = document.getElementById('console-container');
    if (consoleContainer) {
        consoleContainer.classList.add('hidden');
    }
}

// Function to explicitly show the main console container
export function showConsoleContainer() {
    const consoleContainer = document.getElementById('console-container');
    if (consoleContainer) {
        consoleContainer.classList.remove('hidden');
    }
}

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
    currentLoginState = userState;        // Store the user login state

    // --- Tooltip Setup --- START ---
    if (!tooltipElement) {
        tooltipElement = document.getElementById('tooltip');
        if (!tooltipElement) {
            console.log("Creating tooltip element.");
            tooltipElement = document.createElement('div');
            tooltipElement.id = 'tooltip';
            document.body.appendChild(tooltipElement);
            // Styles are applied via CSS
        }
    }
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
        siteContainer.addEventListener('click', async (event) => {
            const target = event.target;

            // Handle static header buttons first
            if (target.id === 'back-button' && target.dataset.targetMenu) {
                console.log(`Navigating (back) to menu: ${target.dataset.targetMenu}`);
                renderMenu(target.dataset.targetMenu);
                return; // Handled
            }
            // Account button clicks are now handled differently:
            // - If text is 'authenticate', main.js listener handles it.
            // - If text is 'account', it has data-target-menu, so this listener handles it.
            if (target.id === 'account-button' && target.dataset.targetMenu) {
                 console.log(`Navigating to menu via account button: ${target.dataset.targetMenu}`);
                 renderMenu(target.dataset.targetMenu);
                 return; // Handled
            }

            // Then handle dynamic menu item clicks (LI elements)
            if (target.tagName !== 'LI' || (!target.dataset.targetMenu && !target.dataset.action)) {
                // If it's not a LI, or it is but has no action/nav attributes, ignore it.
                return;
            }

            const targetMenu = target.dataset.targetMenu;
            const action = target.dataset.action;
            const resourceId = target.dataset.resourceId;
            const directive = target.dataset.directive;
            const returnPage = target.dataset.returnPage;
            const returnMenu = target.dataset.returnMenu;

            if (targetMenu) {
                console.log(`Navigating to menu: ${targetMenu}`);
                renderMenu(targetMenu);
            } else if (action) {
                // Construct params object
                const params = {
                    resourceId,
                    directive,
                    returnPage,
                    returnMenu,
                    // Pass other necessary context if needed by handlers
                    renderMenu,
                    updateStatusDisplay, // Pass the function here
                    menuContainer: menuContainerElement,
                    menuTitle: dynamicMenuTitleElement
                };
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
                    }
                } else {
                    console.warn(`No handler found for action: ${action}`);
                }
            } else {
                 // This case should ideally not happen if it's a menu-button without target/action
                 console.log(`Menu button clicked (no action/nav defined): ${target.textContent} (id: ${target.id})`);
            }
        });

        // --- Add Tooltip Listeners --- START ---
        siteContainer.addEventListener('mouseover', handleMenuMouseOver);
        siteContainer.addEventListener('mouseout', handleMenuMouseOut);
        // Update position on mouse move
        siteContainer.addEventListener('mousemove', (event) => {
            // Simply call the update function if the tooltip is visible
            updateTooltipPosition(event);
        });
        // --- Add Tooltip Listeners --- END ---
    }
}

