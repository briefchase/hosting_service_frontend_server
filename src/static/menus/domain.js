// Import the central menu registry and API base URL
import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { registerHandler } from '../scripts/registry.js';
import { 
    API_BASE_URL, 
    fetchWithAuth, 
    updateAccountButtonVisibility,
    updateSiteTitleVisibility 
} from '/static/main.js';
import { requireAuthAndSubscription, requireAuth, getUser } from '/static/scripts/authenticate.js';
import { prompt } from '/static/pages/prompt.js';
import { fetchSites, relinkDomain as relinkDomainApi, purchaseDomain as apiPurchaseDomain, fetchDomainRecords } from '/static/scripts/api.js';

async function fetchDomains() {
    const response = await fetchWithAuth(`${API_BASE_URL}/domains`);
    if (!response.ok) {
        throw new Error(`Failed to fetch domains: ${response.statusText}`);
    }
    return response.json();
}

export const _purchaseDomainLogic = requireAuthAndSubscription(async (params) => {
    const { renderMenu, updateStatusDisplay, menuContainer, menuTitle } = params;

    try {
        const answer = await prompt({
            type: 'domain',
            text: "Enter the domain name you'd like to use (e.g., example.com):",
            id: 'domain_registration_prompt'
        });

        if (!answer || answer.status !== 'answered' || !answer.value) {
            throw new Error("Domain registration was cancelled.");
        }
        
        const newDomainDetails = answer.value;

        const { domainName, price } = newDomainDetails;

        let offSession = false;
        if (cardOnFile) {
            const cardPrompt = await prompt({
                id: 'use_card_on_file',
                text: `Would you like to use the card on file to purchase ${domainName} for $${price}?`,
                type: 'options',
                options: [
                    { label: 'yes', value: true },
                    { label: 'no', value: false }
                ]
            });

            if (cardPrompt && cardPrompt.status === 'answered' && cardPrompt.value) {
                offSession = true;
            } else if (!cardPrompt || cardPrompt.status === 'canceled') {
                throw new Error("Domain registration was cancelled.");
            }
        }

        // Enter "loading mode" manually to match standard menu transitions
        if (menuContainer) {
            const listContainer = menuContainer.querySelector('#menu-list-container');
            if (listContainer) listContainer.innerHTML = '';
            menuContainer.dataset.loading = "true";
            menuContainer.dataset.previousMenu = 'domain-menu';
        }
        if (menuTitle) menuTitle.style.display = 'none';
        updateSiteTitleVisibility(false);
        updateAccountButtonVisibility(false);
        clearBackHandlers(); // Hide back button during purchase

        // Use 'loading...' for checkout initiation, 'purchasing...' for immediate charges
        const statusMsg = offSession ? `purchasing ${domainName}...` : 'loading...';
        updateStatusDisplay(statusMsg, 'info');
        
        const user = getUser();
        if (!user || !user.token) {
             throw new Error("User not authenticated.");
        }

        const result = await apiPurchaseDomain({
            domainName,
            price,
            offSession,
            token: user.token
        });

        if (result.ok) {
            if (!offSession) {
                const details = result.result && result.result.details;
                if (details && details.client_secret) {
                    // Handle embedded checkout
                    const checkoutPrompt = await prompt({
                        id: 'domain_checkout',
                        type: 'embedded_checkout',
                        client_secret: details.client_secret
                    });
                    
                    if (checkoutPrompt.status !== 'answered' || checkoutPrompt.value !== 'completed') {
                        throw new Error("Checkout incomplete or cancelled.");
                    }
                } else {
                    // If we expected a checkout but didn't get a secret, the backend likely misconfigured the response
                    throw new Error("Unable to initiate checkout. Please try again or use the card on file.");
                }
            }
            listDomains(params); // Immediate refresh on success
        } else {
            throw new Error(result.error || 'Failed to purchase domain.');
        }

    } catch (error) {
        console.log("Domain registration cancelled or failed.", error.message);
        const isCancellation = error.message === "Domain registration was cancelled." || error.message === "Checkout incomplete or cancelled.";
        
        if (!isCancellation) {
             updateStatusDisplay(`error: ${error.message}`, 'error');
             // If it was a real error (not a cancellation), wait before refreshing
             // so the user can actually read the error message.
             if (renderMenu) {
                 setTimeout(() => listDomains(params), 3000);
             }
        } else if (renderMenu) {
            listDomains(params); // Immediate refresh on cancellation
        }
    } finally {
        // No manual clear needed, listDomains/renderMenu handles it
    }
}, 'purchase a domain');


