import { fetchWithAuth, API_BASE_URL } from '/static/main.js';
import { getUser, clearPendingReauthAction } from '/static/scripts/authenticate.js';
import { checkDomainAvailability as apiCheckDomainAvailability } from '/static/scripts/api.js';
import { openPopup } from '/static/scripts/popup.js';
import { pushBackHandler, popBackHandler } from '/static/scripts/back.js';

// --- Prompt Mode Management ---

/**
 * Enters prompt mode: dims the background and prepares for the prompt UI.
 * @param {object} [options={}] - Options for entering prompt mode.
 * @param {boolean} [options.dim=true] - Whether to apply the dimming effect.
 */
function _enterPromptMode(options = {}) {
    const { dim = true } = options;
    document.body.classList.add('prompt-active', 'prompt-overlay-active');
    if (!dim) {
        document.body.classList.add('prompt-no-dim');
    }
    document.documentElement.classList.add('prompt-overlay-active');

    // Hide any active tutorials when a prompt appears
    try {
        import('/static/scripts/tutorial.js').then(m => m.hideTutorial());
    } catch (_) {}
}

/**
 * Exits prompt mode: restores the background and cleans up body classes.
 */
function _exitPromptMode() {
    document.body.classList.remove('prompt-active', 'prompt-overlay-active', 'prompt-no-dim');
    document.documentElement.classList.remove('prompt-overlay-active');
}


let isPrompting = false;
let promptStack = [];
let activePromptStack = []; // Track prompts that are currently "underneath" the active one
let currentResolve = null; 
let debounceTimer;
let currentPromptConfig = {};
let embeddedCheckoutRef = null; // Track active Stripe Embedded Checkout

document.addEventListener('DOMContentLoaded', () => {
});

function _debounce(func, delay) {
    return function(...args) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(this, args), delay);
    };
}

// Safely decode possible HTML entities then allow only specific simple tags
function _decodeHtmlEntities(str) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = str;
    return textarea.value;
}

function _sanitizeAllowedInlineHtml(html) {
    const container = document.createElement('div');
    container.innerHTML = html;
    // Remove all tags except span
    const all = container.querySelectorAll('*');
    all.forEach(el => {
        if (el.tagName.toLowerCase() !== 'span') {
            el.replaceWith(document.createTextNode(el.textContent));
        } else {
            // Whitelist only style color on span
            const color = el.style && el.style.color ? el.style.color : '';
            el.removeAttribute('style');
            if (color) el.style.color = color;
        }
    });
    return container.innerHTML;
}

// REMOVED handleDomainPurchase 

