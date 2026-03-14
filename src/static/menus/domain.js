// Import the central menu registry and API base URL
import { menus, renderMenu, updateStatusDisplay, startLoading } from '/static/pages/menu.js';
import { registerHandler } from '../scripts/registry.js';
import { 
    API_BASE_URL, 
    fetchWithAuth, 
    updateAccountButtonVisibility,
    updateSiteTitleVisibility 
} from '/static/main.js';
import { requireAuthAndSubscription, requireAuth, getUser } from '/static/scripts/authenticate.js';
import { prompt } from '/static/pages/prompt.js';
import { 
    fetchSites, 
    relinkDomain as relinkDomainApi, 
    purchaseDomain as apiPurchaseDomain, 
    fetchDomainRecords,
    fetchDomainDetails,
    transferOutDomain as apiTransferOutDomain,
    toggleDomainRenewal as apiToggleDomainRenewal,
    transferInDomain as apiTransferInDomain,
    addDomainRecord as apiAddDomainRecord,
    updateDomainRecord as apiUpdateDomainRecord,
    deleteDomainRecord as apiDeleteDomainRecord
} from '/static/scripts/api.js';

let cachedDomains = []; // Store domain data for lookups

async function fetchDomains() {
    const response = await fetchWithAuth(`${API_BASE_URL}/domains`);
    if (!response.ok) {
        throw new Error(`Failed to fetch domains: ${response.statusText}`);
    }
    return response.json();
}

export const _purchaseDomainLogic = requireAuth(async (params) => {
    const { updateStatusDisplay } = params;

    const answer = await prompt({
        type: 'domain',
        text: "Enter the domain name you'd like to use (e.g., example.com):",
        id: 'domain_registration_prompt'
    });

    if (!answer || answer.status !== 'answered' || !answer.value) {
        return; // Stay on the current menu
    }
    
    const newDomainDetails = answer.value;
    const { domainName, price } = newDomainDetails;

    let offSession = false;
    if (cardOnFile) {
        const cardPrompt = await prompt({
            id: 'use_card_on_file',
            text: `Would you like to use the card on file to purchase ${domainName} for $${price}?`,
            type: 'form',
            buttons: [
                { label: 'yes', value: true },
                { label: 'no', value: false }
            ]
        });

        if (cardPrompt && cardPrompt.status === 'answered' && cardPrompt.value) {
            offSession = true;
        } else if (!cardPrompt || cardPrompt.status === 'canceled') {
            return; // Stay on the current menu
        }
    }

    const workFn = async () => {
        // Use 'loading...' for checkout initiation, 'purchasing...' for immediate charges
        const statusMsg = offSession ? 'purchasing ' + domainName + '...' : 'loading...';
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
                        text: 'complete checkout for ' + domainName,
                        client_secret: details.client_secret
                    });
                    
                    if (checkoutPrompt.status !== 'answered' || checkoutPrompt.value !== 'completed') {
                        throw new Error("UserCancelled");
                    }

                    // 3. Synchronously wait for the registration to complete
                    updateStatusDisplay('purchasing ' + domainName + '...', 'info');
                    const waitResponse = await fetchWithAuth(`${API_BASE_URL}/domains/${domainName}/wait-registration`, {
                        method: 'POST'
                    });

                    const waitResult = await waitResponse.json();
                    if (!waitResponse.ok || !waitResult.success) {
                        throw new Error(waitResult.error || 'registration timed out');
                    }
                } else {
                    throw new Error("Unable to initiate checkout.");
                }
            }

            // Fire a non-blocking success prompt so the user sees it 
            // while the background refreshes to the domain list.
            prompt({
                id: 'registration_success',
                text: `If this is your first time purchasing a domain from us, you should receive an email from our partners at DNSimple asking you to verify your email for WHOIS. Failure to do this could result in issues with your standing with our registrar, and your domain may stop resolving.`,
                type: 'form',
                buttons: [{ label: 'ok', value: true }]
            });

            return await listDomains(params);
        } else {
            throw new Error(result.error || 'Failed to purchase domain.');
        }
    };

    try {
        return await startLoading(workFn);
    } catch (error) {
        if (error.message === 'UserCancelled') throw error;
        console.error("Domain registration failed:", error);
        return 'domain-menu';
    }
}, 'purchase a domain');


