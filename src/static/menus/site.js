import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import {
    API_BASE_URL,
    fetchWithAuth,
    loadConsoleView,
    updateBackButtonHandler,
    unregisterBackButtonHandler,
    updateAccountButtonVisibility,
    updateSiteTitleVisibility,
    returnFromTerminal
} from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { fetchSites } from '/static/scripts/utilities.js';
import { prompt, cancelCurrentPrompt } from '/static/pages/prompt.js';
import { establishWebSocketConnection } from '/static/scripts/socket.js';

let fetchedSites = [];
let fetchedVms = []; // Store the raw VM data

function generateSiteDetailsMenu(siteId) {
    const site = fetchedSites.find(i => i.id === siteId);
    if (!site) {
        return {
            id: `site-details-error-${siteId}`,
            text: 'Error',
            items: [{ id: 'site-not-found', text: 'Site details not found.', type: 'record' }],
            backTarget: 'site-list-menu'
        };
    }
    let address = 'N/A';
    let addressUrl = null;
    if (site.domain) {
        addressUrl = `https://${site.domain}`;
        address = addressUrl;
    } else if (site.ip_address && site.port) {
        addressUrl = `http://${site.ip_address}:${site.port}`;
        address = addressUrl;
    } else if (site.ip_address) {
        addressUrl = `http://${site.ip_address}`;
        address = addressUrl;
    }

    const addressItem = addressUrl 
        ? { id: `details-address-${site.id}`, text: `Address: ${address}`, type: 'record', action: 'openAddress', url: addressUrl }
        : { id: `details-address-${site.id}`, text: `Address: ${address}`, type: 'record' };

    // (Details menu generation logic remains the same)
    let detailItems = [
        { id: `details-machine-name-${site.id}`, text: `Machine: ${site.machine_name || 'Unknown'}`, type: 'record' },
        { id: `details-schedule-${site.id}`, text: `Backups: ${site.backup_schedule || 'manual'}`, type: 'record' },
        addressItem,
        { id: `deployment-destroy-${site.id}`, text: 'destroy', type: 'button', action: 'destroyDeployment', resourceId: site.id }
            ];
    return {
        id: `site-details-menu-${site.id}`,
        text: `Site: ${site.name}`,
        items: detailItems,
        backTarget: 'site-list-menu'
    };
}

// This is the core logic, to be wrapped by our guard.
async function _listSitesLogic(params) {
    const { renderMenu } = params;
    renderMenu({
        id: 'site-list-menu',
        text: 'loading...',
        items: [{ text: 'fetching sites...', type: 'record' }],
        backTarget: 'resource-menu'
    });

    try {
        const vms = await fetchSites();
        let allDeployments = [];
        let emptyMessage = 'no sites found';

        // Flatten the nested structure from the API into a single list of deployments
        if (Array.isArray(vms)) {
            vms.forEach(vm => {
                if (vm.deployments && vm.deployments.length > 0) {
                    const deployments = vm.deployments.map(dep => ({
                        // Create a unique ID for the deployment for the UI
                        id: `${vm.id}-${dep.deployment_name}`,
                        name: dep.deployment_name,
                        // Carry over necessary parent VM and specific deployment info
                        deployment: dep.deployment_name, // for destroy action
                        project_id: vm.id, // The VM id is the project_id for destroy
                        machine_name: vm.name,
                        status: vm.status,
                        ip_address: vm.ip_address,
                        domain: dep.domain,
                        port: dep.port,
                        zone: vm.zone,
                        backup_schedule: dep.backup_schedule,
                        type: 'deployment' // A new type to distinguish from old structure
                    }));
                    allDeployments.push(...deployments);
                }
            });
        }
        
        fetchedSites = allDeployments; // This now stores the flattened list of deployments
        fetchedVms = vms; // Keep the original VM data if needed elsewhere

        const siteItems = allDeployments.map(item => {
            const isDisabled = item.status === 'provisioning';
            return {
                id: `site-${item.id}`,
                text: isDisabled ? `${item.name}...` : item.name,
                targetMenu: `site-details-menu-${item.id}`,
                resourceId: item.id,
                type: 'button',
                disabled: isDisabled
            };
        });

        if (siteItems.length === 0) {
             siteItems.push({ id: 'no-sites', text: emptyMessage, type: 'record' });
        }

        const finalConfig = {
            id: 'site-list-menu',
            text: 'sites:',
            items: siteItems,
            backTarget: 'resource-menu'
        };
        menus['site-list-menu'] = finalConfig;

        fetchedSites.forEach(site => {
            menus[siteDetailsMenuId(site.id)] = generateSiteDetailsMenu(site.id);
        });

        renderMenu('site-list-menu');
    } catch (error) {
        renderMenu({
            id: 'site-list-menu',
            text: 'error',
            items: [{ text: `could not load sites: ${error.message}`, type: 'record' }],
            backTarget: 'resource-menu'
        });
    }
}