let cardOnFile = false; // This now tracks if a card is on file

async function _listDomainsLogic(params) {
    const { renderMenu, updateStatusDisplay, initialMenuId } = params;
    try {
        updateStatusDisplay('loading...', 'info');

        // We now get card on file status directly from the domains fetch
        const domainData = await fetchDomains();
        cardOnFile = !!domainData.isCardOnFile;

        updateStatusDisplay('fetching domains...', 'info');
        
        const allDeployments = [];
        // The backend now returns linked deployment info directly in the domain objects.
        // We no longer need to fetch sites separately for cross-referencing.
        
        if (domainData.message) {
            renderMenu({
                id: 'domain-menu',
                text: 'domains:',
                items: [{ text: domainData.message, type: 'record' }],
                backTarget: 'resource-menu'
            });
            return;
        }

        const allDomainObjects = (domainData.domains || []).map(d => ({ 
            ...d, 
            isManaged: d.source === 'registrar'
        }));

        const domainItems = allDomainObjects.map((d, index) => {
            const menuId = `domain-details-${d.domainName.replace(/\./g, '-')}`;
            
            const detailItems = [];

            if (d.relinking_status) {
                const targetName = d.relinking_status.target_deployment;
                detailItems.push({
                    text: targetName ? `linking to ${targetName}...` : `unlinking...`,
                    type: 'record'
                });
            } else {
                detailItems.push({
                    text: `site: ${d.deployment_name || 'unlinked'}`,
                    type: 'record'
                });

                if (d.isManaged) {
                    if (d.expireTime) {
                        detailItems.push({
                            text: `expires: ${d.expireTime}`,
                            type: 'record'
                        });
                    }

                    detailItems.push({
                        text: `auto renew: ${d.autoRenew ? 'enabled' : 'disabled'}`,
                        type: 'record'
                    });

                    detailItems.push({
                        text: `transferrable: ${d.transferLockEnabled === false ? 'unlocked' : 'locked'}`,
                        type: 'record',
                        className: 'details-last-record'
                    });
                } else {
                    detailItems.push({
                        text: 'managed externally',
                        type: 'record',
                        className: 'details-last-record'
                    });
                }

                detailItems.push({
                    id: `relink-${d.domainName.replace(/\./g, '-')}`,
                    text: d.deployment_name ? 'relink' : 'link',
                    type: 'button',
                    action: 'relinkDomain',
                    domainName: d.domainName,
                    showLoading: true,
                    tooltip: d.deployment_name ? 'point this domain at a different site' : 'point this domain at a site',
                    isExternal: !d.isManaged
                });

                if (d.deployment_name) {
                    detailItems.push({
                        id: `unlink-${d.domainName.replace(/\./g, '-')}`,
                        text: 'unlink',
                        type: 'button',
                        action: 'relinkDomain',
                        domainName: d.domainName,
                        isUnlink: true,
                        isExternal: !d.isManaged,
                        showLoading: true,
                        tooltip: 'remove this domain from its current site'
                    });
                }

                    detailItems.push({
                        id: `records-${d.domainName.replace(/\./g, '-')}`,
                        text: 'records',
                        type: 'button',
                        action: 'viewRecords',
                        domainName: d.domainName,
                        source: d.source,
                        showLoading: true,
                        tooltip: 'view DNS records for this domain'
                    });

                if (d.isManaged) {
                    detailItems.push({
                        id: `transfer-out-${d.domainName.replace(/\./g, '-')}`,
                        text: d.transferLockEnabled === false ? 'cancel transfer' : 'transfer out',
                        type: 'button',
                        action: 'toggleTransferOut',
                        domainName: d.domainName,
                        currentAction: d.transferLockEnabled === false ? 'cancel' : 'authorize',
                        showLoading: true,
                        tooltip: d.transferLockEnabled === false ? 're-lock domain' : 'move this domain to a different registrar'
                    });

                    detailItems.push({
                        id: `cease-renewals-${d.domainName.replace(/\./g, '-')}`,
                        text: d.autoRenew ? 'cease renewals' : 'resume renewals',
                        type: 'button',
                        action: 'toggleRenewal',
                        domainName: d.domainName,
                        enable: !d.autoRenew,
                        showLoading: true,
                        tooltip: d.autoRenew ? 'do not renew this domain' : 'process renewals for this domain'
                    });
                }
            }

            menus[menuId] = {
                id: menuId,
                text: d.domainName,
                items: detailItems,
                backTarget: 'domain-menu'
            };

            return {
                id: `domain-${d.domainName.replace(/\./g, '-')}`,
                text: d.domainName,
                type: 'record',
                targetMenu: menuId,
                className: index === allDomainObjects.length - 1 ? 'details-last-record' : ''
            };
        });

        domainItems.push({
            id: 'transfer-in-domain',
            text: 'transfer in',
            type: 'button',
            action: 'transferInDomain',
            showLoading: true,
            tooltip: 'bring a domain from a different registrar'
        });

        domainItems.push({
            id: 'register-new-domain',
            text: 'register domain',
            type: 'button',
            action: 'registerDomain',
            tooltip: 'purchase a new domain'
        });

        domainItems.push({
            id: 'link-external-domain',
            text: 'link external domain',
            type: 'button',
            action: 'linkExternalDomain',
            showLoading: true,
            tooltip: 'point a domain you own elsewhere at a site'
        });

        const finalConfig = {
            id: 'domain-menu',
            text: 'domains:',
            items: domainItems.length > 0 ? domainItems : [{ text: 'no domains found', type: 'record' }],
            backTarget: 'resource-menu'
        };
        menus['domain-menu'] = finalConfig;
        renderMenu(initialMenuId || 'domain-menu');
    } catch (error) {
        if (error.message === 'ReauthInitiated') {
            // Propagate to the requireAuth guard so it can save the pending action
            throw error;
        }
        renderMenu({
            id: 'domain-menu',
            text: 'error',
            items: [{ text: `could not load domains: ${error.message}`, type: 'record' }],
            backTarget: 'resource-menu'
        });
    }
}

