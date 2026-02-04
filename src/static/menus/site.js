import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import {
    API_BASE_URL,
    fetchWithAuth,
    updateAccountButtonVisibility,
    updateSiteTitleVisibility
} from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { fetchSites as apiFetchSites } from '/static/scripts/utilities.js';
import { prompt } from '/static/pages/prompt.js';

// No more global cache. Data is fetched on demand.

function generateSiteDetailsMenu(site) {
    if (!site) {
        return {
            id: `site-details-error-generic`,
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

    let detailItems = [
        { id: `details-machine-name-${site.id}`, text: `Machine: ${site.machine_name || 'Unknown'}`, type: 'record' },
        { id: `details-status-${site.id}`, text: `Status: ${site.status || 'Unknown'}`, type: 'record' },
        { id: `details-schedule-${site.id}`, text: `Backups: ${site.backup_schedule || 'manual'}`, type: 'record' },
        addressItem,
    ];

    if (site.wordpress) {
        const adminUrl = addressUrl ? `${addressUrl}/wp-admin` : null;
        if (adminUrl) {
            detailItems.push({ id: `details-wp-admin-${site.id}`, text: 'admin panel', type: 'button', action: 'openAddress', url: adminUrl });
        }
    }

    // Pass necessary data for the destroy action via data attributes.
    // menu.js will convert camelCase properties to kebab-case data attributes.
    detailItems.push({ 
        id: `deployment-destroy-${site.id}`, 
        text: 'destroy', 
        type: 'button', 
        action: 'destroyDeployment', 
        showLoading: true, // Opt-in to the generic loading UI
        resourceId: site.id,
        deployment: site.deployment,
        machineName: site.machine_name
    });

    return {
        id: `site-details-menu-${site.id}`,
        text: `Site: ${site.name}`,
        items: detailItems,
        backTarget: 'site-list-menu'
    };
}

async function fetchAndProcessDeployments() {
    const vms = await apiFetchSites();
        let allDeployments = [];
        if (Array.isArray(vms)) {
            vms.forEach(vm => {
                if (vm.deployments && vm.deployments.length > 0) {
                    const deployments = vm.deployments.map(dep => ({
                        id: `${vm.id}-${dep.deployment_name}`,
                        name: dep.deployment_name,
                    deployment: dep.deployment_name,
                    project_id: vm.id,
                        machine_name: vm.name,
                        status: dep.status,
                        ip_address: vm.ip_address,
                        domain: dep.domain,
                        port: dep.port,
                    wordpress: dep.wordpress,
                        zone: vm.zone,
                        backup_schedule: dep.backup_schedule,
                    type: 'deployment'
                    }));
                    allDeployments.push(...deployments);
                }
            });
        }
    return allDeployments;
}

function cacheAllSiteMenus(sites) {
    const siteItems = sites.map(item => {
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
         siteItems.push({ id: 'no-sites', text: 'no sites found', type: 'record' });
        }

    menus['site-list-menu'] = {
            id: 'site-list-menu',
            text: 'sites:',
            items: siteItems,
            backTarget: 'resource-menu'
        };

    sites.forEach(site => {
        menus[`site-details-menu-${site.id}`] = generateSiteDetailsMenu(site);
    });
}

async function _listSitesLogic(params) {
    const { renderMenu, updateStatusDisplay } = params;
    try {
        updateStatusDisplay('fetching sites...', 'info');
        const sites = await fetchAndProcessDeployments();
        cacheAllSiteMenus(sites);
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

export const listSites = requireAuthAndSubscription(_listSitesLogic, 'view sites'); 

export async function viewSite(siteId) {
    // Check if the site details are already cached from a recent fetch.
    if (menus[`site-details-menu-${siteId}`]) {
        // If cached, render it directly for a fast transition.
        renderMenu(`site-details-menu-${siteId}`);
    } else {
        // If not cached (e.g., direct navigation after deployment), show a loading state.
        renderMenu({
            id: `site-details-menu-${siteId}`,
            text: 'site:', // Lowercase as requested
            items: [{ id: 'loading-site', text: 'loading...', type: 'record' }],
            backTarget: 'site-list-menu'
        });

        try {
            // Fetch all sites to update the cache.
            const sites = await fetchAndProcessDeployments();
            cacheAllSiteMenus(sites); // Re-builds all menus with fresh data
            
            // Now that the cache is populated, render the menu with the real data.
            renderMenu(`site-details-menu-${siteId}`);
        } catch (error) {
            console.error(`Error fetching site details for ${siteId}:`, error);
            renderMenu({
                id: `site-details-error-${siteId}`,
                text: 'Error',
                items: [{ id: 'site-fetch-error', text: `Could not load site: ${error.message}`, type: 'record' }],
                backTarget: 'site-list-menu'
            });
        }
    }
} 

export const destroyDeployment = requireAuthAndSubscription(async (params) => {
    const { deployment, machineName, renderMenu, menuContainer, menuTitle } = params;

    if (!deployment || !machineName) {
        updateStatusDisplay('Site data is incomplete for destroy operation.', 'error');
        return;
    }

    const confirmation = await prompt({
        id: 'confirm-destroy-prompt',
        text: `Are you sure you want to destroy the deployment '${deployment}'? This cannot be undone.`,
        type: 'options',
        options: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }]
    });

    if (confirmation.status !== 'answered' || confirmation.value !== 'yes') {
        updateStatusDisplay('Destruction cancelled.', 'info');
        return;
    }

    try {
        updateStatusDisplay('Initiating destruction...', 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/destroy`, {
            method: 'POST',
            body: {
                vm_name: machineName,
                deployment: deployment
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to start destruction task.');
        }

        updateStatusDisplay(result.message, 'success');
        
        // After destruction, refresh the list of sites.
        // Pass both renderMenu and updateStatusDisplay as required by _listSitesLogic.
        await _listSitesLogic({ renderMenu, updateStatusDisplay });

    } catch (e) {
        console.error('Destroy error:', e);
        updateStatusDisplay(`Could not destroy: ${e.message}`, 'error');
        // The generic handler will clear the rainbow text, but we should
        // ensure the title is reset to something sensible on error.
        if (menuTitle) {
            menuTitle.textContent = 'error';
        }
    }
}, 'destroy a deployment');

export function openAddress(params) {
    if (params && params.url) {
        window.open(params.url, '_blank', 'noopener,noreferrer');
    }
}

export async function destroySite(params) {
    const { deployment, machineName, renderMenu } = params;
    if (!deployment || !machineName) {
            updateStatusDisplay('Site data is incomplete for destroy operation.', 'error');
            return;
        }
    
    try {
        updateStatusDisplay('destroying...', 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/destroy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vm_name: machineName, deployment: deployment })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'failed to destroy');
        updateStatusDisplay('destroy requested', 'success');
        
        await _listSitesLogic({ renderMenu });
        updateStatusDisplay('', 'info');
    } catch (e) {
        console.error('destroy error:', e);
        updateStatusDisplay(`could not destroy: ${e.message}`, 'error');
    }
}