let cardOnFile = false; // This now tracks if a card is on file

async function _listDomainsLogic(params) {
    const { renderMenu, updateStatusDisplay, initialMenuId } = params;
    try {
        updateStatusDisplay('fetching domains...', 'info');

        // We now get card on file status directly from the domains fetch
        const domainData = await fetchDomains();
        cardOnFile = !!domainData.isCardOnFile;

        const allDeployments = [];
        // The backend now returns linked deployment info directly in the domain objects.
        // We no longer need to fetch sites separately for cross-referencing.
        
        if (domainData.message) {
            return {
                id: 'domain-menu',
                text: 'domains:',
                items: [{ text: domainData.message, type: 'record' }],
                backTarget: 'resource-menu'
            };
        }

        const allDomainObjects = (domainData.domains || []).map(d => ({ 
            ...d, 
            isManaged: d.source === 'registrar'
        }));
        cachedDomains = allDomainObjects; // Update the cache

        const domainItems = allDomainObjects.map((d, index) => {
            const menuId = `domain-details-${d.domainName.replace(/\./g, '-')}`;
            
            // We no longer pre-generate the detail menus here.
            // They will be generated on-demand in viewDomainDetails.

            return {
                id: `domain-${d.domainName.replace(/\./g, '-')}`,
                text: d.domainName,
                type: 'record',
                action: 'viewDomainDetails',
                domainName: d.domainName,
                showLoading: true,
                className: index === allDomainObjects.length - 1 ? 'details-last-record' : ''
            };
        });

        domainItems.push({
            id: 'transfer-in-domain',
            text: 'transfer in',
            type: 'button',
            action: 'transferInDomain',
            showLoading: false,
            tooltip: 'bring a domain from a different registrar'
        });

        domainItems.push({
            id: 'register-new-domain',
            text: 'register domain',
            type: 'button',
            action: 'registerDomain',
            showLoading: false,
            tooltip: 'purchase a new domain'
        });

        domainItems.push({
            id: 'link-external-domain',
            text: 'link external domain',
            type: 'button',
            action: 'linkExternalDomain',
            showLoading: false,
            tooltip: 'point a domain you own elsewhere at a site'
        });

        const finalConfig = {
            id: 'domain-menu',
            text: 'domains:',
            items: domainItems.length > 0 ? domainItems : [{ text: 'no domains found', type: 'record' }],
            backTarget: 'resource-menu'
        };
        menus['domain-menu'] = finalConfig;
        return initialMenuId || 'domain-menu';
    } catch (error) {
        if (error.message === 'ReauthInitiated') {
            // Propagate to the requireAuth guard so it can save the pending action
            throw error;
        }
        return {
            id: 'domain-menu',
            text: 'error',
            items: [{ text: `could not load domains: ${error.message}`, type: 'record' }],
            backTarget: 'resource-menu'
        };
    }
}