export const listDomains = requireAuth(_listDomainsLogic, 'view domains');
export const relinkDomain = requireAuth(async (params) => {
    const { domainName, renderMenu, updateStatusDisplay, isExternal, isUnlink } = params;

    try {
        let deployment_name = null;
        let machine_id = null;
        let old_machine_id = null;
        let old_ip = null;
        let new_ip = null;

        // 1. Fetch all deployments to present as choices or for IP lookup
        updateStatusDisplay('fetching available deployments...', 'info');
        const sitesData = await fetchSites();
        if (!sitesData || sitesData.length === 0 || (sitesData.length === 1 && sitesData[0].id === 'no-deployments')) {
            updateStatusDisplay('No deployments available.', 'error');
            return;
        }

        const allDeploymentsRaw = [];
        sitesData.forEach(vm => {
            if (vm.deployments && vm.deployments.length > 0) {
                allDeploymentsRaw.push(...vm.deployments.map(dep => ({
                    ...dep,
                    machine_name: vm.name,
                    machine_id: vm.id,
                    ip_address: vm.ip_address
                })));
            }
        });

        // Find the deployment this domain is currently linked to
        const currentDeployment = allDeploymentsRaw.find(dep => dep.domain === domainName);
        if (currentDeployment) {
            old_machine_id = currentDeployment.machine_id;
            old_ip = currentDeployment.ip_address;
        }

        if (!isUnlink) {
            // Filter out the current deployment from the list of options
            // AND filter out any deployments that already have a domain linked to them
            const availableDeployments = allDeploymentsRaw.filter(dep => {
                if (dep.domain) return false;
                if (!currentDeployment) return true;
                return dep.deployment_name !== currentDeployment.deployment_name || dep.machine_id !== currentDeployment.machine_id;
            });

            if (availableDeployments.length === 0) {
                updateStatusDisplay('No other deployments available to link to.', 'info');
                setTimeout(() => listDomains(params), 1500);
                return;
            }

            const deploymentOptions = availableDeployments.map(dep => ({
                value: {
                    deployment_name: dep.deployment_name,
                    machine_id: dep.machine_id,
                    ip_address: dep.ip_address
                },
                label: `${dep.deployment_name} on ${dep.machine_name}`
            }));

            // 2. Prompt user to select a deployment
            const answer = await prompt({
                id: 'relink-deployment-select',
                text: `Which deployment should ${domainName} point to?`,
                type: 'options',
                options: deploymentOptions
            });

            if (!answer || answer.status !== 'answered' || !answer.value) {
                updateStatusDisplay('Relink cancelled.', 'info');
                listDomains(params);
                return;
            }

            deployment_name = answer.value.deployment_name;
            machine_id = answer.value.machine_id;
            new_ip = answer.value.ip_address;
        }

        // 3. Call the API
        updateStatusDisplay(`${isUnlink ? 'Unlinking' : 'Initiating relink for'} ${domainName}...`, 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/relink`, {
            method: 'POST',
            body: {
                domainName: domainName,
                deployment_name: deployment_name,
                machine_id: machine_id,
                isExternal: !!isExternal,
                isUnlink: !!isUnlink
            }
        });

        const result = await response.json();

        if (response.ok && !result.error) {
            if (isExternal) {
                let promptText = '';
                if (isUnlink) {
                    promptText = `Remember to delete the A record associated with ${old_ip || 'the server'}`;
                } else if (old_ip && new_ip && old_ip !== new_ip) {
                    promptText = `Change the A record associated with ${old_ip} to ${new_ip}`;
                } else {
                    promptText = `Ensure there is an A record associated with ${new_ip || 'the server'}`;
                }

                await prompt({
                    id: 'external_action_success',
                    text: promptText,
                    type: 'options',
                    options: [{ label: 'ok', value: true }]
                });
            }
        } else {
            throw new Error(result.error || `Failed to ${isUnlink ? 'unlink' : 'initiate relink'}.`);
        }

    } catch (error) {
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    } finally {
        // 4. ALWAYS refresh the domain list immediately to show the new state.
        // We pass initialMenuId to stay on the specific domain's detail page.
        listDomains({ ...params, initialMenuId: `domain-details-${domainName.replace(/\./g, '-')}` });
    }
}, 'relink domain');

export const toggleTransferOut = requireAuthAndSubscription(async (params) => {
    const { domainName, currentAction, renderMenu, updateStatusDisplay } = params;
    
    updateStatusDisplay(`Initiating ${currentAction} transfer for ${domainName}...`);

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/transfer-out`, {
            method: 'POST',
            body: {
                domainName: domainName,
                action: currentAction
            }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            if (currentAction === 'authorize') {
                await prompt({
                    id: 'transfer_out_emailed',
                    text: "You have been emailed an authorization code.",
                    type: 'options',
                    options: [{ label: 'ok', value: true }]
                });
            }
            updateStatusDisplay(`Successfully ${currentAction === 'authorize' ? 'authorized' : 'cancelled'} transfer for ${domainName}!`, 'success');
            // Refresh the domain list to show updated lock status
            await listDomains({ renderMenu, updateStatusDisplay, initialMenuId: `domain-details-${domainName.replace(/\./g, '-')}` });
        } else {
            throw new Error(result.error || `Failed to ${currentAction} transfer.`);
        }
    } catch (error) {
        console.error(`Error during ${currentAction} transfer:`, error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
}, 'toggle transfer out');

export const toggleRenewal = requireAuthAndSubscription(async (params) => {
    const { domainName, enable, renderMenu, updateStatusDisplay } = params;
    
    // The 'enable' param comes from the dataset as a string 'true' or 'false'
    const isEnable = String(enable) === 'true';
    const actionText = isEnable ? 'resume renewals' : 'cease renewals';
    updateStatusDisplay(`${isEnable ? 'Resuming' : 'Ceasing'} renewals for ${domainName}...`);

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/toggle-renewal`, {
            method: 'POST',
            body: {
                domainName: domainName,
                enable: isEnable
            }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            updateStatusDisplay(`Successfully ${isEnable ? 'resumed' : 'ceased'} renewals for ${domainName}!`, 'success');
            await listDomains({ renderMenu, updateStatusDisplay, initialMenuId: `domain-details-${domainName.replace(/\./g, '-')}` });
        } else {
            throw new Error(result.error || `Failed to ${actionText}.`);
        }
    } catch (error) {
        console.error(`Error during ${actionText}:`, error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
}, 'toggle renewal');

export const transferInDomain = requireAuth(async (params) => {
    const { renderMenu, updateStatusDisplay } = params;

    try {
        const domainAnswer = await prompt({
            type: 'text',
            text: "Enter the domain name you'd like to transfer in:",
            id: 'transfer_in_domain_name',
            options: [{ label: 'proceed', value: true }]
        });

        if (!domainAnswer || domainAnswer.status !== 'answered' || !domainAnswer.value) {
            throw new Error("Transfer-in was cancelled.");
        }
        const domainName = domainAnswer.value;

        const authCodeAnswer = await prompt({
            type: 'text',
            text: `Enter the authorization code for ${domainName}:`,
            id: 'transfer_in_auth_code',
            options: [{ label: 'proceed', value: true }]
        });

        if (!authCodeAnswer || authCodeAnswer.status !== 'answered' || !authCodeAnswer.value) {
            throw new Error("Transfer-in was cancelled.");
        }
        const authCode = authCodeAnswer.value;

        updateStatusDisplay(`Initiating transfer for ${domainName}...`, 'info');

        const response = await fetchWithAuth(`${API_BASE_URL}/transfer-in`, {
            method: 'POST',
            body: {
                domainName: domainName,
                authCode: authCode
            }
        });

        const result = await response.json();

        if (response.ok && !result.error) {
            updateStatusDisplay(`Successfully initiated transfer for ${domainName}!`, 'success');
            await listDomains({ renderMenu, updateStatusDisplay });
        } else {
            throw new Error(result.error || 'Failed to initiate transfer.');
        }
    } catch (error) {
        console.error("Transfer-in failed:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
        if (renderMenu) {
            setTimeout(() => listDomains(params), 3000);
        }
    }
}, 'transfer in domain');

export const linkExternalDomain = requireAuth(async (params) => {
    const { renderMenu, updateStatusDisplay } = params;

    try {
        // 1. Fetch all deployments to present as choices
        updateStatusDisplay('fetching available deployments...', 'info');
        const sitesData = await fetchSites();
        if (!sitesData || sitesData.length === 0 || (sitesData.length === 1 && sitesData[0].id === 'no-deployments')) {
            updateStatusDisplay('No deployments available to link to.', 'error');
            return;
        }

        const allDeploymentsRaw = [];
        sitesData.forEach(vm => {
            if (vm.deployments && vm.deployments.length > 0) {
                allDeploymentsRaw.push(...vm.deployments.map(dep => ({
                    ...dep,
                    machine_name: vm.name,
                    machine_id: vm.id
                })));
            }
        });

        // Filter out any deployments that already have a domain linked to them
        const availableDeployments = allDeploymentsRaw.filter(dep => !dep.domain);

        const deploymentOptions = availableDeployments.map(dep => ({
            value: {
                deployment_name: dep.deployment_name,
                machine_id: dep.machine_id
            },
            label: `${dep.deployment_name} on ${dep.machine_name}`
        }));

        // 2. Prompt user to select a deployment
        const deploymentAnswer = await prompt({
            id: 'external-link-deployment-select',
            text: `Which deployment should the external domain point to?`,
            type: 'options',
            options: deploymentOptions
        });

        if (!deploymentAnswer || deploymentAnswer.status !== 'answered' || !deploymentAnswer.value) {
            updateStatusDisplay('Link cancelled.', 'info');
            listDomains(params);
            return;
        }

        const { deployment_name, machine_id } = deploymentAnswer.value;
        const targetMachine = allDeploymentsRaw.find(dep => dep.machine_id === machine_id);
        const targetIp = targetMachine ? targetMachine.ip_address : 'the server\'s IP';

        // 3. Prompt for the domain name
        const domainAnswer = await prompt({
            type: 'text',
            text: "Enter the external domain name you'd like to link:",
            id: 'link_external_domain_name',
            options: [{ label: 'proceed', value: true }]
        });

        if (!domainAnswer || domainAnswer.status !== 'answered' || !domainAnswer.value) {
            updateStatusDisplay('Link cancelled.', 'info');
            listDomains(params);
            return;
        }
        const domainName = domainAnswer.value;

        // 4. Call the API
        updateStatusDisplay(`Initiating link for ${domainName}...`, 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/relink`, {
            method: 'POST',
            body: {
                domainName: domainName,
                deployment_name: deployment_name,
                machine_id: machine_id,
                isExternal: true
            }
        });

        const result = await response.json();

        if (response.ok && !result.error) {
            await prompt({
                id: 'external_link_success',
                text: `Ensure there is an A record associated with ${targetIp}`,
                type: 'options',
                options: [{ label: 'ok', value: true }]
            });
            await listDomains({ ...params, initialMenuId: `domain-details-${domainName.replace(/\./g, '-')}` });
        } else {
            throw new Error(result.error || 'Failed to initiate link.');
        }

    } catch (error) {
        console.error("External link failed:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
        if (renderMenu) {
            setTimeout(() => listDomains(params), 3000);
        }
    }
}, 'link external domain');

export const viewRecords = requireAuth(async (params) => {
    const { domainName, source, renderMenu, updateStatusDisplay } = params;
    const menuId = `domain-records-${domainName.replace(/\./g, '-')}`;

    try {
        updateStatusDisplay(`fetching records for ${domainName}...`, 'info');
        
        // Resolve isManaged right before the request based on the source
        const isManaged = source === 'registrar';
        const data = await fetchDomainRecords(domainName, isManaged);
        const records = data.records || [];

        const recordItems = records.map((r, index) => ({
            id: `record-${domainName.replace(/\./g, '-')}-${index}`,
            text: `${r.type} ${r.name || '@'} -> ${r.content}`,
            type: 'record'
        }));

        if (recordItems.length === 0) {
            recordItems.push({ text: 'no records found', type: 'record' });
        }

        menus[menuId] = {
            id: menuId,
            text: `records for ${domainName}:`,
            items: recordItems,
            backTarget: `domain-details-${domainName.replace(/\./g, '-')}`
        };

        renderMenu(menuId);
    } catch (error) {
        console.error("Failed to fetch records:", error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
}, 'view records');

// Register handlers with the central registry
registerHandler('listDomains', listDomains);
registerHandler('registerDomain', _purchaseDomainLogic);
registerHandler('relinkDomain', relinkDomain);
registerHandler('toggleTransferOut', toggleTransferOut);
registerHandler('toggleRenewal', toggleRenewal);
registerHandler('transferInDomain', transferInDomain);
registerHandler('linkExternalDomain', linkExternalDomain);
registerHandler('viewRecords', viewRecords);
