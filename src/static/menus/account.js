// Import the central menu registry
import { menus } from '/static/pages/menu.js';
import { fetchWithAuth, API_BASE_URL } from '/static/main.js';


export const handleRescind = async () => {
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
            // Inform the user, but still log them out locally.
            alert("Could not rescind Google access, but you will be logged out. Please revoke access manually in your Google account settings.");
        }
    } catch (error) {
        console.error("Error during rescind request:", error);
         alert("An error occurred. Please try again.");
    } finally {
        // Always clear local session and redirect
        sessionStorage.removeItem('currentUser');
        window.location.href = '/landing.html';
    }
};

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