export const listDomains = requireAuth(_listDomainsLogic, 'view domains');
export const relinkDomain = requireAuth(async (params) => {
    const { domainName, renderMenu, updateStatusDisplay, isExternal, isUnlink } = params;

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
            type: 'form',
            buttons: deploymentOptions.map(opt => ({ label: opt.label, value: opt.value }))
        });

        if (!answer || answer.status !== 'answered' || !answer.value) {
            updateStatusDisplay('Relink cancelled.', 'info');
            return; // Stay on the current menu
        }

        deployment_name = answer.value.deployment_name;
        machine_id = answer.value.machine_id;
        new_ip = answer.value.ip_address;
    }

    // 3. Call the API
    const workFn = async () => {
        updateStatusDisplay(`${isUnlink ? 'Unlinking' : 'Initiating relink for'} ${domainName}...`, 'info');
        const result = await relinkDomainApi({
            domainName: domainName,
            deployment_name: deployment_name,
            machine_id: machine_id,
            isExternal: !!isExternal,
            isUnlink: !!isUnlink
        });

        if (result.ok) {
            const domainInfo = cachedDomains.find(d => d.domainName === domainName);
            if (domainInfo && domainInfo.source !== 'registrar') {
                let promptText = '';
                if (isUnlink) {
                    promptText = `Remember to delete the A record for ${domainName} associated with ${old_ip || 'the server'}`;
                } else if (old_ip && new_ip && old_ip !== new_ip) {
                    promptText = `Change the A record for ${domainName} associated with ${old_ip} to ${new_ip}`;
                } else {
                    promptText = `Ensure there is an A record for ${domainName} associated with ${new_ip || 'the server'}`;
                }

                await prompt({
                    id: 'external_action_success',
                    text: promptText,
                    type: 'form',
                    buttons: [{ label: 'ok', value: true }]
                });
            }
            // Return the menu target for organic transition
            return await viewDomainDetails({ domainName, updateStatusDisplay });
        } else {
            throw new Error(result.error || `Failed to ${isUnlink ? 'unlink' : 'initiate relink'}.`);
        }
    };

    try {
        return await startLoading(workFn);
    } catch (error) {
        if (error.message === 'UserCancelled') throw error;
        console.error(`Error during relink for ${domainName}:`, error);
        return 'domain-menu';
    }
}, 'relink domain');

export const toggleTransferOut = requireAuthAndSubscription(async (params) => {
    const { domainName, currentAction, renderMenu, updateStatusDisplay } = params;
    
    const workFn = async () => {
        updateStatusDisplay(`Initiating ${currentAction} transfer for ${domainName}...`);

        const result = await apiTransferOutDomain({
            domainName: domainName,
            action: currentAction
        });

        if (result.ok) {
            if (currentAction === 'authorize') {
                await prompt({
                    id: 'transfer_out_emailed',
                    text: "You have been emailed an authorization code.",
                    type: 'form',
                    buttons: [{ label: 'ok', value: true }]
                });
            }
            updateStatusDisplay(`Successfully ${currentAction === 'authorize' ? 'authorized' : 'cancelled'} transfer for ${domainName}!`, 'success');
            // Return the menu target for organic transition
            return await viewDomainDetails({ domainName, updateStatusDisplay });
        } else {
            throw new Error(result.error || `Failed to ${currentAction} transfer.`);
        }
    };

    try {
        return await startLoading(workFn);
    } catch (error) {
        if (error.message === 'UserCancelled') throw error;
        console.error(`Error during ${currentAction} transfer:`, error);
        return `domain-details-${domainName.replace(/\./g, '-')}`;
    }
}, 'toggle transfer out');

export const toggleRenewal = requireAuth(async (params) => {
    const { domainName, enable, renderMenu, updateStatusDisplay } = params;
    
    // The 'enable' param comes from the dataset as a string 'true' or 'false'
    const isEnable = String(enable) === 'true';
    const actionText = isEnable ? 'resume renewals' : 'cease renewals';

    const workFn = async () => {
        updateStatusDisplay(`${isEnable ? 'Resuming' : 'Ceasing'} renewals for ${domainName}...`);

        const result = await apiToggleDomainRenewal({
            domainName: domainName,
            enable: isEnable
        });

        if (result.ok) {
            updateStatusDisplay(`Successfully ${isEnable ? 'resumed' : 'ceased'} renewals for ${domainName}!`, 'success');
            return await viewDomainDetails({ domainName, updateStatusDisplay });
        } else {
            throw new Error(result.error || `Failed to ${actionText}.`);
        }
    };

    try {
        return await startLoading(workFn);
    } catch (error) {
        if (error.message === 'UserCancelled') throw error;
        console.error(`Error during ${actionText}:`, error);
        return `domain-details-${domainName.replace(/\./g, '-')}`;
    }
}, 'toggle renewal');

