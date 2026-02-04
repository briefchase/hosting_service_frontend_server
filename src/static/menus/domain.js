// Import the central menu registry and API base URL
import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { API_BASE_URL, fetchWithAuth, updateBackButtonHandler, unregisterBackButtonHandler } from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { prompt, cancelCurrentPrompt } from '/static/pages/prompt.js';
import { fetchSites } from '/static/scripts/utilities.js';

async function fetchDomains() {
    const response = await fetchWithAuth(`${API_BASE_URL}/domains`);
    if (!response.ok) {
        throw new Error(`Failed to fetch domains: ${response.statusText}`);
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
    try {
        updateStatusDisplay('fetching domains...', 'info');
        const [domainData, sitesData] = await Promise.all([
            fetchDomains(),
            fetchSites()
        ]);
        
        const allDeployments = [];
        if (Array.isArray(sitesData)) {
            sitesData.forEach(vm => {
                if (vm.deployments && vm.deployments.length > 0) {
                    allDeployments.push(...vm.deployments.map(dep => ({
                        ...dep,
                        machine_name: vm.name,
                        deployment_name: dep.deployment_name // Ensure this is present
                    })));
                }
            });
        }
        
        if (domainData.message && allDeployments.length === 0) {
            renderMenu({
                id: 'domain-menu',
                text: 'domains:',
                items: [{ text: domainData.message, type: 'record' }],
                backTarget: 'resource-menu'
            });
            return;
        }

        const gcpDomainNames = new Set((domainData.domains || []).map(d => d.domainName));
        const allDomainObjects = (domainData.domains || []).map(d => ({ ...d, isGcpManaged: true }));

        // Find and add externally managed domains that are linked to deployments
        allDeployments.forEach(dep => {
            if (dep.domain && !gcpDomainNames.has(dep.domain)) {
                allDomainObjects.push({
                    domainName: dep.domain,
                    isGcpManaged: false,
                });
                gcpDomainNames.add(dep.domain); // Add to set to prevent duplicates
            }
        });

        const domainItems = allDomainObjects.map(d => {
            const linkedDeployment = allDeployments.find(dep => dep.domain === d.domainName);
            const menuId = `domain-details-${d.domainName.replace(/\./g, '-')}`;
            
            const detailItems = [
                {
                    text: `site: ${linkedDeployment ? linkedDeployment.deployment_name : 'unlinked'}`,
                    type: 'record'
                }
            ];

            if (d.isGcpManaged) {
                detailItems.push({
                    id: `relink-${d.domainName.replace(/\./g, '-')}`,
                    text: 'relink',
                    type: 'button',
                    action: 'relinkDomain',
                    domainName: d.domainName
                });
            } else {
                detailItems.push({
                    text: 'managed externally',
                    type: 'record'
                });
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
                text: 'new',
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
    } catch (error) {
        renderMenu({
            id: 'domain-menu',
            text: 'error',
            items: [{ text: `could not load domains: ${error.message}`, type: 'record' }],
            backTarget: 'resource-menu'
        });
    }
}

async function _relinkDomainLogic(params) {
    updateStatusDisplay('Relinking domains is not yet implemented.', 'info');
}

export const listDomains = requireAuthAndSubscription(_listDomainsLogic, 'view domains');
export const relinkDomain = requireAuthAndSubscription(_relinkDomainLogic, 'relink domain');
export { handleRegisterNewDomain }; 
