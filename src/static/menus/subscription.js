import { menus, renderMenu, updateStatusDisplay, startLoading } from '/static/pages/menu.js';
import { registerHandler } from '../scripts/registry.js';
import { CONFIG } from '/static/config.js';
import { fetchWithAuth } from '/static/main.js';

const API_BASE_URL = CONFIG.API_BASE_URL;
import { pushBackHandler } from '/static/scripts/back.js';
import { prompt } from '/static/pages/prompt.js';
import { requireAuth } from '/static/scripts/authenticate.js';

// Subscription polling state
let subscriptionPollingInterval = null;
let stripe = null;
let isOnSubscriptionPage = false;

// Initialize Stripe
export async function initializeStripe() {
    try {
        const response = await fetch(`${API_BASE_URL}/stripe-config`);
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
export async function handleSubscribe(actionFn, params) {
    if (typeof actionFn === 'object' && !params) {
        params = actionFn;
        actionFn = params.actionFn;
    }

    const { promoCode } = params || {};
    
    const workFn = async () => {
        updateStatusDisplay('loading...', 'info');

        const body = { embedded: true };
        if (promoCode) body.promo_code = promoCode;

        const response = await fetchWithAuth(`${API_BASE_URL}/create-checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'An unknown error occurred.' }));
            throw new Error(errorData.error || 'Could not create a checkout session.');
        }

        const session = await response.json();

        if (session && (session.resumed || session.already_active)) {
            await fetchSubscriptionStatus(params);
            updateStatusDisplay('', 'info');
            
            if (actionFn) return await actionFn({ ...params, session });
            return 'subscription-menu';
        }

        // Prefer embedded checkout; if client_secret missing, the prompt will request it
        const clientSecret = session && session.client_secret;

        const result = await prompt({
            id: 'embedded_checkout_prompt',
            text: 'complete your subscription',
            type: 'embedded_checkout',
            required: true,
            client_secret: clientSecret
        });

        // After user returns from embedded checkout, refresh status
        try {
            await fetchSubscriptionStatus(params);
        } catch (e) {
            if (e.message === 'ReauthInitiated') throw e;
            console.warn("[Subscription] Failed to refresh status after checkout:", e);
        }
        updateStatusDisplay('', 'info');
        
        // If we were in a guard flow, resume the original action
        if (result.status === 'answered' && result.value === 'completed') {
            if (actionFn) {
                console.log("[Subscription] Checkout complete, resuming original action.");
                return await actionFn(params);
            }
            return 'subscription-menu';
        }
        
        return 'subscription-menu';
    };

    try {
        return await startLoading(workFn);
    } catch (error) {
        if (error.message === 'UserCancelled') throw error;
        console.error("Failed to start embedded checkout:", error);
        updateStatusDisplay(`Failed to start subscription process: ${error.message}`, "error");
        return 'subscription-menu';
    }
}

// This function now uses the generic loading UI via showLoading: false
export async function handleCancelSubscription(params) {
    const confirmation = await prompt({
        id: 'confirm-cancel-subscription-prompt',
        text: "Are you sure you want to cancel your membership? Scheduled backups will not be created, and your deployed machines will remain active. You may however, enable your membership again anytime in the future.",
        type: 'form',
        buttons: [{ label: 'yes', value: true }, { label: 'no', value: false }]
    });

    if (confirmation.status !== 'answered' || confirmation.value !== true) {
        return; 
    }

    const workFn = async () => {
        updateStatusDisplay('canceling...', 'info');
        const response = await fetchWithAuth(`${API_BASE_URL}/cancel-subscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ immediate: false }) // set true to cancel immediately
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Failed to cancel');
        // Immediately refresh status and let the status line show the end date
        await fetchSubscriptionStatus(params);
        updateStatusDisplay('', 'info'); // clear transient message
        return 'subscription-menu';
    };

    try {
        return await startLoading(workFn);
    } catch (e) {
        if (e.message === 'UserCancelled') throw error;
        console.error('Cancel subscription error:', e);
        updateStatusDisplay(`Unable to cancel subscription: ${e.message}`,'error');
        return 'subscription-menu';
    }
}

// Fetch subscription status
async function _fetchSubscriptionStatusLogic(params) {
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
            actionItem = { id: 'subscription-action', type: 'button', text: '', action: null, showLoading: false };
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

        // Update DOM: Always perform a full re-render to ensure styles and classes are preserved
        if (isOnSubscriptionPage) {
            renderMenu('subscription-menu');
        }
    } catch (error) {
        if (error.message === 'ReauthInitiated') {
            throw error;
        }
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

export const fetchSubscriptionStatus = requireAuth(_fetchSubscriptionStatusLogic, 'view subscription');

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
    text: 'subscription:',
    items: [
        // This item will be updated dynamically
        { id: 'sub-status', text: 'Status: Checking...', type: 'record', className: 'details-last-record' }
    ],
    backTarget: 'account-menu',
    onRender: async (params) => {
        // Only start polling if not already started to avoid multiple intervals
        if (!subscriptionPollingInterval) {
            startSubscriptionPolling();
            
            // Fetch status immediately on first render
            try {
                await fetchSubscriptionStatus(params);
            } catch (error) {
                if (error.message === 'UserCancelled') {
                    console.log("[Subscription] User cancelled re-auth, navigating back.");
                    renderMenu(subscriptionMenuConfig.backTarget);
                } else {
                    throw error;
                }
            }
        }
    },
    onLeave: () => {
        // Stop polling when leaving the subscription menu
        stopSubscriptionPolling();
    }
};

// Register this menu configuration
menus['subscription-menu'] = subscriptionMenuConfig;

// Register handlers with the central registry
registerHandler('handleSubscribe', handleSubscribe);
registerHandler('handleCancelSubscription', handleCancelSubscription);
 