export const transferInDomain = requireAuth(async (params) => {
    const { renderMenu, updateStatusDisplay } = params;

    const domainAnswer = await prompt({
        type: 'form',
        text: "Enter the domain name you'd like to transfer in:",
        id: 'transfer_in_domain_name',
        items: [
            { id: 'domainName', type: 'text', placeholder: 'example.com' }
        ],
        buttons: [{ label: 'proceed', isSubmit: true }]
    });

    if (!domainAnswer || domainAnswer.status !== 'answered' || !domainAnswer.value) {
        return; // Stay on the current menu
    }
    const domainName = domainAnswer.value.domainName;

    const authCodeAnswer = await prompt({
        type: 'form',
        text: `Enter the authorization code for ${domainName}:`,
        id: 'transfer_in_auth_code',
        items: [
            { id: 'authCode', type: 'text', placeholder: 'code' }
        ],
        buttons: [{ label: 'proceed', isSubmit: true }]
    });

    if (!authCodeAnswer || authCodeAnswer.status !== 'answered' || !authCodeAnswer.value) {
        return; // Stay on the current menu
    }
    const authCode = authCodeAnswer.value.authCode;

    const workFn = async () => {
        updateStatusDisplay(`Initiating transfer for ${domainName}...`, 'info');

        const result = await apiTransferInDomain({
            domainName: domainName,
            authCode: authCode
        });

        if (result.ok) {
            updateStatusDisplay(`Successfully initiated transfer for ${domainName}!`, 'success');
            return await listDomains(params);
        } else {
            throw new Error(result.error || 'Failed to initiate transfer.');
        }
    };

    try {
        return await startLoading(workFn);
    } catch (error) {
        if (error.message === 'UserCancelled') throw error;
        console.error("Transfer-in failed:", error);
        return 'domain-menu';
    }
}, 'transfer in domain');

export const linkExternalDomain = requireAuth(async (params) => {
    const { renderMenu, updateStatusDisplay } = params;

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
                machine_id: vm.id,
                ip_address: vm.ip_address
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
        type: 'form',
        buttons: deploymentOptions.map(opt => ({ label: opt.label, value: opt.value }))
    });

    if (!deploymentAnswer || deploymentAnswer.status !== 'answered' || !deploymentAnswer.value) {
        return; // Stay on the current menu
    }

    const { deployment_name, machine_id } = deploymentAnswer.value;
    const targetMachine = allDeploymentsRaw.find(dep => dep.machine_id === machine_id);
    const targetIp = targetMachine ? targetMachine.ip_address : 'the server\'s IP';

    // 3. Prompt for the domain name
    const domainAnswer = await prompt({
        type: 'form',
        text: "Enter the external domain name you'd like to link:",
        id: 'link_external_domain_name',
        items: [
            { id: 'domainName', type: 'text', placeholder: 'example.com' }
        ],
        buttons: [{ label: 'proceed', isSubmit: true }]
    });

    if (!domainAnswer || domainAnswer.status !== 'answered' || !domainAnswer.value) {
        return; // Stay on the current menu
    }
    const domainName = domainAnswer.value.domainName;

    // 4. Call the API
    const workFn = async () => {
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
                text: `Ensure there is an A record for ${domainName} associated with ${targetIp}`,
                type: 'form',
                buttons: [{ label: 'ok', value: true }]
            });
            return await listDomains({ ...params, initialMenuId: `domain-details-${domainName.replace(/\./g, '-')}` });
        } else {
            throw new Error(result.error || 'Failed to initiate link.');
        }
    };

    try {
        return await startLoading(workFn);
    } catch (error) {
        if (error.message === 'UserCancelled') throw error;
        console.error("External link failed:", error);
        return 'domain-menu';
    }
}, 'link external domain');