function siteDetailsMenuId(id) {
    return `site-details-menu-${id}`;
}

// Export the guarded function as the main action handler.
export const listSites = requireAuthAndSubscription(_listSitesLogic, 'view sites'); 

// Action handler to destroy a deployment
export const destroyDeployment = requireAuthAndSubscription(async (params) => {
    const { resourceId, renderMenu, menuContainer, menuTitle } = params;
    if (!resourceId) {
        updateStatusDisplay('Missing site ID for destruction.', 'error');
        return;
    }

    const site = fetchedSites.find(i => i.id === resourceId);
    if (!site || !site.machine_name || !site.deployment) {
        updateStatusDisplay('Site data is incomplete for destroy operation.', 'error');
        return;
    }

    const confirmation = await prompt({
        id: 'confirm-destroy-prompt',
        text: `Are you sure you want to destroy the deployment '${site.deployment}'? This cannot be undone.`,
        type: 'options',
        options: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }]
    });

    if (confirmation.status !== 'answered' || confirmation.value !== 'yes') {
        updateStatusDisplay('Destruction cancelled.', 'info');
        return;
    }

    // --- Start: Show Loading GIF & Rainbow Text ---
    document.body.classList.add('deployment-loading');
    updateAccountButtonVisibility(false);
    updateSiteTitleVisibility(false);
    if (menuContainer) {
        const listContainer = menuContainer.querySelector('#menu-list-container');
        if (listContainer) {
            listContainer.innerHTML = ''; // Clear the menu buttons
            const loadingGif = document.createElement('img');
            loadingGif.src = '/static/resources/happy-cat.gif';
            loadingGif.alt = 'Loading...';
            loadingGif.className = 'loading-gif';
            listContainer.appendChild(loadingGif);
        }
        if (menuTitle) {
            menuTitle.textContent = 'destroying';
            menuTitle.classList.add('rainbow-text');
        }
    }
    // --- End: Show Loading GIF & Rainbow Text ---

    try {
        updateStatusDisplay('Initiating destruction...', 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/destroy`, {
            method: 'POST',
            body: {
                vm_name: site.machine_name,
                deployment: site.deployment
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to start destruction task.');
        }

        // The destroy process is now always in the background.
        // We just show the success message and refresh the list.
        updateStatusDisplay(result.message, 'success');
        
        // Refresh the site list to show the change
        _listSitesLogic({ renderMenu });

    } catch (e) {
        console.error('Destroy error:', e);
        updateStatusDisplay(`Could not destroy: ${e.message}`, 'error');
    } finally {
        // --- Start: Hide Loading GIF & Rainbow Text ---
        document.body.classList.remove('deployment-loading');
        if (menuTitle) {
            menuTitle.classList.remove('rainbow-text');
        }
        // --- End: Hide Loading GIF & Rainbow Text ---
    }
}, 'destroy a deployment');

// Action handler to open an address in a new tab
export function openAddress(params) {
    const { item } = params;
    if (item && item.url) {
        window.open(item.url, '_blank', 'noopener,noreferrer');
    }
}

// Action handler to destroy a VM site
export async function destroySite(params) {
    try {
        const { resourceId } = params;
        if (!resourceId) {
            updateStatusDisplay('missing site id', 'error');
            return;
        }
        // resourceId is now a composite ID like "vm-timestamp-deployment-name"
        const site = fetchedSites.find(i => i.id === resourceId);
        if (!site || !site.machine_name || !site.deployment) {
            updateStatusDisplay('Site data is incomplete for destroy operation.', 'error');
            return;
        }
        updateStatusDisplay('destroying...', 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/destroy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vm_name: site.machine_name, deployment: site.deployment })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'failed to destroy');
        updateStatusDisplay('destroy requested', 'success');
        // Refresh sites list
        await _listSitesLogic({ renderMenu });
        updateStatusDisplay('', 'info');
    } catch (e) {
        console.error('destroy error:', e);
        updateStatusDisplay(`could not destroy: ${e.message}`, 'error');
    }
}