async function _handleDomainAvailabilityCheck(domainName, inputElement, priceDisplay, buttonWrapper, resolve) {
    console.log(`[Domain Check] Checking availability for: ${domainName}`);
    const user = getUser();
    if (!user || !user.token) {
        console.error("[Domain Check] User not authenticated.");
        return;
    }

    inputElement.classList.remove('prompt-input-available', 'prompt-input-unavailable', 'prompt-input-checking');
    priceDisplay.style.display = 'none';
    priceDisplay.style.color = '';
    const existingPurchaseButton = buttonWrapper.querySelector('.prompt-purchase-button');
    if (existingPurchaseButton) existingPurchaseButton.remove();

    if (!domainName) {
        return;
    }

    inputElement.classList.add('prompt-input-checking');

    try {
        const apiResult = await apiCheckDomainAvailability({ domainName, token: user.token });
        if (!apiResult.ok) throw new Error(apiResult.error || `Server returned ${apiResult.status}`);

        const result = apiResult.result;
        console.log("[Domain Check] Received result:", result);

        if (result.availability === 'AVAILABLE') {
            inputElement.classList.add('prompt-input-available');

            // Privacy logic removed. We now just show the purchase button.
            const purchaseButton = document.createElement('button');
            purchaseButton.textContent = `$${result.price} / year`;
            purchaseButton.className = 'prompt-button prompt-purchase-button';
            purchaseButton.onclick = () => {
                // Shadow Confirmation: We don't call prompt() here because it would push a new back handler
                // and trigger the stack restoration logic, which causes "ghosting" on back.
                // Instead, we just swap the content of the current prompt locally.
                const promptContentWrapper = inputElement.closest('.prompt-content-wrapper');
                if (!promptContentWrapper) return;

                const originalContent = promptContentWrapper.innerHTML;
                
                // 1. Clear and show "Are you sure?" locally
                promptContentWrapper.innerHTML = `
                    <p class="prompt-text">Are you sure you want to purchase ${domainName}?</p>
                    <div class="prompt-options-container">
                        <button class="prompt-option-button shadow-confirm-yes">yes</button>
                        <button class="prompt-option-button shadow-confirm-no">no</button>
                    </div>
                `;

                // 2. Handle "Yes" -> Resolve the parent prompt immediately
                promptContentWrapper.querySelector('.shadow-confirm-yes').onclick = () => {
                    if (resolve) {
                        resolve({ 
                            status: 'answered', 
                            value: { domainName, price: result.price } 
                        });
                    }
                };

                // 3. Handle "No" -> Restore the original domain input UI
                promptContentWrapper.querySelector('.shadow-confirm-no').onclick = () => {
                    promptContentWrapper.innerHTML = '';
                    // Re-render the original prompt text
                    const promptTextElement = document.createElement('p');
                    promptTextElement.innerHTML = "Enter the domain name you'd like to use (e.g., example.com):";
                    promptTextElement.className = 'prompt-text';
                    promptContentWrapper.appendChild(promptTextElement);
                    
                    // Re-create the domain input UI
                    _createDomainInput(promptContentWrapper, { id: 'domain_name_input' }, resolve);
                    
                    // Restore the value if possible
                    const newInput = promptContentWrapper.querySelector('.prompt-input-text');
                    if (newInput) {
                        newInput.value = domainName;
                        // Trigger a check immediately to show the purchase button again
                        _handleDomainAvailabilityCheck(domainName, newInput, 
                            promptContentWrapper.querySelector('.prompt-price'), 
                            promptContentWrapper.querySelector('#prompt-button-wrapper'), 
                            resolve);
                    }
                };
            };
            buttonWrapper.appendChild(purchaseButton);
        } else {
            inputElement.classList.add('prompt-input-unavailable');
            priceDisplay.textContent = result.availability === 'INVALID' ? 'nope' : 'unavailable';
            priceDisplay.style.color = '#e53935';
            priceDisplay.style.display = 'block';
        }
    } catch (error) {
        console.error("[Domain Check] Error:", error);
        inputElement.classList.add('prompt-input-unavailable');
        priceDisplay.style.display = 'none';
    } finally {
        inputElement.classList.remove('prompt-input-checking');
    }
}

/**
 * Cleans up the prompt UI, hiding the prompt and showing the console.
 */
function _cleanupPromptUI() {
    // If there are more prompts waiting or an active prompt stack to restore, 
    // do not tear down the UI to avoid flashing.
    // However, if we are in the middle of clearing the stack, we should proceed.
    if ((promptStack.length > 0 || activePromptStack.length > 0) && !window.__clearingPromptStack) {
        return;
    }

    // Destroy Stripe instance if it exists
    if (embeddedCheckoutRef && typeof embeddedCheckoutRef.destroy === 'function') {
        console.log('[Prompt] Destroying Stripe Embedded Checkout instance.');
        embeddedCheckoutRef.destroy();
    }
    embeddedCheckoutRef = null;

    const promptContainer = document.getElementById('prompt-container');
    if (promptContainer) {
        // Remove resize listeners if attached
        try {
            if (promptContainer.__updateHeightHandler) {
                window.removeEventListener('resize', promptContainer.__updateHeightHandler);
                if (window.visualViewport && promptContainer.__vvHandlerAttached) {
                    window.visualViewport.removeEventListener('resize', promptContainer.__updateHeightHandler);
                    window.visualViewport.removeEventListener('scroll', promptContainer.__updateHeightHandler);
                }
                delete promptContainer.__updateHeightHandler;
                delete promptContainer.__vvHandlerAttached;
            }
        } catch (_) {}
        promptContainer.remove();
    }
    
    _exitPromptMode();
    isPrompting = false; 
    currentResolve = null;
    currentPromptConfig = {};
}

/**
 * Forcefully cancels an active prompt and cleans up the UI.
 */