export const viewRecords = requireAuth(async (params) => {
    const { domainName, renderMenu, updateStatusDisplay } = params;
    const menuId = `domain-records-${domainName.replace(/\./g, '-')}`;

    try {
        updateStatusDisplay(`fetching records for ${domainName}...`, 'info');
        
        const domain = cachedDomains.find(d => d.domainName === domainName);
        const isManaged = domain ? domain.isManaged : false;
        
        const data = await fetchDomainRecords(domainName);
        const records = (data.records || []).filter(r => r.type !== 'NS' && r.type !== 'SOA');

            const recordItems = records.map((r, index) => {
                const menuId = `record-details-${domainName.replace(/\./g, '-')}-${r.id}`;
                const name = r.name || '@';
                const ttlSeconds = (r.ttl !== undefined && r.ttl !== null) ? r.ttl : null;
                const ttlDisplay = ttlSeconds === null ? 'n/a' : `${Math.round(ttlSeconds / 60)} mins`;
                
                const detailItems = [
                    { text: `type: ${r.type}`, type: 'record' },
                    { text: `host: ${name}`, type: 'record' },
                    { text: `value: ${r.content}`, type: 'record' },
                    { text: `ttl: ${ttlDisplay}`, type: 'record', className: 'details-last-record' }
                ];

                if (isManaged) {
                    detailItems.push(
                        { 
                            text: 'edit', 
                            type: 'button', 
                            action: 'editDomainRecord', 
                            domainName, 
                            recordId: r.id, 
                            host: r.name, 
                            recordType: r.type, 
                            value: r.content, 
                            ttl: ttlSeconds
                        },
                        { 
                            text: 'delete', 
                            type: 'button', 
                            action: 'deleteDomainRecord', 
                            domainName, 
                            recordId: r.id
                        }
                    );
                }

                const recordTitle = `${r.type} ${name} -> ${r.content}`;

                menus[menuId] = {
                id: menuId,
                text: recordTitle,
                items: detailItems,
                backTarget: `domain-records-${domainName.replace(/\./g, '-')}`
            };

            const isLast = index === records.length - 1;
            return {
                id: `record-${domainName.replace(/\./g, '-')}-${r.id || index}`,
                text: recordTitle,
                type: 'record',
                className: isLast ? 'details-last-record' : '',
                targetMenu: menuId
            };
        });

        if (records.length === 0) {
            recordItems.push({ text: 'no records found', type: 'record', className: 'details-last-record' });
        }

        if (isManaged) {
            recordItems.push({
                id: 'add-record-button',
                text: 'add record',
                type: 'button',
                action: 'addDomainRecord',
                domainName: domainName,
                showLoading: false
            });
        }

        menus[menuId] = {
            id: menuId,
            text: `records for ${domainName}:`,
            items: recordItems,
            backTarget: `domain-details-${domainName.replace(/\./g, '-')}`
        };

        return menuId;
    } catch (error) {
        if (error.message === 'UserCancelled') {
            console.log("[ViewRecords] UserCancelled caught, propagating.");
            throw error; // Let menu.js handle the transition back
        }
        console.error("Failed to fetch records:", error);
        return `domain-details-${domainName.replace(/\./g, '-')}`;
    }
}, 'view records');

const _getRecordFormItems = (initialValues = {}) => [
    {
        type: 'row',
        items: [
            { 
                id: 'type', 
                type: 'select', 
                label: 'type', 
                value: initialValues.recordType,
                options: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'],
                width: '18%'
            },
            { id: 'host', type: 'text', label: 'host', value: initialValues.host || '@', placeholder: '@ or sub', width: '25%' },
            { id: 'value', type: 'text', label: 'value', value: initialValues.value, placeholder: 'IP or domain' },
            { id: 'ttl', type: 'text', label: 'ttl', value: (initialValues.ttl !== undefined && initialValues.ttl !== null) ? String(Math.round(initialValues.ttl / 60)) : '', placeholder: 'mins', width: '15%' }
        ]
    }
];

