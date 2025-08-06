// Import the central menu registry
import { menus } from '/static/pages/menu.js';
import { API_BASE_URL } from '/static/main.js';
import { fetchWithAuth } from '/static/main.js';
import { updateStatusDisplay } from '/static/pages/menu.js';

// Subscription polling state
let subscriptionPollingInterval = null;
let stripe = null;
let isOnSubscriptionPage = false;

// Initialize Stripe
export async function initializeStripe() {
    try {
        const response = await fetch(`${API_BASE_URL}/config`);
        if (!response.ok) {
            throw new Error('Failed to fetch Stripe configuration from server.');
        }
        const config = await response.json();
        const stripePublishableKey = config.stripePublishableKey;
        
        if (!stripePublishableKey) {
            throw new Error("Stripe publishable key not found in server config.");
        }
        
        stripe = Stripe(stripePublishableKey);
        console.log("Stripe.js initialized successfully.");
    } catch (error) {
        console.error("Error initializing Stripe:", error);
        updateStatusDisplay("Could not initialize payment system. Please try again later.", "error");
    }
}

// Handle subscription checkout
export async function handleSubscribe() {
    if (!stripe) {
        console.error("Stripe is not initialized. Cannot proceed with subscription.");
        updateStatusDisplay("Payment system is not ready. Please refresh the page.", "error");
        return;
    }

    updateStatusDisplay("Redirecting to checkout...", "info");

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/create-checkout-session`, {
            method: 'POST'
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'An unknown error occurred.' }));
            throw new Error(errorData.error);
        }

        const session = await response.json();
        const { error } = await stripe.redirectToCheckout({
            sessionId: session.checkout_session_id
        });

        if (error) {
            console.error("Error redirecting to Stripe Checkout:", error);
            updateStatusDisplay(error.message, "error");
        }
    } catch (error) {
        console.error("Failed to create checkout session:", error);
        updateStatusDisplay(`Failed to start subscription process: ${error.message}`, "error");
    }
}

// Fetch subscription status
async function fetchSubscriptionStatus() {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/subscription-status`);
        if (!response.ok) {
            throw new Error('Failed to fetch subscription status');
        }
        const data = await response.json();

        // Update the menu config
        const statusItem = menus['subscription-menu'].items.find(item => item.id === 'sub-status');
        const buttonItem = menus['subscription-menu'].items.find(item => item.id === 'checkout-button');
        
        // Update DOM elements directly to avoid re-render loop
        const statusElement = document.getElementById('sub-status');
        const buttonElement = document.getElementById('checkout-button');
        
        if (data.status === 'active') {
            if (statusItem) statusItem.text = 'Status: Active';
            if (statusElement) statusElement.textContent = 'Status: Active';
            
            // Hide subscribe button if already active
            if (buttonItem) buttonItem.hidden = true;
            if (buttonElement) buttonElement.style.display = 'none';
        } else {
            if (statusItem) statusItem.text = 'Status: Inactive';
            if (statusElement) statusElement.textContent = 'Status: Inactive';
            
            // Show subscribe button if inactive
            if (buttonItem) buttonItem.hidden = false;
            if (buttonElement) buttonElement.style.display = 'list-item';
        }
    } catch (error) {
        console.error('Error fetching subscription status:', error);
        
        // Update both config and DOM for error state
        const statusItem = menus['subscription-menu'].items.find(item => item.id === 'sub-status');
        const statusElement = document.getElementById('sub-status');
        
        if (statusItem) statusItem.text = 'Status: Error';
        if (statusElement) statusElement.textContent = 'Status: Error';
        
        if (isOnSubscriptionPage) {
            updateStatusDisplay('Could not retrieve subscription status.', 'error');
        }
    }
}

// Start polling subscription status every 20 seconds
function startSubscriptionPolling() {
    if (subscriptionPollingInterval) {
        clearInterval(subscriptionPollingInterval);
    }
    
    isOnSubscriptionPage = true;
    console.log('Starting subscription status polling (every 20 seconds)');
    
    // Poll every 20 seconds
    subscriptionPollingInterval = setInterval(() => {
        if (isOnSubscriptionPage) {
            fetchSubscriptionStatus();
        } else {
            stopSubscriptionPolling();
        }
    }, 20000);
}

// Stop polling subscription status
function stopSubscriptionPolling() {
    if (subscriptionPollingInterval) {
        clearInterval(subscriptionPollingInterval);
        subscriptionPollingInterval = null;
        console.log('Stopped subscription status polling');
    }
    isOnSubscriptionPage = false;
}

// Define Subscription Menu Configuration
const subscriptionMenuConfig = {
    text: 'Subscription',
    items: [
        // This item will be updated dynamically
        { id: 'sub-status', text: 'Status: Checking...', type: 'record' },
        // This button will be shown/hidden dynamically
        { id: 'checkout-button', text: 'Subscribe Now', type: 'button', action: 'handleSubscribe', info: 'Redirects to Stripe to complete your purchase.' }
    ],
    backTarget: 'account-menu',
    onRender: async () => {
        // Only start polling if not already started to avoid multiple intervals
        if (!subscriptionPollingInterval) {
            startSubscriptionPolling();
            
            // Fetch status immediately on first render
            await fetchSubscriptionStatus();
        }
    },
    onLeave: () => {
        // Stop polling when leaving the subscription menu
        stopSubscriptionPolling();
    }
};

// Register this menu configuration
menus['subscription-menu'] = subscriptionMenuConfig; 