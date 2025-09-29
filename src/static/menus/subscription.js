// Import the central menu registry
import { menus, renderMenu } from '/static/pages/menu.js';
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
    updateStatusDisplay("loading...", "info");

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/create-checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embedded: true })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'An unknown error occurred.' }));
            throw new Error(errorData.error);
        }

        const session = await response.json();

        if (session && (session.resumed || session.already_active)) {
            await fetchSubscriptionStatus();
            updateStatusDisplay('', 'info');
            return;
        }

        // Prefer embedded checkout; if client_secret missing, the prompt will request it
        const clientSecret = session && session.client_secret;
        const { prompt } = await import('/static/pages/prompt.js');
        await prompt({
            id: 'embedded_checkout_prompt',
            text: 'Complete your subscription below:',
            type: 'embedded_checkout',
            required: true,
            client_secret: clientSecret
        });

        // After user returns from embedded checkout, refresh status
        await fetchSubscriptionStatus();
        updateStatusDisplay('', 'info');
    } catch (error) {
        console.error("Failed to start embedded checkout:", error);
        updateStatusDisplay(`Failed to start subscription process: ${error.message}`, "error");
    }
}

// Open Stripe billing portal (frontend may be allowed to talk to Stripe directly per your note)
// Billing portal removed

export async function handleCancelSubscription() {
    try {
        updateStatusDisplay('canceling...', 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/cancel-subscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ immediate: false }) // set true to cancel immediately
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Failed to cancel');
        // Immediately refresh status and let the status line show the end date
        await fetchSubscriptionStatus();
        updateStatusDisplay('', 'info'); // clear transient message
    } catch (e) {
        console.error('Cancel subscription error:', e);
        updateStatusDisplay(`Unable to cancel subscription: ${e.message}`,'error');
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

        // Update or create menu items
        const statusItem = menus['subscription-menu'].items.find(item => item.id === 'sub-status');
        let actionItem = menus['subscription-menu'].items.find(item => item.id === 'subscription-action');
        if (!actionItem) {
            actionItem = { id: 'subscription-action', type: 'button', text: '', action: null };
            menus['subscription-menu'].items.push(actionItem);
        }
        
        if (data.status === 'active') {
            let statusText = 'Status: Active';
            if (data.cancel_at_period_end && data.ends_on) {
                const endDate = new Date(data.ends_on * 1000).toLocaleDateString();
                statusText = `Status: Active (ends ${endDate})`;
                // While scheduled to end, offer resume (backend will resume on subscribe)
                actionItem.text = 'resume';
                actionItem.action = 'handleSubscribe';
            } else {
                actionItem.text = 'cancel';
                actionItem.action = 'handleCancelSubscription';
            }
            if (statusItem) statusItem.text = statusText;
        } else {
            if (statusItem) statusItem.text = 'Status: Inactive';
            if (actionItem) {
                actionItem.text = 'subscribe';
                actionItem.action = 'handleSubscribe';
            }
        }

        // Update DOM if element exists; otherwise render once to create it
        const statusElement = document.getElementById('sub-status');
        const actionElement = document.getElementById('subscription-action');
        if (statusElement && statusItem) {
            statusElement.textContent = statusItem.text;
        }
        if (actionElement) {
            if (actionItem && actionItem.text) {
                actionElement.textContent = actionItem.text;
                if (actionItem.action) {
                    actionElement.setAttribute('data-action', actionItem.action);
                } else {
                    actionElement.removeAttribute('data-action');
                }
            }
        } else {
            if (isOnSubscriptionPage) {
                renderMenu('subscription-menu');
            }
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
        { id: 'sub-status', text: 'Status: Checking...', type: 'record' }
    ],
    backTarget: 'dashboard-menu',
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