export const addDomainRecord = async (params) => {
    const { domainName } = params;
    
    const result = await prompt({
        id: 'add-domain-record-prompt',
        text: `Add a new record to ${domainName}:`,
        type: 'form',
        items: _getRecordFormItems(),
        buttons: [
            {
                type: 'row',
                items: [
                    { label: 'cancel', value: 'cancel' },
                    { label: 'add', isSubmit: true }
                ]
            }
        ]
    });

    if (result.status === 'answered' && result.value && result.value !== 'cancel') {
        const { host, type, value, ttl } = result.value;
        
        const workFn = async () => {
            updateStatusDisplay(`adding ${type} record...`, 'info');
            const result = await apiAddDomainRecord({
                domainName,
                type,
                name: host === '@' ? '' : host,
                content: value,
                ttl: (parseInt(ttl, 10) || 10) * 60
            });

            if (result.ok) {
                updateStatusDisplay('record added successfully', 'success');
                // Refresh the records view
                return await viewRecords(params);
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'failed to add record');
            }
        };

        try {
            return await startLoading(workFn);
        } catch (error) {
            if (error.message === 'UserCancelled') throw error;
            console.error('Error adding record:', error);
            return `domain-records-${domainName.replace(/\./g, '-')}`;
        }
    }
};

export const editDomainRecord = async (params) => {
    const { domainName, recordId, host, recordType, value, ttl } = params;
    
    const result = await prompt({
        id: 'edit-domain-record-prompt',
        text: `Edit record for ${domainName}:`,
        type: 'form',
        items: _getRecordFormItems({ host, recordType, value, ttl }),
        buttons: [
            {
                type: 'row',
                items: [
                    { label: 'cancel', value: 'cancel' },
                    { label: 'save', isSubmit: true }
                ]
            }
        ]
    });

    if (result.status === 'answered' && result.value && result.value !== 'cancel') {
        const { host: newHost, type: newType, value: newValue, ttl: newTtl } = result.value;
        
        const workFn = async () => {
            updateStatusDisplay(`updating record...`, 'info');
            const result = await apiUpdateDomainRecord({
                domainName,
                recordId,
                type: newType,
                name: newHost === '@' ? '' : newHost,
                content: newValue,
                ttl: (parseInt(newTtl, 10) || 10) * 60
            });

            if (result.ok) {
                updateStatusDisplay('record updated successfully', 'success');
                return await viewRecords(params);
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'failed to update record');
            }
        };

        try {
            return await startLoading(workFn);
        } catch (error) {
            if (error.message === 'UserCancelled') throw error;
            console.error('Error updating record:', error);
            return `domain-records-${domainName.replace(/\./g, '-')}`;
        }
    }
};

export const deleteDomainRecord = async (params) => {
    const { domainName, recordId } = params;
    
    const confirmation = await prompt({
        id: 'confirm-delete-record-prompt',
        text: "Are you sure you want to delete this record? This cannot be undone.",
        type: 'form',
        buttons: [
            { label: 'yes', value: 'yes' },
            { label: 'no', value: 'no' }
        ]
    });

    if (confirmation.status === 'answered' && confirmation.value === 'yes') {
        const workFn = async () => {
            updateStatusDisplay('deleting record...', 'info');
            const result = await apiDeleteDomainRecord({ domainName, recordId });

            if (result.ok) {
                updateStatusDisplay('record deleted successfully', 'success');
                // Refresh the records cache
                await viewRecords(params);
                // Explicitly return to the records list menu
                return `domain-records-${domainName.replace(/\./g, '-')}`;
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'failed to delete record');
            }
        };

        try {
            return await startLoading(workFn);
        } catch (error) {
            if (error.message === 'UserCancelled') throw error;
            console.error('Error deleting record:', error);
            return `domain-records-${domainName.replace(/\./g, '-')}`;
        }
    }
};

