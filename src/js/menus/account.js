// Import the central menu registry
import { menus } from '/js/pages/menu.js';
import { registerHandler } from '../scripts/registry.js';
import { fetchWithAuth } from '/js/main.js';
import { CONFIG } from '/js/config.js';
const API_BASE_URL = CONFIG.API_BASE_URL;
import { prompt } from '/js/pages/prompt.js';


export const handleRescind = async () => {
    const confirmation = await prompt({
        id: 'confirm-rescind-prompt',
        text: "Are you sure you want to rescind our access to your google account? Scheduled backups will not be created, and you will be logged out. Signing back in will undo this action.",
        type: 'form',
        buttons: [{ label: 'yes', value: true }, { label: 'no', value: false }]
    });

    if (confirmation.status !== 'answered' || confirmation.value !== true) {
        // User cancelled, do nothing. Optionally, show a status message.
        return;
    }

    console.log("Rescinding access...");
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/rescind`, {
            method: 'POST'
        });
        if (response.ok) {
            console.log("Successfully rescinded access on server.");
        } else {
            const errorData = await response.json().catch(() => ({}));
            console.error("Server rescind failed:", response.status, errorData.error || 'Unknown error');
            // Inform the user via console, but still log them out locally.
            console.warn("Could not rescind Google access, but you will be logged out. Please revoke access manually in your Google account settings.");
        }
    } catch (error) {
        console.error("Error during rescind request:", error);
    } finally {
        // Always clear local session and redirect
        sessionStorage.removeItem('currentUser');
        window.location.href = '/landing.html';
    }
};

// Register handlers with the central registry
registerHandler('handleRescind', handleRescind);

// Define Account Menu Configuration
const accountMenuConfig = {
    text: function() {
        try {
            const storedUserString = sessionStorage.getItem('currentUser');
            if (storedUserString) {
                const currentUser = JSON.parse(storedUserString);
                if (currentUser && currentUser.email) {
                    return currentUser.email; // Display user's email as the title
                }
            }
        } catch (error) {
            console.error("Error retrieving user email for account menu title:", error);
        }
        return 'Account'; // Default title if email is not found or error occurs
    },
    items: [
        { id: 'logout-button', text: 'logout', type: 'button', action: 'handleLogout' },
        { id: 'sub-button', text: 'subscription', type: 'button', targetMenu: 'subscription-menu' },
        { id: 'rescind-button', text: 'rescind access', type: 'button', action: 'handleRescind' },
    ],
    backTarget: 'dashboard-menu'
};

// Register this menu configuration
menus['account-menu'] = accountMenuConfig; 