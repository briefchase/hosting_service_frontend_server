import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { registerHandler } from '../scripts/registry.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { fetchSites as apiFetchSites } from '/static/scripts/api.js';
import {
    API_BASE_URL,
    fetchWithAuth,
    updateAccountButtonVisibility,
    updateSiteTitleVisibility,
} from '/static/main.js';
import { prompt } from '/static/pages/prompt.js';

// No more global cache.

function generateMachineDetailsMenu(vm) {
    if (!vm) {
        return {
            id: `machine-details-error-generic`,
            text: 'Error',
            items: [{ id: 'machine-not-found', text: 'Machine details not found.', type: 'record' }],
            backTarget: 'machine-list-menu'
        };
    }

    const machineType = vm.machine_type ? vm.machine_type.split('/').pop() : 'Unknown';

    const detailItems = [
        { id: `details-ip-${vm.id}`, text: `IP: ${vm.ip_address || 'N/A'}`, type: 'record' },
        { id: `details-size-${vm.id}`, text: `Size: ${machineType}`, type: 'record' },
        { id: `details-zone-${vm.id}`, text: `Zone: ${vm.zone || 'Unknown'}`, type: 'record' },
        { id: `details-status-${vm.id}`, text: `Status: ${vm.status || 'Unknown'}`, type: 'record' }
    ];

    const deploymentItems = [
        { text: 'Deployments:', type: 'record', className: 'label-record' }
    ];

    if (vm.deployments && vm.deployments.length > 0) {
        vm.deployments.forEach((d, index) => {
            deploymentItems.push({
                id: `details-deployment-${vm.id}-${index}`,
                text: d.deployment_name,
                type: 'record',
                action: 'viewSite',
                machineId: vm.id,
                deploymentName: d.deployment_name
            });
        });
    } else {
        deploymentItems.push({
            id: `details-deployment-none-${vm.id}`,
            text: 'None',
            type: 'record'
        });
    }

    detailItems.push({
        id: `details-deployments-container-${vm.id}`,
        type: 'horizontal-container',
        items: deploymentItems
    });

    // Add connect and destroy buttons with all necessary data for their actions.
    detailItems.push({ 
        id: `connect-vm-${vm.id}`, 
        text: '<s>connect</s>', 
        type: 'button',
        tooltip: 'coming soon',
        resourceId: vm.id 
    });
    detailItems.push({ 
        id: `rename-vm-${vm.id}`, 
        text: 'rename', 
        type: 'button', 
        action: 'renameMachine',
        showLoading: true, 
        resourceId: vm.id,
        machineName: vm.name,
        zone: vm.zone
    });
    detailItems.push({ 
        id: `destroy-vm-${vm.id}`, 
        text: 'destroy', 
        type: 'button', 
        action: 'destroyMachine', 
        showLoading: true, // Opt-in to the generic loading UI
        resourceId: vm.id,
        machineName: vm.name
    });

    return {
        id: `machine-details-menu-${vm.id}`,
        text: `Machine: ${vm.name}`,
        items: detailItems,
        backTarget: 'machine-list-menu'
    };
}

async function fetchAndProcessMachines() {
    // The `fetchSites` utility actually returns the VM-centric structure.
    return await apiFetchSites();
}

function cacheAllMachineMenus(vms) {
    const machineItems = vms.map(vm => ({
        id: `machine-${vm.id}`,
        text: vm.name,
        type: 'record',
        action: 'viewMachine',
        targetMenu: `machine-details-menu-${vm.id}`,
        resourceId: vm.id
    }));

    if (machineItems.length === 0) {
         machineItems.push({ id: 'no-machines', text: 'no machines found', type: 'record' });
    }

    menus['machine-list-menu'] = {
        id: 'machine-list-menu',
        text: 'machines:',
        items: machineItems,
        backTarget: 'resource-menu'
    };
    
    vms.forEach(vm => {
        menus[`machine-details-menu-${vm.id}`] = generateMachineDetailsMenu(vm);
    });
}

