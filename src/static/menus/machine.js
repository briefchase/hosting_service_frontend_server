import { menus } from '/static/pages/menu.js';
import { requireAuthAndSubscription } from '/static/scripts/authenticate.js';
import { fetchSites } from '/static/scripts/utilities.js';
import {
    API_BASE_URL,
    fetchWithAuth,
    updateAccountButtonVisibility,
    updateSiteTitleVisibility,
} from '/static/main.js';
import { clearPromptStack, prompt } from '/static/pages/prompt.js';

let fetchedVms = []; // Store the raw VM data

function machineDetailsMenuId(id) {
    return `machine-details-menu-${id}`;
}

function generateMachineDetailsMenu(vmId) {
    const vm = fetchedVms.find(v => v.id === vmId);
    if (!vm) {
        return {
            id: `machine-details-error-${vmId}`,
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

    const menuActions = [
        { id: `rename-machine-${vm.id}`, text: 'rename', action: 'renameMachine', params: { machineId: vm.id, currentName: vm.name } },
        { id: `connect-machine-${vm.id}`, text: 'connect', action: 'connectToMachine', params: { machineId: vm.id } },
    ];

    // Add connect and destroy buttons
    detailItems.push({ id: `connect-vm-${vm.id}`, text: '<s>connect</s>', type: 'button', resourceId: vm.id });
    detailItems.push({ id: `rename-vm-${vm.id}`, text: 'rename', type: 'button', action: 'renameMachine', resourceId: vm.id });
    detailItems.push({ id: `destroy-vm-${vm.id}`, text: 'destroy', type: 'button', action: 'destroyMachine', resourceId: vm.id });

    return {
        id: machineDetailsMenuId(vm.id),
        text: `Machine: ${vm.name}`,
        items: detailItems,
        backTarget: 'machine-list-menu'
    };
}


// This is the core logic, to be wrapped by our security guard.
async function _listMachinesLogic({ renderMenu, updateStatusDisplay }) {
    renderMenu({
        id: 'machine-list-menu',
        text: 'loading...',
        items: [{ text: 'fetching machines...', type: 'record' }],
        backTarget: 'resource-menu'
    });

    try {
        // fetchSites now returns the new VM-centric structure
        const vms = await fetchSites();
        fetchedVms = vms; // Cache the data
        let machineItems = [];
        let emptyMessage = 'no machines found';

        if (Array.isArray(vms) && vms.length > 0) {
            machineItems = vms.map(vm => ({
                id: `machine-${vm.id}`,
                text: vm.name, // e.g., "vm-1677628800"
                type: 'button',
                targetMenu: machineDetailsMenuId(vm.id),
                resourceId: vm.id
            }));
        }
        
        if (machineItems.length === 0) {
             machineItems.push({ id: 'no-machines', text: emptyMessage, type: 'record' });
        }

        const finalConfig = {
            id: 'machine-list-menu',
            text: 'machines:',
            items: machineItems,
            backTarget: 'resource-menu'
        };
        
        // Cache the generated menu
        menus['machine-list-menu'] = finalConfig;
        
        // Generate and cache the details menus for each machine
        fetchedVms.forEach(vm => {
            menus[machineDetailsMenuId(vm.id)] = generateMachineDetailsMenu(vm.id);
        });

        // Render the final menu
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

// Action handler to destroy a VM
export const destroyMachine = requireAuthAndSubscription(async (params) => {
    const { resourceId, renderMenu, updateStatusDisplay, menuContainer, menuTitle } = params;
    if (!resourceId) {
        return updateStatusDisplay('Missing machine ID for destruction.', 'error');
    }

    const vm = fetchedVms.find(v => v.id === resourceId);
    if (!vm) {
        return updateStatusDisplay('Machine data not found for destroy operation.', 'error');
    }

    const { prompt } = await import('/static/pages/prompt.js');
    const confirmation = await prompt({
        id: 'confirm-destroy-vm-prompt',
        text: `Are you sure you want to destroy the entire machine '${vm.name}' and ALL its deployments? This cannot be undone.`,
        type: 'options',
        options: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }]
    });

    if (confirmation.status !== 'answered' || confirmation.value !== 'yes') {
        return updateStatusDisplay('Machine destruction cancelled.', 'info');
    }

    // --- Start: Show Loading GIF & Rainbow Text ---
    document.body.classList.add('deployment-loading');
    updateAccountButtonVisibility(false);
    updateSiteTitleVisibility(false);
    if (menuContainer) {
        const listContainer = menuContainer.querySelector('#menu-list-container');
        if (listContainer) {
            listContainer.innerHTML = ''; // Clear the menu buttons
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
    // --- End: Show Loading GIF & Rainbow Text ---

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/destroy`, {
            method: 'POST',
            body: { vm_name: vm.name }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to destroy machine.');
        }

        updateStatusDisplay(result.message || 'Machine destroyed successfully.', 'success');
        // Go back to the list and refresh it
        await _listMachinesLogic({ renderMenu, updateStatusDisplay });

    } catch (e) {
        console.error('Destroy machine error:', e);
        updateStatusDisplay(`Could not destroy machine: ${e.message}`, 'error');
    } finally {
        // --- Start: Hide Loading GIF & Rainbow Text ---
        document.body.classList.remove('deployment-loading');
        if (menuTitle) {
            menuTitle.classList.remove('rainbow-text');
        }
        // --- End: Hide Loading GIF & Rainbow Text ---
    }
}, 'destroy a machine');

// Action handler for renaming a machine
export const renameMachine = requireAuthAndSubscription(async (params) => {
    const { machineId, currentName } = params;
    if (!machineId) {
        console.error("No machineId provided for rename action");
        return;
    }

    // Find the VM details from the cached list
    const vm = (window.cachedVms || []).find(v => v.id === machineId);
    if (!vm) {
        console.error(`Could not find VM with id ${machineId} in cache.`);
        return;
    }

    const newNamePrompt = await prompt({
        id: 'rename-vm-prompt',
        text: `Enter new name for machine '${currentName}':`,
        type: 'text',
        defaultValue: currentName,
        showContinueButton: true,
        validationRegex: '^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$',
        validationError: 'Name must be 1-63 characters, start and end with a letter/number, and contain only lowercase letters, numbers, or hyphens.'
    });

    if (newNamePrompt.status !== 'answered' || !newNamePrompt.value || newNamePrompt.value === currentName) {
        console.log('VM rename cancelled or name unchanged.');
        return;
    }

    const newName = newNamePrompt.value;

    openPopup('loading', 'Renaming machine...');

    try {
        const response = await fetchWithAuth(`/api/rename`, {
            method: 'POST',
            body: {
                vm_name: vm.name,
                zone: vm.zone,
                new_display_name: newName
            }
        });

        const result = await response.json();
        closePopup();

        if (response.ok) {
            openPopup('success', 'Machine renamed successfully!');
            // Invalidate cache and refresh the machine list to show the new name
            window.cachedVms = null;
            listMachines(); // Assumes listMachines is available in scope to refresh the view
        } else {
            throw new Error(result.error || 'Failed to rename machine.');
        }
    } catch (error) {
        console.error('Error renaming machine:', error);
        openPopup('error', `Error: ${error.message}`);
    }
});


// Export the guarded function as the main action handler.
export const listMachines = requireAuthAndSubscription(_listMachinesLogic, 'view machines');
