import { refreshHeaderButtonsForCurrentMenu } from '/static/pages/menu.js';
import { enterPromptOverlay, exitPromptOverlay, fetchWithAuth, API_BASE_URL, registerBackButtonHandler, unregisterBackButtonHandler } from '/static/main.js';
import { getUser } from '/static/scripts/authenticate.js';
import { purchaseDomain as apiPurchaseDomain, checkDomainAvailability as apiCheckDomainAvailability } from '/static/scripts/domains.js';

let isPrompting = false;
export let currentResolve = null; // Export to allow external resolution
let promptHostContainer = null; // Optional legacy host; not required
let debounceTimer;
let currentPromptConfig = {};
let embeddedCheckoutRef = null; // Track active Stripe Embedded Checkout

document.addEventListener('DOMContentLoaded', () => {
    promptHostContainer = document.getElementById('prompt-host-container');
});

function hidePromptUI() {
    if (promptHostContainer) {
        try { promptHostContainer.classList.remove('visible'); } catch (_) {}
    }
}

function debounce(func, delay) {
    return function(...args) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(this, args), delay);
    };
}

// Safely decode possible HTML entities then allow only specific simple tags
function decodeHtmlEntities(str) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = str;
    return textarea.value;
}

function sanitizeAllowedInlineHtml(html) {
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

async function handleDomainPurchase(domainName, price, projectId, privacy, phoneNumber = null) {
    console.log(`[Domain Purchase] Attempting to purchase ${domainName} for $${price} in project ${projectId} with privacy ${privacy}`);
    const user = getUser();
    if (!user || !user.token) {
        console.error("[Domain Purchase] User not authenticated.");
        return;
    }

    try {
        const apiResult = await apiPurchaseDomain({
            domainName,
            price,
            projectId,
            privacy,
            token: user.token,
            phoneNumber
        });

        if (apiResult.ok) {
            console.log("[Domain Purchase] Success:", apiResult.result);
            if (currentResolve) {
                currentResolve({ status: 'answered', value: domainName });
            }
            return;
        }

        if (apiResult.status === 428 && apiResult.error === 'phone_number_required') {
            console.log("[Domain Purchase] Phone number required. Prompting user.");

            if (currentPromptConfig && typeof currentPromptConfig.onPhoneSuccess === 'function') {
                const phonePromptResult = await prompt({
                    id: 'phone_number_prompt_for_callback',
                    text: 'A phone number is required for domain registration. Please enter it in E.164 format (e.g., +11234567890).',
                    type: 'text',
                    required: true
                });

                if (phonePromptResult.status === 'answered' && phonePromptResult.value) {
                    console.log("[Phone Prompt] Success. Calling onPhoneSuccess callback.");
                    currentPromptConfig.onPhoneSuccess();
                } else {
                    console.log("[Domain Purchase] User canceled phone number prompt.");
                    cleanupPromptUI();
                }
            } else {
                const promptResult = await prompt({
                    id: 'phone_number_prompt',
                    text: 'A phone number is required for domain registration. Please enter it in E.164 format (e.g., +11234567890).',
                    type: 'text',
                    required: true
                });

                if (promptResult.status === 'answered' && promptResult.value) {
                    return handleDomainPurchase(domainName, price, projectId, privacy, promptResult.value);
                }
            }
            return;
        }

        throw new Error(apiResult.error || `Server returned ${apiResult.status}`);
    } catch (error) {
        console.error("[Domain Purchase] Error:", error);
    }
}

async function handleDomainAvailabilityCheck(domainName, inputElement, priceDisplay, buttonWrapper, projectId) {
    console.log(`[Domain Check] Checking availability for: ${domainName} in project ${projectId}`);
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

        if (result.status === 'available') {
            inputElement.classList.add('prompt-input-available');

            let bestPrivacyOption = null;
            if (result.supportedPrivacy.includes('PRIVATE_CONTACT_DATA')) {
                bestPrivacyOption = 'PRIVATE_CONTACT_DATA';
            } else if (result.supportedPrivacy.includes('REDACTED_CONTACT_DATA')) {
                bestPrivacyOption = 'REDACTED_CONTACT_DATA';
            }

            if (bestPrivacyOption) {
                const purchaseButton = document.createElement('button');
                purchaseButton.textContent = `$${result.price} / year`;
                purchaseButton.className = 'prompt-button prompt-purchase-button';
                purchaseButton.onclick = () => {
                    handleDomainPurchase(domainName, result.price, projectId, bestPrivacyOption);
                };
                buttonWrapper.appendChild(purchaseButton);
            } else {
                priceDisplay.textContent = 'Privacy not supported';
                priceDisplay.style.display = 'block';
            }
        } else {
            inputElement.classList.add('prompt-input-unavailable');
            priceDisplay.textContent = 'unavailable';
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
export function cleanupPromptUI() {
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
    hidePromptUI();
    // Remove only the overlay state; header/title visibility managed by deploy flow
    exitPromptOverlay();
    try { unregisterBackButtonHandler('prompt'); } catch (_) {}
    // Destroy embedded checkout instance if active
    try {
        if (embeddedCheckoutRef && typeof embeddedCheckoutRef.destroy === 'function') {
            embeddedCheckoutRef.destroy();
        }
    } catch (_) {}
    embeddedCheckoutRef = null;
    // Remove no-dim class if set for embedded checkout
    try { document.body.classList.remove('prompt-no-dim'); } catch (_) {}
    // Remove overlay class marker (handled by exitPromptOverlay)
    // After closing prompt, re-assert header button state for current menu
    try { refreshHeaderButtonsForCurrentMenu(); } catch (_) {}
    isPrompting = false; // Reset state
}

/**
 * Forcefully cancels an active prompt and cleans up the UI.
 */
export function cleanupPrompts() {
    if (isPrompting && currentResolve) {
        console.log("[Prompt] Forcefully cleaning up prompts.");
        currentResolve({ status: 'canceled', value: null });
        currentResolve = null;
    }
    cleanupPromptUI();
}

export function prompt(promptConfig, onCancel = null) {
    // Enable overlay to hide content while a prompt is visible
    enterPromptOverlay();
    // Ensure body carries the overlay class for CSS pseudo-element selectors (handled by enterPromptOverlay)
    // Recompute header height CSS var on open to avoid first-load mismatch
    try {
        const header = document.getElementById('header-container');
        if (header) {
            const h = header.getBoundingClientRect().height || 0;
            document.documentElement.style.setProperty('--header-height', `${Math.ceil(h)}px`);
        }
    } catch (_) {}
    return new Promise(resolve => {
        if (isPrompting) {
            // Prevent multiple prompts from stacking
            try { resolve({ status: 'canceled', value: null }); } catch(_) {}
            return;
        }
        isPrompting = true;
        currentResolve = resolve;
        currentPromptConfig = promptConfig; // Store current config

        const { id, text, type, options, cancelable = false, required = false, clean = true, defaultValue, inputStatus, context } = promptConfig;

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
        // Ensure overlay styles apply even before class changes propagate
        // Force fixed, header-aware sizing and internal scrolling
        try {
            const applyPromptContainerLayout = () => {
            const header = document.getElementById('header-container');
            const headerH = Math.ceil((header && header.getBoundingClientRect().height) || 56);
                const viewportH = Math.ceil((window.visualViewport && window.visualViewport.height) || window.innerHeight || 0);
                const heightPx = Math.max(0, viewportH - headerH);
            promptContainer.style.position = 'fixed';
            promptContainer.style.top = `${headerH}px`;
            promptContainer.style.left = '0';
            promptContainer.style.right = '0';
                // Add 1px to account for rounding differences that can prevent reaching top
                const adjustedH = heightPx + 1;
                promptContainer.style.height = `${adjustedH}px`;
                promptContainer.style.maxHeight = `${adjustedH}px`;
            promptContainer.style.overflowY = 'auto';
            promptContainer.style.overflowX = 'hidden';
            promptContainer.style.padding = '0 20px 20px 20px';
            promptContainer.style.boxSizing = 'border-box';
            promptContainer.style.display = 'flex';
            promptContainer.style.flexDirection = 'column';
            };
            applyPromptContainerLayout();
            const resizeHandler = () => applyPromptContainerLayout();
            promptContainer.__updateHeightHandler = resizeHandler;
            window.addEventListener('resize', resizeHandler, { passive: true });
            if (window.visualViewport && !promptContainer.__vvHandlerAttached) {
                window.visualViewport.addEventListener('resize', resizeHandler, { passive: true });
                window.visualViewport.addEventListener('scroll', resizeHandler, { passive: true });
                promptContainer.__vvHandlerAttached = true;
            }
        } catch (_) {}
        const promptWrapper = document.createElement('div');
        promptWrapper.className = 'prompt-wrapper';
        promptContainer.appendChild(promptWrapper);

        // Register a back-button handler that cancels and cleans up this prompt
        try {
            const backHandler = () => {
                if (currentResolve) {
                    try { currentResolve({ status: 'canceled', value: null }); } catch(_) {}
                    currentResolve = null;
                }
                cleanupPromptUI();
            };
            registerBackButtonHandler('prompt', backHandler);
        } catch (_) {}

        const promptTextElement = document.createElement('p');
        promptTextElement.innerHTML = text; // Use innerHTML to render the link
        promptTextElement.className = 'prompt-text'; // Add class for styling
        promptWrapper.appendChild(promptTextElement);

        if (type === 'text') {

            const inputContainer = document.createElement('div');
            if (id === 'domain_name_input') {
                inputContainer.className = 'prompt-input-container';
            }

            const inputElement = document.createElement('input');
            inputElement.type = 'text';
            inputElement.className = 'prompt-input-text';
            inputElement.id = `prompt-input-${id}`;
            if (defaultValue) inputElement.value = defaultValue;
            if (inputStatus) inputElement.classList.add(`prompt-input-${inputStatus}`);
            inputContainer.appendChild(inputElement);


            if (id === 'domain_name_input' || id === 'common_deployment_name') {
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
                
                if (id === 'common_deployment_name') {
                    // Add a Continue button and block Enter submission (no live normalization)
                    // Stack button below input and center it
                    inputContainer.classList.add('prompt-input-container--stacked');
                    rightSideContainer.classList.add('prompt-input-right--stacked');

                    const continueBtn = document.createElement('button');
                    continueBtn.textContent = 'continue';
                    continueBtn.className = 'prompt-button';
                    continueBtn.onclick = () => {
                        // Validate by simulating backend sanitation (lowercase, spaces/underscores -> hyphens, strip specials)
                        const raw = String(inputElement.value || '');
                        const sanitized = raw
                            .toLowerCase()
                            .replace(/[\s_]+/g, '-')
                            .replace(/[^a-z0-9-]/g, '')
                            .replace(/-+/g, '-')
                            .replace(/^-+|-+$/g, '')
                            .slice(0, 63);

                        if (!sanitized) {
                            // Prefix prompt text with invalid notice and keep prompting
                            const promptTextEl = document.querySelector('.prompt-wrapper .prompt-text');
                            if (promptTextEl && !promptTextEl.dataset.prefixedInvalid) {
                                promptTextEl.textContent = `The previous entry was invalid. ${promptTextEl.textContent}`;
                                promptTextEl.dataset.prefixedInvalid = 'true';
                            }
                            inputElement.focus();
                            return;
                        }

                        if (currentResolve) {
                            // Submit original value; backend will perform final sanitation
                            currentResolve({ status: 'answered', value: raw });
                        }
                    };
                    buttonWrapper.appendChild(continueBtn);

                    inputElement.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            // Do nothing on Enter for deployment name
                        }
                    });
                } else {
                    const debouncedCheck = debounce((domain) => {
                        handleDomainAvailabilityCheck(domain, inputElement, priceDisplay, buttonWrapper, context.project_id);
                    }, 500);

                    inputElement.addEventListener('input', () => {
                        debouncedCheck(inputElement.value);
                    });
                }
            } else {
                // For standard text inputs, just listen for Enter.
                inputElement.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        // Check if there is a resolver and the prompt is still active
                        if (currentResolve) {
                             currentResolve({ status: 'answered', value: inputElement.value });
                        }
                    }
                });
            }

            promptWrapper.appendChild(inputContainer);
            setTimeout(() => inputElement.focus(), 0);
        } else if (type === 'options' && options && options.length > 0) {
            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'prompt-options-container';
            options.forEach(option => {
                const optionButton = document.createElement('button');
                // Handle both string and object options
                const text = typeof option === 'object' ? option.label : option;
                const value = typeof option === 'object' ? option.value : option;
                // Decode entities then sanitize to allow simple inline HTML (e.g., <span style="color:#e53935">linked</span>)
                const decoded = decodeHtmlEntities(String(text ?? ''));
                const sanitized = sanitizeAllowedInlineHtml(decoded);
                optionButton.innerHTML = sanitized;
                optionButton.className = 'prompt-option-button';
                optionButton.onclick = () => currentResolve({ status: 'answered', value: value });
                optionsContainer.appendChild(optionButton);
            });
            promptWrapper.appendChild(optionsContainer);
        } else if (type === 'embedded_checkout') {
            // Embedded Stripe Checkout inside prompt
            const container = document.createElement('div');
            container.id = 'embedded-checkout-container';
            container.className = 'embedded-checkout-container';
            // Make prompt wider for embedded checkout
            if (promptWrapper && promptWrapper.style) {
                // Fill available width/height inside host container padding
                promptWrapper.style.maxWidth = 'none';
                promptWrapper.style.width = '100%';
                promptWrapper.style.margin = '0';
                // For this prompt specifically, use white backdrop and black text
                promptWrapper.style.background = '#fff';
                promptWrapper.style.color = '#000';
                // Let outer #prompt-container handle scrolling; avoid nested scroll
                promptWrapper.style.maxHeight = 'none';
                promptWrapper.style.overflowY = 'visible';
                // No horizontal scrollbar and add black outline with rounded corners
                promptWrapper.style.overflowX = 'hidden';
                promptWrapper.style.borderRadius = '10px';
                promptWrapper.style.boxSizing = 'border-box';
                // Fill height
                promptWrapper.style.flex = '1 1 auto';
                promptWrapper.style.minHeight = '0';
            }
            // Style embed background as white and text black (iframe content remains managed by Stripe)
            container.style.background = '#fff';
            container.style.color = '#000';
            container.style.padding = '12px';
            container.style.borderRadius = '8px';
            container.style.width = '100%';
            // Let the iframe manage its own internal scrolling; provide a sensible minimum
            container.style.minHeight = '60vh';
            container.style.height = '';
            container.style.maxHeight = 'none';
            container.style.overflowY = 'visible';
            container.style.flex = '0 0 auto';
            promptWrapper.appendChild(container);

            // Mount Stripe elements using the provided client_secret
            (async () => {
                try {
                    // For subscription prompt, disable dim background
                    try { document.body.classList.add('prompt-no-dim'); } catch (_) {}

                    // Ensure Stripe is initialized globally (initializeStripe loads Stripe.js)
                    if (!window.Stripe) {
                        console.error('Stripe.js not loaded.');
                        return;
                    }

                    const user = getUser();
                    if (!user || !user.token) {
                        throw new Error('Not authenticated');
                    }

                    // Request embedded checkout client_secret if not provided
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

                    // Fetch publishable key from backend config
                    const cfgResp = await fetch(`${API_BASE_URL}/config`);
                    if (!cfgResp.ok) throw new Error('Unable to load payment configuration');
                    const cfg = await cfgResp.json();
                    const publishableKey = cfg && cfg.stripePublishableKey;
                    if (!publishableKey) throw new Error('Missing Stripe publishable key');

                    const stripeInstance = window.Stripe(publishableKey);

                    // If a previous embedded checkout exists, destroy it first
                    try {
                        if (embeddedCheckoutRef && typeof embeddedCheckoutRef.destroy === 'function') {
                            embeddedCheckoutRef.destroy();
                        }
                    } catch (_) {}

                    const checkout = await stripeInstance.initEmbeddedCheckout({
                        clientSecret
                    });
                    embeddedCheckoutRef = checkout;
                    checkout.mount('#embedded-checkout-container');

                    // Ensure the embedded iframe fills the container and keeps a black backdrop
                    const applyIframeStyles = () => {
                        const iframe = container.querySelector('iframe');
                        if (iframe) {
                            iframe.style.width = '100%';
                            // Allow Stripe to control its own scroll height
                            iframe.style.height = '';
                            iframe.style.minHeight = '';
                            iframe.style.border = '0';
                            // Ensure vertical gestures are allowed inside the iframe element
                            try { iframe.style.touchAction = 'manipulation'; } catch (_) {}
                            try { iframe.style.webkitOverflowScrolling = 'touch'; } catch (_) {}
                            // The iframe content background can't be styled cross-origin,
                            // but the container remains black around it.
                        }
                    };
                    applyIframeStyles();
                    const checkoutObserver = new MutationObserver(applyIframeStyles);
                    checkoutObserver.observe(container, { childList: true, subtree: true });

                    // Resolve when checkout completes via redirect back or closure is detected
                    // Stripe Embedded Checkout will redirect to return_url when done. We can poll for unmount.
                    const observer = new MutationObserver(() => {
                        const mounted = document.getElementById('embedded-checkout-container');
                        if (!mounted || mounted.children.length === 0) {
                            observer.disconnect();
                            try {
                                if (embeddedCheckoutRef && typeof embeddedCheckoutRef.destroy === 'function') {
                                    embeddedCheckoutRef.destroy();
                                }
                            } catch(_) {}
                            embeddedCheckoutRef = null;
                            if (currentResolve) currentResolve({ status: 'answered', value: 'completed' });
                        }
                    });
                    observer.observe(container, { childList: true });
                } catch (err) {
                    console.error('Embedded checkout error:', err);
                    if (currentResolve) currentResolve({ status: 'canceled', value: null });
                    try {
                        if (embeddedCheckoutRef && typeof embeddedCheckoutRef.destroy === 'function') {
                            embeddedCheckoutRef.destroy();
                        }
                    } catch(_) {}
                    embeddedCheckoutRef = null;
                    try { document.body.classList.remove('prompt-no-dim'); } catch (_) {}
                }
            })();
        }

        if (type === 'domain') {
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

            const debouncedCheck = debounce((domain) => {
                handleDomainAvailabilityCheck(domain, inputElement, priceDisplay, buttonWrapper, context.project_id);
            }, 500);

            inputElement.addEventListener('input', () => debouncedCheck(inputElement.value));
            
            promptWrapper.appendChild(inputContainer);
        }

        if (type === 'select') {
            const selectContainer = document.createElement('div');
            selectContainer.className = 'prompt-select-container';
            
            promptConfig.items.forEach(item => {
                const p = document.createElement('p');
                p.textContent = item.text;
                p.className = 'prompt-select-option';
                p.onclick = () => {
                    if (currentResolve) {
                        currentResolve({ status: 'answered', value: item.id });
                        currentResolve = null;
                        if (clean) cleanupPromptUI();
                    }
                };
                selectContainer.appendChild(p);
            });
            promptWrapper.appendChild(selectContainer);
        }
    });
}
