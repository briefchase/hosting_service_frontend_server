// Import the central menu registry
import { menus } from '/static/pages/menu.js';

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
        { id: 'rescind-button', text: 'rescind access', type: 'button' },
    ],
    backTarget: 'dashboard-menu'
};

// Register this menu configuration
menus['account-menu'] = accountMenuConfig; 