function _cancelCurrentPrompt() {
    // When a prompt is cancelled, we must also clear any pending re-auth action
    // that might have triggered it. This prevents unexpected actions later.
    clearPendingReauthAction();

    if (isPrompting && currentResolve) {
        console.log("[Prompt] Forcefully cancelling active prompt.");
        const resolve = currentResolve;
        currentResolve = null; // Prevent double resolution
        resolve({ status: 'canceled', value: null });
    } else {
        _cleanupPromptUI();
    }
}

export function clearPromptStack() {
    console.log('[Prompt] Clearing prompt stack.');
    window.__clearingPromptStack = true;
    try {
        // Resolve all waiting prompts as cancelled. 
        // This will trigger their .then() blocks in _processStack, 
        // which handles popBackHandler() and _cleanupPromptUI().
        promptStack.forEach(item => {
            if (item.resolve) {
                item.resolve({ status: 'canceled', value: null });
            }
        });
        promptStack = [];
        
        // Resolve all active prompts underneath as cancelled.
        // These are prompts that were interrupted by a newer prompt.
        activePromptStack.forEach(item => {
            if (item.resolve) {
                item.resolve({ status: 'canceled', value: null });
            }
        });
        activePromptStack = [];

        // Force a final UI cleanup
        _cleanupPromptUI();
    } finally {
        window.__clearingPromptStack = false;
    }
}

export function prompt(promptConfig) {
    return new Promise(resolve => {
        // The Ballet: A prompt pushes its back handler exactly ONCE when it is created.
        // This handler remains on the stack even if the prompt is interrupted by a sub-prompt.
        if (!promptConfig.noBackHandler) {
            pushBackHandler(() => {
                console.log(`[Prompt] Back handler fired for '${promptConfig.id || 'unnamed'}'`);
                console.log(`Prompt '${promptConfig.id || 'unnamed'}' cancelled via back button`);
                _cancelCurrentPrompt();
            });
        }

        promptStack.push({ config: promptConfig, resolve });
        _processStack();
    });
}

function _processStack() {
    if (promptStack.length === 0) {
        return;
    }

    isPrompting = true;

    // If there's an existing prompt being shown, push it to the activePromptStack
    if (currentResolve && currentPromptConfig) {
        activePromptStack.push({ config: currentPromptConfig, resolve: currentResolve });
    }

    const { config, resolve } = promptStack.pop();
    currentResolve = resolve;
    currentPromptConfig = config;

    _showActualPrompt(config).then(result => {
        console.log(`[Prompt] _showActualPrompt resolved for '${config.id || 'unnamed'}' with status: ${result.status}`);
        // The Ballet: If the user clicked a button (answered), we pop the handler.
        // If they hit 'Back' (canceled), back.js already popped it, so we skip.
        if (result.status === 'answered' && config && !config.noBackHandler) {
            console.log(`[Prompt] Popping handler for answered prompt '${config.id || 'unnamed'}'`);
            popBackHandler();
        }

        isPrompting = false;
        resolve(result);

        // If we are clearing the stack, stop here.
        if (window.__clearingPromptStack) {
            return;
        }

        // If we have an active prompt stack, restore the previous prompt
        if (activePromptStack.length > 0) {
            const previous = activePromptStack.pop();
            // Re-push to promptStack so _processStack picks it up
            promptStack.push(previous);
        }
        
        // ONLY cleanup if there is nothing left to process
        if (promptStack.length === 0) {
            _cleanupPromptUI();
        } else {
            setTimeout(_processStack, 0);
        }
    });
}


function _createDomainInput(container, promptConfig, resolve) {
    const { context } = promptConfig;
            const inputContainer = document.createElement('div');
                inputContainer.className = 'prompt-input-container';

            const inputElement = document.createElement('input');
            inputElement.type = 'text';
            inputElement.className = 'prompt-input-text';
    inputElement.id = `prompt-input-domain_registration`;
            inputContainer.appendChild(inputElement);

                const rightSideContainer = document.createElement('div');
                rightSideContainer.className = 'prompt-input-right';
                inputContainer.appendChild(rightSideContainer);

                const priceDisplay = document.createElement('div');
                priceDisplay.id = 'prompt-price-display';
                priceDisplay.className = 'prompt-price';
                priceDisplay.style.display = 'none';
                rightSideContainer.appendChild(priceDisplay);

                const buttonWrapper = document.createElement('div');
                buttonWrapper.id = 'prompt-button-wrapper';
                rightSideContainer.appendChild(buttonWrapper);

    const debouncedCheck = _debounce((domain) => {
        _handleDomainAvailabilityCheck(domain, inputElement, priceDisplay, buttonWrapper, resolve);
    }, 500);

    inputElement.addEventListener('input', () => debouncedCheck(inputElement.value));
    
    container.appendChild(inputContainer);
    setTimeout(() => inputElement.focus(), 0);
}

