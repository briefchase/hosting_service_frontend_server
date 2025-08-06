import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { API_BASE_URL, fetchWithAuth } from '/static/main.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';

let fetchedInstances = [];

function generateInstanceDetailsMenu(instanceId) {
    const instance = fetchedInstances.find(i => i.id === instanceId && i.type === 'vm');
    if (!instance) {
        return {
            id: `instance-details-error-${instanceId}`,
            text: 'Error',
            items: [{ id: 'instance-not-found', text: 'Instance details not found.', type: 'record' }],
            backTarget: 'instance-list-menu'
        };
    }
    // (Details menu generation logic remains the same)
    let detailItems = [
        { id: `details-deployment-${instance.id}`, text: `Deployment: ${instance.deployment || 'Unknown'}`, type: 'record' },
        { id: `details-status-${instance.id}`, text: `Status: ${instance.status || 'Unknown'}`, type: 'record' },
        { id: `details-ip-${instance.id}`, text: `IP: ${instance.ip_address || 'N/A'}`, type: 'record' },
        { id: `details-zone-${instance.id}`, text: `Zone: ${instance.zone || 'Unknown'}`, type: 'record' },
        { id: `details-machine-${instance.id}`, text: `Machine: ${instance.machine_type || 'Unknown'}`, type: 'record' },
        { id: `connect-${instance.id}`, text: 'connect', type: 'button', action: 'loadTerminalView', resourceId: instance.id },
        { id: `vm-destroy-${instance.id}`, text: 'destroy', type: 'button' }
            ];
    return {
        id: `instance-details-menu-${instance.id}`,
        text: `Instance: ${instance.name.replace(/^\s*└─\s*/, '')} (${instance.type})`,
        items: detailItems,
        backTarget: 'instance-list-menu'
    };
}

// This is the core logic, to be wrapped by our guard.
async function _listInstancesLogic(params) {
    const { renderMenu } = params;
    renderMenu({
        id: 'instance-list-menu',
        text: 'loading...',
        items: [{ text: 'fetching instances...', type: 'record' }],
        backTarget: 'resource-menu'
    });

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/instances`);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status}`);
        }
        const instances = await response.json();
        fetchedInstances = instances;

        const instanceItems = instances.map(item => {
            if (item.type === 'vm') {
                return {
                    id: `instance-${item.id}`,
                    text: item.name,
                    targetMenu: `instance-details-menu-${item.id}`,
                    resourceId: item.id,
                    type: 'button'
                };
            }
            return null; // Return null for non-vm types to filter them out
        }).filter(Boolean); // Filter out nulls and the original placeholder

        // Handle case where all items were filtered out but the API returned data
        if (instances.length > 0 && instanceItems.length === 0) {
            // This can happen if API returns only "no-deployments" record
             const noDeploymentsRecord = instances.find(inst => inst.id === 'no-deployments');
             if(noDeploymentsRecord){
                instanceItems.push({ id: 'no-instances', text: noDeploymentsRecord.name, type: 'record' });
             } else {
                instanceItems.push({ id: 'no-instances', text: 'no deployments found', type: 'record' });
             }
        } else if (instanceItems.length === 0) {
             instanceItems.push({ id: 'no-instances', text: 'no deployments found', type: 'record' });
        }

        const finalConfig = {
            id: 'instance-list-menu',
            text: 'deployments:',
            items: instanceItems,
            backTarget: 'resource-menu'
        };
        menus['instance-list-menu'] = finalConfig;

        fetchedInstances.filter(i => i.type === 'vm').forEach(instance => {
            menus[instanceDetailsMenuId(instance.id)] = generateInstanceDetailsMenu(instance.id);
        });

        renderMenu('instance-list-menu');
    } catch (error) {
        renderMenu({
            id: 'instance-list-menu',
            text: 'error',
            items: [{ text: `could not load instances: ${error.message}`, type: 'record' }],
            backTarget: 'resource-menu'
        });
    }
}

function instanceDetailsMenuId(id) {
    return `instance-details-menu-${id}`;
}

// Export the guarded function as the main action handler.
export const listInstances = requireAuthAndSubscription(_listInstancesLogic, 'view instances'); 