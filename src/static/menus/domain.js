// Import the central menu registry and API base URL
import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { API_BASE_URL, fetchWithAuth } from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { prompt } from '/static/pages/prompt.js';

async function handleRegisterNewDomain(params) {
    const { resourceId: projectId, renderMenu } = params;
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

async function fetchUserDomains() {
    const response = await fetchWithAuth(`${API_BASE_URL}/domains`);
    if (!response.ok) throw new Error(`Failed to fetch domains: ${response.statusText}`);
    return response.json();
}

async function _listDomainsLogic(params) {
    const { renderMenu } = params;
    renderMenu({
        id: 'domain-menu',
        text: 'loading...',
        items: [{ text: 'fetching domains...', type: 'record' }],
        backTarget: 'resource-menu'
    });

    try {
        const data = await fetchUserDomains();
        const domainItems = (data.domains || []).map(d => ({
            text: d.domainName,
            type: 'button' // Changed back to 'button'
        }));

        if (data.projectId) {
            domainItems.push({
                id: 'register-new-domain',
                text: 'new',
                type: 'button', // Changed back to 'button'
                action: 'registerDomain',
                resourceId: data.projectId
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

export const listDomains = requireAuthAndSubscription(_listDomainsLogic, 'view domains');

export { handleRegisterNewDomain }; 