function _handleEmbeddedCheckoutPrompt(promptContentWrapper, promptConfig, resolve) {
            const container = document.createElement('div');
            container.id = 'embedded-checkout-container';
            container.className = 'embedded-checkout-container';
            if (promptContentWrapper && promptContentWrapper.style) {
                promptContentWrapper.style.background = '#fff';
                promptContentWrapper.style.color = '#000';
                promptContentWrapper.style.borderRadius = '10px';
            }
            container.style.background = '#fff';
            container.style.color = '#000';
            container.style.padding = '12px';
            container.style.borderRadius = '8px';
            container.style.width = '100%';
            container.style.minHeight = '60vh';
            container.style.height = '';
            container.style.maxHeight = 'none';
            container.style.overflowY = 'visible';
            container.style.flex = '0 0 auto';
            promptContentWrapper.appendChild(container);

            (async () => {
                try {
                    try { document.body.classList.add('prompt-no-dim'); } catch (_) {}
                    if (!window.Stripe) {
                        console.error('Stripe.js not loaded.');
                        return;
                    }
                    const user = getUser();
            if (!user || !user.token) throw new Error('Not authenticated');

                    let clientSecret = promptConfig.client_secret;
                    if (!clientSecret) {
                        const resp = await fetchWithAuth(`${API_BASE_URL}/create-checkout-session`, {
                            method: 'POST',
                            body: { embedded: true }
                        });
                        const data = await resp.json();
                        if (!resp.ok || !data.client_secret) throw new Error(data.error || 'Unable to start checkout');
                        clientSecret = data.client_secret;
                    }

                    const cfgResp = await fetch(`${API_BASE_URL}/stripe-config`);
                    if (!cfgResp.ok) throw new Error('Unable to load payment configuration');
                    const cfg = await cfgResp.json();
                    const publishableKey = cfg && cfg.stripePublishableKey;
                    if (!publishableKey) throw new Error('Missing Stripe publishable key');

                    const stripeInstance = window.Stripe(publishableKey);

                    if (embeddedCheckoutRef && typeof embeddedCheckoutRef.destroy === 'function') {
                        embeddedCheckoutRef.destroy();
                    }

                    const checkout = await stripeInstance.initEmbeddedCheckout({ 
                        clientSecret,
                        onComplete: () => {
                            console.log('[Stripe] Checkout completed successfully (onComplete).');
                            // Resolve immediately to let the caller (subscription.js) proceed
                            if (resolve) {
                                resolve({ status: 'answered', value: 'completed' });
                            }
                        }
                    });
                    embeddedCheckoutRef = checkout;
                    checkout.mount('#embedded-checkout-container');

                    const applyIframeStyles = () => {
                        const iframe = container.querySelector('iframe');
                        if (iframe) {
                            iframe.style.width = '100%';
                            iframe.style.height = '';
                            iframe.style.minHeight = '';
                            iframe.style.border = '0';
                            try { iframe.style.touchAction = 'manipulation'; } catch (_) {}
                            try { iframe.style.webkitOverflowScrolling = 'touch'; } catch (_) {}
                        }
                    };
                    applyIframeStyles();
                    const checkoutObserver = new MutationObserver(applyIframeStyles);
                    checkoutObserver.observe(container, { childList: true, subtree: true });

                    const observer = new MutationObserver(() => {
                        const mounted = document.getElementById('embedded-checkout-container');
                        if (!mounted) {
                            observer.disconnect();
                            // If the container was removed but we didn't resolve via onComplete,
                            // it's a cancellation.
                            if (resolve) resolve({ status: 'canceled', value: null });
                        }
                    });
                    observer.observe(container, { childList: true });

                } catch (err) {
                    console.error('Embedded checkout error:', err);
                    if (resolve) resolve({ status: 'canceled', value: null });
                        if (embeddedCheckoutRef && typeof embeddedCheckoutRef.destroy === 'function') {
                            embeddedCheckoutRef.destroy();
                        }
                    embeddedCheckoutRef = null;
                    try { document.body.classList.remove('prompt-no-dim'); } catch (_) {}
                }
            })();
        }

