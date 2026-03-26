import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { registerHandler } from '../scripts/registry.js';
import { CONFIG } from '/static/config.js';
import {
    fetchWithAuth,
    updateAccountButtonVisibility,
    updateSiteTitleVisibility
} from '/static/main.js';

const API_BASE_URL = CONFIG.API_BASE_URL;
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { fetchSites as apiFetchSites } from '/static/scripts/api.js';
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

    let detailItems = [
        { id: `details-machine-name-${site.id}`, text: `Machine: ${site.machine_name || 'Unknown'}`, type: 'record' },
        { id: `details-status-${site.id}`, text: `Status: ${site.status || 'Unknown'}`, type: 'record' },
        { id: `details-schedule-${site.id}`, text: `Backups: ${site.backup_schedule || 'manual'}`, type: 'record' },
    ];

    if (site.status !== 'provisioning') {
        let address = 'N/A';
        let addressUrl = null;

        if (site.status === 'relinking') {
            if (site.relinking_source_for) {
                // This deployment is LOSING a domain. Its future address is port-based.
                addressUrl = `http://${site.ip_address}:${site.port}`;
                address = `${addressUrl}...`; 
            } else if (site.relinking_target_for) {
                // This deployment is GAINING a domain. Its future address is domain-based.
                const domain = site.relinking_target_for;
                addressUrl = `https://${domain}`;
                address = `${addressUrl}...`;
            }
        } else {
            // Standard address logic for stable sites
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
        }

        const addressItem = addressUrl 
            ? { id: `details-address-${site.id}`, text: `Address: ${address}`, type: 'record', action: 'openAddress', url: addressUrl, className: 'details-last-record' }
            : { id: `details-address-${site.id}`, text: `Address: ${address}`, type: 'record', className: 'details-last-record' };
        
        detailItems.push(addressItem);

        if (addressUrl) {
            detailItems.push({ id: `details-front-page-${site.id}`, text: 'front page', type: 'button', action: 'openAddress', url: addressUrl });
        }

        if (site.wordpress && site.status !== 'relinking') {
            const adminUrl = addressUrl ? `${addressUrl}/wp-admin` : null;
            if (adminUrl) {
                detailItems.push({ id: `details-wp-admin-${site.id}`, text: 'admin panel', type: 'button', action: 'openAddress', url: adminUrl });
            }
        }
    }

    // Only add the destroy button if the site is not being destroyed or provisioned
    if (site.status !== 'destroying' && site.status !== 'provisioning') {
        detailItems.push({ 
            id: `deployment-destroy-${site.id}`, 
            text: 'destroy', 
            type: 'button', 
            action: 'destroyDeployment', 
            showLoading: true, // Opt-in to the generic loading UI
            resourceId: site.id,
            deployment: site.deployment,
            machineId: site.project_id
        });
    }

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
                        relinking_target_for: dep.relinking_target_for,
                        relinking_source_for: dep.relinking_source_for,
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
                type: 'record',
                action: 'viewSite',
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
    const { updateStatusDisplay } = params;
    updateStatusDisplay('fetching sites...', 'info');
    const sites = await fetchAndProcessDeployments();
    cacheAllSiteMenus(sites);
    return 'site-list-menu';
}

export const listSites = requireAuthAndSubscription(_listSitesLogic, 'view sites'); 

export async function viewSite(params) {
    const { machineId, deploymentName } = params;
    const siteId = `${machineId}-${deploymentName}`;

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
    const { deployment, machineId, renderMenu, menuContainer, menuTitle } = params;

    if (!deployment || !machineId) {
        updateStatusDisplay('Site data is incomplete for destroy operation.', 'error');
        return;
    }

    const confirmation = await prompt({
        id: 'confirm-destroy-prompt',
        text: `Are you sure you want to destroy the deployment '${deployment}'? This cannot be undone.`,
        type: 'form',
        buttons: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }]
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
                vm_id: machineId,
                deployment: deployment
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to start destruction task.');
        }

        updateStatusDisplay(result.message, 'success');
        
        // After destruction, refresh the list of sites.
        return await _listSitesLogic(params);

    } catch (e) {
        if (e.message === 'UserCancelled') {
            throw e; // Let menu.js handle the transition back
        }
        console.error('Destroy error:', e);
        // Return to the current list as fallback
        return await _listSitesLogic(params);
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
        
        return await _listSitesLogic(params);
    } catch (e) {
        if (e.message === 'UserCancelled') {
            throw e; // Let menu.js handle the transition back
        }
        console.error('destroy error:', e);
        return await _listSitesLogic(params);
    }
}

// Register handlers with the central registry
registerHandler('listSites', listSites);
registerHandler('viewSite', viewSite);
registerHandler('destroySite', destroySite);
registerHandler('destroyDeployment', destroyDeployment);
registerHandler('openAddress', openAddress);
