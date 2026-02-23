// Import the central menu registry and API base URL
import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { 
    API_BASE_URL, 
    fetchWithAuth, 
    updateBackButtonHandler, 
    unregisterBackButtonHandler,
    updateAccountButtonVisibility,
    updateSiteTitleVisibility 
} from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { prompt, cancelCurrentPrompt } from '/static/pages/prompt.js';
import { fetchSites } from '/static/scripts/utilities.js';
import { relinkDomain as relinkDomainApi } from '/static/scripts/utilities.js';

async function fetchDomains() {
    const response = await fetchWithAuth(`${API_BASE_URL}/domains`);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const customError = new Error(errorData.message || `Failed to fetch domains: ${response.statusText}`);
        customError.id = errorData.error;
        customError.status = response.status;
        throw customError;
    }
    return response.json();
}

async function handleRegisterNewDomain(params) {
    const { resourceId: projectId, renderMenu } = params;

    const backHandler = () => {
        cancelCurrentPrompt();
    };
    updateBackButtonHandler(backHandler);

    try {
        if (!projectId) throw new Error("No project ID for domain registration.");
        
        const newDomain = await promptForNewDomain({ project_id: projectId });
        
        updateStatusDisplay(`successfully registered ${newDomain}!`, 'success');
        listDomains(params); // Re-render the menu on success
    } catch (error) {
        console.log("Domain registration cancelled or failed.", error.message);
        // Don't show a status message on cancellation, just go back.
        if (renderMenu) {
            renderMenu('resource-menu');
        }
    } finally {
        unregisterBackButtonHandler();
    }
}

async function promptForNewDomain(context) {
    const answer = await prompt({
        type: 'domain',
        context: context,
        text: "Enter the domain name you'd like to use (e.g., example.com):",
        id: 'domain_registration_prompt' // Add an ID for consistency
    });

    if (answer && answer.status === 'answered' && answer.value) {
        return answer.value;
    }
        throw new Error("Domain registration was cancelled.");
    }

async function _listDomainsLogic(params) {
    const { renderMenu, updateStatusDisplay } = params;
        updateStatusDisplay('fetching domains...', 'info');
        const [domainData] = await Promise.all([
            fetchDomains()
        ]);
        if (domainData.message) {
            renderMenu({
                id: 'domain-menu',
                text: 'domains:',
                items: [{ text: domainData.message, type: 'record' }],
                backTarget: 'resource-menu'
            });
            return;
        }

        const allDomainObjects = (domainData.domains || []).map(d => ({ ...d, isManaged: d.source === 'registrar' }));

        const domainItems = allDomainObjects.map(d => {
            const menuId = `domain-details-${d.domainName.replace(/\./g, '-')}`;
            
            const detailItems = [];

            // NEW: Check for relinking status directly on the domain object.
            if (d.relinking_status) {
                const targetName = d.relinking_status.target_deployment;
                detailItems.push({
                    text: `linking to ${targetName}...`,
                    type: 'record'
                });
            } else {
                // Original logic when not relinking.
                const linkedDeployment = d.deployment_name;
                detailItems.push({
                    text: `site: ${linkedDeployment ? linkedDeployment : 'unlinked'}`,
                    type: 'record',
                    className: 'details-last-record'
                });

                if (d.isManaged) {
                    detailItems.push({
                        id: `relink-${d.domainName.replace(/\./g, '-')}`,
                        text: linkedDeployment ? 'relink' : 'link',
                        type: 'button',
                        action: 'relinkDomain',
                        domainName: d.domainName,
                        showLoading: true
                    });
                } else {
                    detailItems.push({
                        text: 'managed externally',
                        type: 'record',
                        className: 'details-last-record'
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
                type: 'button',
                targetMenu: menuId
            };
        });

        if (domainData.projectId) {
            domainItems.push({
                id: 'register-new-domain',
                text: 'new domain',
                type: 'button',
                action: 'registerDomain',
                resourceId: domainData.projectId
            });
        }

        const finalConfig = {
            id: 'domain-menu',
            text: 'domains:',
            items: domainItems.length > 0 ? domainItems : [{ text: 'no domains found', type: 'record' }],
            backTarget: 'resource-menu'
        };
        menus['domain-menu'] = finalConfig;
        renderMenu('domain-menu');
}

async function _relinkDomainLogic(params) {
    const { domainName, renderMenu, updateStatusDisplay } = params;

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
                    ...dep, // Includes 'domain' property if it exists
                    machine_name: vm.name,
                    machine_id: vm.id // Ensure we have the ID
                })));
            }
        });

        // Find the deployment this domain is currently linked to
        const currentDeployment = allDeploymentsRaw.find(dep => dep.domain === domainName);

        // Filter out the current deployment from the list of options
        const availableDeployments = allDeploymentsRaw.filter(dep => {
            if (!currentDeployment) return true; // If not linked, all are available
            return dep.deployment_name !== currentDeployment.deployment_name || dep.machine_id !== currentDeployment.machine_id;
        });

        if (availableDeployments.length === 0) {
            updateStatusDisplay('No other deployments available to link to.', 'info');
            // Immediately go back to the domain details menu.
            setTimeout(() => listDomains(params), 1500);
            return;
        }

        const deploymentOptions = availableDeployments.map(dep => ({
            value: {
                deployment_name: dep.deployment_name,
                machine_id: dep.machine_id,
                machine_name: dep.machine_name // Keep for display label
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
            // On cancellation, just refresh the domain list to go back.
            listDomains(params);
            return;
        }

        const { deployment_name, machine_id } = answer.value;

        // 3. Call the API
        updateStatusDisplay(`Initiating relink for ${domainName}...`, 'info');
        const result = await relinkDomainApi({ domainName, deployment_name, machine_id });

        if (result.ok) {
            updateStatusDisplay('Relink initiated successfully!', 'success');
        } else {
            throw new Error(result.error || 'Failed to initiate relink.');
        }

    } catch (error) {
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    } finally {
        // 4. ALWAYS refresh the domain list immediately to show the new state.
        // This will either show the "linking to..." status or revert on error.
        listDomains(params);
    }
}

export const listDomains = requireAuthAndSubscription(_listDomainsLogic, 'view domains');
export const relinkDomain = requireAuthAndSubscription(_relinkDomainLogic, 'relink domain');
export { handleRegisterNewDomain }; 