function _handleDomainPrompt(promptContentWrapper, promptConfig, resolve) {
    _createDomainInput(promptContentWrapper, promptConfig, resolve);
}

function _handleFormPrompt(promptContentWrapper, promptConfig, resolve) {
    const form = document.createElement('form');
    form.className = 'prompt-form';

    const validationRules = [];

    // Helper to render a single item/block
    const renderItem = (item, container) => {
        if (item.type === 'row') {
            const row = document.createElement('div');
            row.className = 'prompt-form-row';
            (item.items || []).forEach(subItem => renderItem(subItem, row));
            container.appendChild(row);
            return;
        }

        const itemContainer = document.createElement('div');
        itemContainer.className = 'prompt-form-item';

        if (item.label) {
            const label = document.createElement('label');
            label.textContent = item.label;
            label.htmlFor = `prompt-input-${item.id}`;
            itemContainer.appendChild(label);
        }

        if (item.type === 'select') {
            const select = document.createElement('select');
            select.id = `prompt-input-${item.id}`;
            select.name = item.id;
            if (item.width) {
                itemContainer.style.flex = '0 0 auto';
                itemContainer.style.width = item.width;
            }
            (item.options || []).forEach(opt => {
                const option = document.createElement('option');
                option.value = typeof opt === 'object' ? opt.value : opt;
                option.textContent = typeof opt === 'object' ? opt.label : opt;
                select.appendChild(option);
            });
            itemContainer.appendChild(select);
        } else if (item.type === 'text' || !item.type) {
            const input = document.createElement('input');
            input.type = 'text';
            input.id = `prompt-input-${item.id}`;
            input.name = item.id;
            input.className = 'prompt-input-text';
            if (item.placeholder) input.placeholder = item.placeholder;
            if (item.value) input.value = item.value;
            if (item.width) {
                itemContainer.style.flex = '0 0 auto';
                itemContainer.style.width = item.width;
            }
            itemContainer.appendChild(input);

            // Validation logic
            if (item.validationRegex) {
                const errorElement = document.createElement('div');
                errorElement.className = 'prompt-validation-error';
                errorElement.style.display = 'none';
                errorElement.style.color = '#e53935';
                errorElement.style.fontSize = '0.8em';
                errorElement.style.marginTop = '4px';
                errorElement.textContent = item.validationError || 'Invalid input.';
                itemContainer.appendChild(errorElement);

                const validate = () => {
                    const regex = new RegExp(item.validationRegex);
                    const isValid = regex.test(input.value);
                    if (isValid || !input.value) {
                        errorElement.style.display = 'none';
                        input.classList.remove('prompt-input-unavailable');
                        return true;
                    } else {
                        errorElement.style.display = 'block';
                        input.classList.add('prompt-input-unavailable');
                        return false;
                    }
                };

                input.addEventListener('input', validate);
                validationRules.push({ input, validate });
            }
        } else if (item.type === 'header') {
            const header = document.createElement('p');
            header.className = 'prompt-text';
            header.innerHTML = item.text;
            itemContainer.appendChild(header);
        } else if (item.type === 'record') {
            const record = document.createElement('div');
            record.className = 'record'; // Use shared record styling
            record.innerHTML = item.text;

            if (item.value !== undefined) {
                record.classList.add('actionable');
                record.onclick = () => {
                    resolve({ status: 'answered', value: item.value });
                };
            }

            itemContainer.appendChild(record);
        }

        container.appendChild(itemContainer);
    };

    // Render all top-level items
    (promptConfig.items || []).forEach(item => renderItem(item, form));

    // Render buttons/actions
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'prompt-options-container';
    
    const renderButton = (buttonConfig, container) => {
        if (buttonConfig.type === 'row') {
            const row = document.createElement('div');
            row.className = 'prompt-form-row';
            (buttonConfig.items || []).forEach(subItem => renderButton(subItem, row));
            container.appendChild(row);
            return;
        }

        const button = document.createElement('button');
        button.textContent = buttonConfig.label;
        button.className = 'prompt-option-button';
        if (buttonConfig.isSubmit) {
            button.type = 'submit';
        } else {
            button.type = 'button';
            button.onclick = () => resolve({ status: 'answered', value: buttonConfig.value });
        }
        container.appendChild(button);
    };

    (promptConfig.buttons || []).forEach(buttonConfig => renderButton(buttonConfig, buttonContainer));
    form.appendChild(buttonContainer);

    form.onsubmit = (e) => {
        e.preventDefault();

        // Run all validations
        let allValid = true;
        let firstInvalid = null;
        validationRules.forEach(rule => {
            if (!rule.validate()) {
                allValid = false;
                if (!firstInvalid) firstInvalid = rule.input;
            }
        });

        if (!allValid) {
            if (firstInvalid) firstInvalid.focus();
            return;
        }

        const formData = new FormData(form);
        const values = Object.fromEntries(formData.entries());
        resolve({ status: 'answered', value: values });
    };

    promptContentWrapper.appendChild(form);

    // Auto-focus the first input if it exists
    setTimeout(() => {
        const firstInput = form.querySelector('input, select');
        if (firstInput) firstInput.focus();
    }, 0);
}