export const viewDomainDetails = requireAuth(async (params) => {
    const { domainName, updateStatusDisplay } = params;
    const menuId = `domain-details-${domainName.replace(/\./g, '-')}`;

    try {
        // 1. Update status (will show in standard loading overlay)
        updateStatusDisplay(`fetching details for ${domainName}...`, 'info');

        // 2. Fetch the deep details from the new endpoint
        const details = await fetchDomainDetails(domainName);
        
        // 3. Find the existing cached object to preserve its data (like deployment_name, source, etc.)
        const cached = cachedDomains.find(d => d.domainName === domainName) || { domainName };
        
        // 4. Merge the fresh deep details into the cached object
        const d = { ...cached, ...details };

        // 5. Generate the real detail items
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

            if (d.source === 'registrar') {
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
                showLoading: false,
                tooltip: d.deployment_name ? 'point this domain at a different site' : 'point this domain at a site',
                isExternal: d.source !== 'registrar'
            });

            if (d.deployment_name) {
                detailItems.push({
                    id: `unlink-${d.domainName.replace(/\./g, '-')}`,
                    text: 'unlink',
                    type: 'button',
                    action: 'relinkDomain',
                    domainName: d.domainName,
                    isUnlink: true,
                    isExternal: d.source !== 'registrar',
                    showLoading: false,
                    tooltip: 'remove this domain from its current site'
                });
            }

            detailItems.push({
                id: `records-${d.domainName.replace(/\./g, '-')}`,
                text: 'records',
                type: 'button',
                action: 'viewRecords',
                domainName: d.domainName,
                showLoading: true,
                tooltip: 'view DNS records for this domain'
            });

            if (d.source === 'registrar') {
                detailItems.push({
                    id: `transfer-out-${d.domainName.replace(/\./g, '-')}`,
                    text: d.transferLockEnabled === false ? 'cancel transfer' : 'transfer out',
                    type: 'button',
                    action: 'toggleTransferOut',
                    domainName: d.domainName,
                    currentAction: d.transferLockEnabled === false ? 'cancel' : 'authorize',
                    showLoading: false,
                    tooltip: d.transferLockEnabled === false ? 're-lock domain' : 'move this domain to a different registrar'
                });

                detailItems.push({
                    id: `cease-renewals-${d.domainName.replace(/\./g, '-')}`,
                    text: d.autoRenew ? 'cease renewals' : 'resume renewals',
                    type: 'button',
                    action: 'toggleRenewal',
                    domainName: d.domainName,
                    enable: !d.autoRenew,
                    showLoading: false,
                    tooltip: d.autoRenew ? 'do not renew this domain' : 'process renewals for this domain'
                });
            }
        }

        // 5. Return the menu configuration object. 
        // menu.js will handle the rendering and stack management.
        const finalMenu = {
            id: menuId,
            text: d.domainName,
            items: detailItems,
            backTarget: 'domain-menu'
        };

        // Save to the global menus registry so back-navigation works.
        // Subsequent clicks on the domain record will still trigger this action
        // and force a fresh fetch, but the back button will use this cached version.
        menus[menuId] = finalMenu;

        return finalMenu;

    } catch (error) {
        console.error("Failed to fetch domain details:", error);
        return {
            id: menuId,
            text: 'error',
            items: [{ text: `could not load details: ${error.message}`, type: 'record' }],
            backTarget: 'domain-menu'
        };
    }
}, 'view domain details');

// Register handlers with the central registry
registerHandler('listDomains', listDomains);
registerHandler('viewDomainDetails', viewDomainDetails);
registerHandler('registerDomain', _purchaseDomainLogic);
registerHandler('relinkDomain', relinkDomain);
registerHandler('toggleTransferOut', toggleTransferOut);
registerHandler('toggleRenewal', toggleRenewal);
registerHandler('transferInDomain', transferInDomain);
registerHandler('linkExternalDomain', linkExternalDomain);
registerHandler('viewRecords', viewRecords);
registerHandler('addDomainRecord', addDomainRecord);
registerHandler('editDomainRecord', editDomainRecord);
registerHandler('deleteDomainRecord', deleteDomainRecord);
