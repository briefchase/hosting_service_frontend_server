import { menus, renderMenu, updateStatusDisplay } from '/static/pages/menu.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { fetchSites as apiFetchSites } from '/static/scripts/utilities.js';
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
                type: 'record'
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
        resourceId: vm.id 
    });
    detailItems.push({ 
        id: `rename-vm-${vm.id}`, 
        text: 'rename', 
        type: 'button', 
        action: 'renameMachine', 
        resourceId: vm.id,
        machineName: vm.name,
        zone: vm.zone
    });
    detailItems.push({ 
        id: `destroy-vm-${vm.id}`, 
        text: 'destroy', 
        type: 'button', 
        action: 'destroyMachine', 
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
        type: 'button',
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

async function _listMachinesLogic({ renderMenu, updateStatusDisplay }) {
    try {
        updateStatusDisplay('fetching machines...', 'info');
        const vms = await fetchAndProcessMachines();
        cacheAllMachineMenus(vms);
        renderMenu('machine-list-menu');
    } catch (error) {
        renderMenu({
            id: 'machine-list-menu',
            text: 'error',
            items: [{ text: `could not load machines: ${error.message}`, type: 'record' }],
            backTarget: 'resource-menu'
        });
    }
}

export const destroyMachine = requireAuthAndSubscription(async (params) => {
    const { machineName, renderMenu, updateStatusDisplay, menuContainer, menuTitle } = params;
    if (!machineName) {
        return updateStatusDisplay('Missing machine name for destruction.', 'error');
    }

    const confirmation = await prompt({
        id: 'confirm-destroy-vm-prompt',
        text: `Are you sure you want to destroy the entire machine '${machineName}' and ALL its deployments? This cannot be undone.`,
        type: 'options',
        options: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }]
    });

    if (confirmation.status !== 'answered' || confirmation.value !== 'yes') {
        return updateStatusDisplay('Machine destruction cancelled.', 'info');
    }

    document.body.classList.add('deployment-loading');
    updateAccountButtonVisibility(false);
    updateSiteTitleVisibility(false);
    if (menuContainer) {
        const listContainer = menuContainer.querySelector('#menu-list-container');
        if (listContainer) {
            listContainer.innerHTML = '';
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

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/destroy`, {
            method: 'POST',
            body: { vm_name: machineName }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to destroy machine.');
        }

        updateStatusDisplay(result.message || 'Machine destroyed successfully.', 'success');
        await _listMachinesLogic({ renderMenu, updateStatusDisplay });

    } catch (e) {
        console.error('Destroy machine error:', e);
        updateStatusDisplay(`Could not destroy machine: ${e.message}`, 'error');
    } finally {
        document.body.classList.remove('deployment-loading');
        if (menuTitle) {
            menuTitle.classList.remove('rainbow-text');
        }
    }
}, 'destroy a machine');

export const renameMachine = requireAuthAndSubscription(async (params) => {
    const { machineName, zone, renderMenu, updateStatusDisplay } = params;
    if (!machineName || !zone) {
        return updateStatusDisplay('Missing machine data for rename.', 'error');
    }

    const newNamePrompt = await prompt({
        id: 'rename-vm-prompt',
        text: `Enter new name for machine '${machineName}':`,
        type: 'text',
        defaultValue: machineName,
        showContinueButton: true,
        validationRegex: '^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$',
        validationError: 'Name must be 1-63 characters, start/end with a letter/number, and can only contain lowercase letters, numbers, or hyphens.'
    });

    if (newNamePrompt.status !== 'answered' || !newNamePrompt.value || newNamePrompt.value === machineName) {
        return updateStatusDisplay('Rename cancelled or name unchanged.', 'info');
    }

    const newName = newNamePrompt.value;

    updateStatusDisplay('Renaming machine...');

    try {
        const response = await fetchWithAuth(`/api/rename`, {
            method: 'POST',
            body: {
                vm_name: machineName,
                zone: zone,
                new_display_name: newName
            }
        });

        const result = await response.json();

        if (response.ok) {
            updateStatusDisplay('Machine renamed successfully!', 'success');
            await _listMachinesLogic({ renderMenu, updateStatusDisplay });
        } else {
            throw new Error(result.error || 'Failed to rename machine.');
        }
    } catch (error) {
        console.error('Error renaming machine:', error);
        updateStatusDisplay(`Error: ${error.message}`, 'error');
    }
});

export const listMachines = requireAuthAndSubscription(_listMachinesLogic, 'view machines');