async function _listMachinesLogic(params) {
    const { updateStatusDisplay } = params;
    updateStatusDisplay('fetching machines...', 'info');
    const vms = await fetchAndProcessMachines();
    cacheAllMachineMenus(vms);
    return 'machine-list-menu';
}

export const destroyMachine = requireAuthAndSubscription(async (params) => {
    const { resourceId, machineName, renderMenu, updateStatusDisplay } = params;
    if (!resourceId) {
        return updateStatusDisplay('Missing machine ID for destruction.', 'error');
    }

    const confirmation = await prompt({
        id: 'confirm-destroy-vm-prompt',
        text: `Are you sure you want to destroy the entire machine '${machineName}' and ALL its deployments? This cannot be undone.`,
        type: 'form',
        buttons: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }]
    });

    if (confirmation.status !== 'answered' || confirmation.value !== 'yes') {
        return updateStatusDisplay('Machine destruction cancelled.', 'info');
    }
    
    try {
        updateStatusDisplay('Initiating destruction...', 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/destroy`, {
            method: 'POST',
            body: { vm_id: resourceId }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to destroy machine.');
        }

        updateStatusDisplay(result.message || 'Machine destroyed successfully.', 'success');
        return await _listMachinesLogic({ renderMenu, updateStatusDisplay });

    } catch (e) {
        if (e.message !== 'UserCancelled') {
            console.error('Destroy machine error:', e);
        }
        return await _listMachinesLogic({ renderMenu, updateStatusDisplay });
    }
}, 'destroy a machine');

export const renameMachine = requireAuthAndSubscription(async (params) => {
    const { resourceId, machineName, zone, renderMenu, updateStatusDisplay } = params;
    if (!resourceId || !zone) {
        return updateStatusDisplay('Missing machine data for rename.', 'error');
    }

    const newNamePrompt = await prompt({
        id: 'rename-vm-prompt',
        text: `Enter new name for machine '${machineName}':`,
        type: 'form',
        items: [
            {
                id: 'newName',
                type: 'text',
                value: machineName,
                placeholder: 'new-name',
                validationRegex: '^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$',
                validationError: 'Name must be 1-63 characters, start/end with a letter/number, and can only contain lowercase letters, numbers, or hyphens.'
            }
        ],
        buttons: [
            { label: 'continue', isSubmit: true }
        ]
    });

    if (newNamePrompt.status !== 'answered' || !newNamePrompt.value || newNamePrompt.value.newName === machineName) {
        return updateStatusDisplay('Rename cancelled or name unchanged.', 'info');
    }

    const newName = newNamePrompt.value.newName;

    updateStatusDisplay('Renaming machine...');

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/rename`, {
            method: 'POST',
            body: {
                vm_id: resourceId,
                zone: zone,
                new_display_name: newName
            }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            updateStatusDisplay(result.message || 'Machine renamed successfully!', 'success');
            // Return the menu target for organic transition
            return await _listMachinesLogic({ renderMenu, updateStatusDisplay });
        } else {
            throw new Error(result.error || 'Failed to rename machine.');
        }
    } catch (error) {
        if (error.message !== 'UserCancelled') {
            console.error('Error renaming machine:', error);
        }
        // If the rename fails, we should still refresh the machine list
        // to return the user to a stable state.
        return await _listMachinesLogic({ renderMenu, updateStatusDisplay });
    }
});

export async function viewMachine(params) {
    const { resourceId, renderMenu } = params;
    if (menus[`machine-details-menu-${resourceId}`]) {
        renderMenu(`machine-details-menu-${resourceId}`);
    } else {
        // Fallback or re-fetch logic if needed, similar to viewSite
        renderMenu('machine-list-menu');
    }
}

export const listMachines = requireAuthAndSubscription(_listMachinesLogic, 'view machines');

// Register handlers with the central registry
registerHandler('listMachines', listMachines);
registerHandler('viewMachine', viewMachine);
registerHandler('destroyMachine', destroyMachine);
registerHandler('renameMachine', renameMachine);