const promptHandlers = {
    'embedded_checkout': _handleEmbeddedCheckoutPrompt,
    'domain': _handleDomainPrompt,
    'form': _handleFormPrompt,
};

function _showActualPrompt(promptConfig) {
    const { type } = promptConfig;
    // For embedded checkout, we enter prompt mode but without the dimming overlay.
    _enterPromptMode({ dim: type !== 'embedded_checkout' });

    // Recompute header height CSS var on open to avoid first-load mismatch
    try {
        const header = document.getElementById('header-container');
        if (header) {
            const h = header.getBoundingClientRect().height || 0;
            document.documentElement.style.setProperty('--header-height', `${Math.ceil(h)}px`);
        }
    } catch (_) {}
    
    return new Promise(resolve => {
        currentResolve = resolve;

        const { id, text, type, options, defaultValue, inputStatus, context, imageUrl } = promptConfig;

        // Ensure a single overlay container exists without relying on a host wrapper
        let promptContainer = document.getElementById('prompt-container');
        if (!promptContainer) {
            promptContainer = document.createElement('div');
            promptContainer.id = 'prompt-container';
            document.body.appendChild(promptContainer);
        } else {
            // Clear previous contents
            promptContainer.innerHTML = '';
        }

        // Add class for styling based on type
        if (type === 'embedded_checkout') {
            promptContainer.classList.add('prompt-container--subscription');
        } else {
            promptContainer.classList.add('prompt-container--regular');
        }

        const promptContentWrapper = document.createElement('div');
        promptContentWrapper.className = 'prompt-content-wrapper';
        if (type === 'embedded_checkout') {
            promptContentWrapper.classList.add('prompt-content-wrapper--subscription');
        } else {
            promptContentWrapper.classList.add('prompt-content-wrapper--regular');
        }
        promptContainer.appendChild(promptContentWrapper);

        const promptTextElement = document.createElement('p');
        promptTextElement.innerHTML = text; // Use innerHTML to render the link
        promptTextElement.className = 'prompt-text'; // Add class for styling
        promptContentWrapper.appendChild(promptTextElement);

        if (imageUrl) {
            const imageElement = document.createElement('img');
            imageElement.src = imageUrl;
            imageElement.className = 'prompt-image';
            imageElement.style.maxWidth = '100%';
            imageElement.style.maxHeight = '200px';
            imageElement.style.margin = '10px 0';
            imageElement.style.objectFit = 'contain';
            promptContentWrapper.appendChild(imageElement);
        }

        try {
            const handler = promptHandlers[type];
            if (handler) {
                handler(promptContentWrapper, promptConfig, resolve);
            }
        } catch (error) {
            console.error("Error setting up prompt UI:", error);
            resolve({ status: 'canceled', value: null });
        }
    });
}
