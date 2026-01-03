import { fetchWithAuth, API_BASE_URL } from '/static/main.js';
import { getUser } from '/static/scripts/authenticate.js';
import { purchaseDomain as apiPurchaseDomain, checkDomainAvailability as apiCheckDomainAvailability } from '/static/scripts/domains.js';
import { openPopup } from '/static/scripts/popup.js';

// --- Prompt Mode Management ---

/**
 * Enters prompt mode: dims the background and prepares for the prompt UI.
 * @param {object} [options={}] - Options for entering prompt mode.
 * @param {boolean} [options.dim=true] - Whether to apply the dimming effect.
 */
function enterPromptMode(options = {}) {
    const { dim = true } = options;
    document.body.classList.add('prompt-active', 'prompt-overlay-active');
    if (!dim) {
        document.body.classList.add('prompt-no-dim');
    }
    document.documentElement.classList.add('prompt-overlay-active');
}

/**
 * Exits prompt mode: restores the background and cleans up body classes.
 */
function exitPromptMode() {
    document.body.classList.remove('prompt-active', 'prompt-overlay-active', 'prompt-no-dim');
    document.documentElement.classList.remove('prompt-overlay-active');
}


let isPrompting = false;
let promptStack = [];
let currentResolve = null; // No longer exported
let debounceTimer;
let currentPromptConfig = {};
let embeddedCheckoutRef = null; // Track active Stripe Embedded Checkout

document.addEventListener('DOMContentLoaded', () => {
});

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

async function handleDomainPurchase(domainName, price, projectId, privacy, domainPromptResolver, phoneNumber = null) {
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
            phoneNumber // This will be null on the first call.
        });

        if (apiResult.ok) {
            console.log("[Domain Purchase] Success:", apiResult.result);
            domainPromptResolver({ status: 'answered', value: domainName });
            return;
        }

        if (apiResult.status === 428 && apiResult.error === 'phone_number_required') {
            console.log("[Domain Purchase] Phone number required. Prompting user.");
            // This part is the first time we ask for the number.
            const promptResult = await prompt({
                id: 'phone_number_prompt',
                text: 'A phone number is required for domain registration. Please enter it below.',
                type: 'phone',
                required: true
            });

            if (promptResult.status === 'answered' && promptResult.value) {
                // Here we recurse with the phone number.
                return handleDomainPurchase(domainName, price, projectId, privacy, domainPromptResolver, promptResult.value);
            } else {
                // User cancelled the very first phone prompt.
                domainPromptResolver({ status: 'canceled', value: null });
                return;
            }
        }

        // Any other error from the API call.
        throw new Error(apiResult.error || `Server returned ${apiResult.status}`);

    } catch (error) {
        console.error("[Domain Purchase] Error:", error);

        // PRIORITIZE THIS CHECK: If the failure happened after a phone number was submitted,
        // assume the phone number might be the issue and re-prompt.
        if (phoneNumber) { // phoneNumber is now an object { countryCode, number }
            const retryPrompt = await prompt({
                id: 'phone_number_prompt_retry',
                text: `An error occurred: ${error.message}. Please check your phone number and try again.`,
                type: 'phone',
                required: true,
                defaultValue: phoneNumber // Pass the object as the default value
            });

            if (retryPrompt.status === 'answered' && retryPrompt.value) {
                // User entered a new number, recurse again.
                return handleDomainPurchase(domainName, price, projectId, privacy, domainPromptResolver, retryPrompt.value);
            } else {
                // User cancelled the retry prompt.
                domainPromptResolver({ status: 'canceled', value: null });
                return;
            }
        }

        // If the error is a re-auth signal on the FIRST attempt, let the auth wrapper handle it.
        if (error.message === 'ReauthInitiated') {
            console.log("[Domain Purchase] Re-authentication initiated. Halting purchase flow.");
            // Don't resolve the original prompt; the page will be redirected for re-auth.
            return;
        }

        // The error occurred on the initial attempt, before a phone number was even requested.
        // This is a non-phone-related error. Just show it and cancel.
        await prompt({
            id: 'domain_purchase_generic_error',
            text: `An unexpected error occurred: ${error.message}`,
            type: 'options',
            options: ['OK']
        });
        domainPromptResolver({ status: 'canceled', value: null });
        return;
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
                purchaseButton.onclick = async () => {
                    const confirmation = await prompt({
                        id: 'domain_purchase_confirm',
                        text: `Are you sure you want to purchase ${domainName}?`,
                        type: 'options',
                        options: [
                            { label: 'yes', value: true },
                            { label: 'no', value: false }
                        ]
                    });

                    if (confirmation && confirmation.status === 'answered' && confirmation.value === true) {
                        // Pop the original domain prompt from the stack to prevent it from re-rendering,
                        // then pass its resolver to the purchase handler.
                        const originalDomainPrompt = promptStack.pop();
                        if (originalDomainPrompt && originalDomainPrompt.resolve) {
                            handleDomainPurchase(domainName, result.price, projectId, bestPrivacyOption, originalDomainPrompt.resolve);
                        } else {
                            console.error("Could not find original domain prompt to resolve.");
                        }
                    }
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
function cleanupPromptUI() {
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
    exitPromptMode();
    // The calling function is now responsible for restoring header state.
    isPrompting = false; // Reset state
    currentResolve = null; // Reset resolver
}

/**
 * Forcefully cancels an active prompt and cleans up the UI.
 */
export function cancelCurrentPrompt() {
    if (isPrompting && currentResolve) {
        console.log("[Prompt] Forcefully cancelling active prompt.");
        currentResolve({ status: 'canceled', value: null });
        // The promise resolving will trigger cleanup via the .finally() block in prompt()
    } else {
        // If no prompt is active, just ensure the UI is clean.
        cleanupPromptUI();
    }
}

export function clearPromptStack() {
    console.log('[Prompt] Clearing prompt stack.');
    promptStack = [];
}

export function prompt(promptConfig) {
    return new Promise(resolve => {
        promptStack.push({ config: promptConfig, resolve });
        processStack();
    });
}

function processStack() {
    if (promptStack.length === 0) {
        return;
    }

    if (isPrompting) {
        // A prompt is currently visible. We need to interrupt it, show the new one,
        // and re-show the current one later.

        // 1. Stash the current (interrupted) prompt's info.
        const interruptedPrompt = { config: currentPromptConfig, resolve: currentResolve };

        // 2. The new prompt to show is at the end of the stack. The interrupted
        //    prompt should go back on the stack before it.
        const newPromptToShow = promptStack.pop();
        promptStack.push(interruptedPrompt);
        promptStack.push(newPromptToShow);

        // 3. Clean up the current UI *without* resolving the promise. This is a manual
        //    version of cleanupPromptUI that avoids touching the promise.
        const promptContainer = document.getElementById('prompt-container');
        if (promptContainer) {
            promptContainer.remove();
        }
        exitPromptMode();
        
        // 4. Reset state to allow the stack processor to run again from the top.
        isPrompting = false;
        currentResolve = null;
        currentPromptConfig = {};

        // 5. Defer the next processing step to allow the call stack to unwind.
        setTimeout(processStack, 0);
        return;
    }

    isPrompting = true;

    const { config, resolve } = promptStack.pop();

    _showActualPrompt(config).then(result => {
        resolve(result);
        isPrompting = false;
        setTimeout(processStack, 0);
    });
}


function _createDomainInput(container, promptConfig) {
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

    const debouncedCheck = debounce((domain) => {
        handleDomainAvailabilityCheck(domain, inputElement, priceDisplay, buttonWrapper, context.project_id);
    }, 500);

    inputElement.addEventListener('input', () => debouncedCheck(inputElement.value));
    
    container.appendChild(inputContainer);
    setTimeout(() => inputElement.focus(), 0);
}

function _handleTextPrompt(promptContentWrapper, promptConfig) {
    const { id, defaultValue, inputStatus, context, validationRegex, validationError, validateOnSubmit, showContinueButton } = promptConfig;

    if (id === 'domain_name_input') {
        _createDomainInput(promptContentWrapper, promptConfig);
        return;
    }

    const inputContainer = document.createElement('div');
    if (showContinueButton) {
        inputContainer.className = 'prompt-input-container';
    }

    const inputElement = document.createElement('input');
    inputElement.type = 'text';
    inputElement.className = 'prompt-input-text';
    inputElement.id = `prompt-input-${id}`;
    if (defaultValue) inputElement.value = defaultValue;
    if (inputStatus) inputElement.classList.add(`prompt-input-${inputStatus}`);
    inputContainer.appendChild(inputElement);
    
    const errorElement = document.createElement('div');
    errorElement.className = 'prompt-validation-error';
    errorElement.style.display = 'none';
    errorElement.style.color = '#e53935';
    errorElement.style.fontSize = '0.9em';
    errorElement.style.marginTop = '4px';

    const validateInput = () => {
        if (validationRegex && inputElement.value) {
            const regex = new RegExp(validationRegex);
            if (!regex.test(inputElement.value)) {
                errorElement.textContent = validationError || 'Invalid input.';
                errorElement.style.display = 'block';
                inputElement.classList.add('prompt-input-unavailable');
                return false;
            }
        }
        errorElement.style.display = 'none';
        inputElement.classList.remove('prompt-input-unavailable');
        return true;
    };

    if (showContinueButton) {
        const rightSideContainer = document.createElement('div');
        rightSideContainer.className = 'prompt-input-right';
        inputContainer.appendChild(rightSideContainer);

        const buttonWrapper = document.createElement('div');
        buttonWrapper.id = 'prompt-button-wrapper';
        rightSideContainer.appendChild(buttonWrapper);

        inputContainer.classList.add('prompt-input-container--stacked');
        rightSideContainer.classList.add('prompt-input-right--stacked');

        const continueBtn = document.createElement('button');
        continueBtn.textContent = 'continue';
        continueBtn.className = 'prompt-button';

        if (id === 'common_deployment_name') {
            // Special sanitization logic for deployment names
            continueBtn.onclick = () => {
                const raw = String(inputElement.value || '');
                const sanitized = raw
                    .toLowerCase()
                    .replace(/[\s_]+/g, '-')
                    .replace(/[^a-z0-9-]/g, '')
                    .replace(/-+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    .slice(0, 63);

                if (!sanitized) {
                    const promptTextEl = document.querySelector('.prompt-wrapper .prompt-text');
                    if (promptTextEl && !promptTextEl.dataset.prefixedInvalid) {
                        promptTextEl.textContent = `The previous entry was invalid. ${promptTextEl.textContent}`;
                        promptTextEl.dataset.prefixedInvalid = 'true';
                    }
                    inputElement.focus();
                    return;
                }

                if (currentResolve) {
                    currentResolve({ status: 'answered', value: raw });
                }
            };
        } else {
            // Generic validation logic for other prompts
            if (validationRegex && !validateOnSubmit) {
                inputElement.addEventListener('input', validateInput);
            }
            continueBtn.onclick = () => {
                if (validateInput()) {
                    if (currentResolve) {
                        currentResolve({ status: 'answered', value: inputElement.value });
                    }
                }
            };
        }
        
        buttonWrapper.appendChild(continueBtn);

        inputElement.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                continueBtn.click();
            }
        });
    } else {
        if (validationRegex && !validateOnSubmit) {
            inputElement.addEventListener('input', validateInput);
        }
        inputElement.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && currentResolve) {
                if (!validationRegex || validateInput()) {
                    currentResolve({ status: 'answered', value: inputElement.value });
                }
            }
        });
    }

    promptContentWrapper.appendChild(inputContainer);
    promptContentWrapper.appendChild(errorElement);
    setTimeout(() => inputElement.focus(), 0);
}

function _handlePhonePrompt(promptContentWrapper, promptConfig) {
    const { id, defaultValue } = promptConfig;

    const inputContainer = document.createElement('div');
    inputContainer.className = 'prompt-input-container';
    inputContainer.style.display = 'flex';
    inputContainer.style.alignItems = 'center';
    inputContainer.style.gap = '8px';

    const plusSign = document.createElement('span');
    plusSign.textContent = '+';
    plusSign.style.fontSize = '1.2em';

    const countryCodeInput = document.createElement('input');
    countryCodeInput.type = 'text';
    countryCodeInput.className = 'prompt-input-text';
    countryCodeInput.placeholder = '1';
    countryCodeInput.style.maxWidth = '100px';
    countryCodeInput.style.flex = '0 1 auto';

    const numberInput = document.createElement('input');
    numberInput.type = 'text';
    numberInput.className = 'prompt-input-text';
    numberInput.placeholder = '1234567890';
    numberInput.style.flex = '1 1 auto';

    if (defaultValue && typeof defaultValue === 'object') {
        countryCodeInput.value = defaultValue.countryCode || '';
        numberInput.value = defaultValue.number || '';
    } else if (typeof defaultValue === 'string') {
        // Fallback for old string format, though this should be phased out.
        const match = String(defaultValue).match(/^\+(\d{1,3})(.*)$/);
        if (match) {
            countryCodeInput.value = match[1];
            numberInput.value = match[2].replace(/\D/g, '');
        }
    }

    const resolvePhone = () => {
        const countryCode = countryCodeInput.value.replace(/\D/g, '');
        const number = numberInput.value.replace(/\D/g, '');

        if (countryCode && number) {
            if (currentResolve) {
                // Resolve with an object instead of a combined string
                currentResolve({ status: 'answered', value: { countryCode, number } });
            }
        } else {
            const promptContainer = document.getElementById('prompt-container');
            const promptTextEl = promptContainer.querySelector('.prompt-text');
            if (promptTextEl && !promptTextEl.dataset.prefixedInvalid) {
                promptTextEl.innerHTML = `<span style="color: #e53935;">Please enter a valid country code and phone number.</span><br>${promptTextEl.innerHTML}`;
                promptTextEl.dataset.prefixedInvalid = 'true';
            }
            if (!countryCode) {
                countryCodeInput.focus();
            } else {
                numberInput.focus();
            }
        }
    };

    inputContainer.appendChild(plusSign);
    inputContainer.appendChild(countryCodeInput);
    inputContainer.appendChild(numberInput);
    promptContentWrapper.appendChild(inputContainer);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'prompt-options-container';
    buttonContainer.style.marginTop = '20px';

    const continueBtn = document.createElement('button');
    continueBtn.textContent = 'Continue';
    continueBtn.className = 'prompt-option-button';
    continueBtn.onclick = resolvePhone;
    buttonContainer.appendChild(continueBtn);
    promptContentWrapper.appendChild(buttonContainer);

    const handleKeydown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            resolvePhone();
        }
    };
    countryCodeInput.addEventListener('keydown', handleKeydown);
    numberInput.addEventListener('keydown', handleKeydown);

    setTimeout(() => countryCodeInput.focus(), 0);
}

function _handleOptionsPrompt(promptContentWrapper, promptConfig) {
    const { options } = promptConfig;
    if (!options || options.length === 0) return;

            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'prompt-options-container';
            options.forEach(option => {
                const optionButton = document.createElement('button');
                const text = typeof option === 'object' ? option.label : option;
                const value = typeof option === 'object' ? option.value : option;
                const decoded = decodeHtmlEntities(String(text ?? ''));
                const sanitized = sanitizeAllowedInlineHtml(decoded);
                optionButton.innerHTML = sanitized;
                optionButton.className = 'prompt-option-button';
                optionButton.onclick = () => currentResolve({ status: 'answered', value: value });
                optionsContainer.appendChild(optionButton);
            });
            promptContentWrapper.appendChild(optionsContainer);
}

function _handleEmbeddedCheckoutPrompt(promptContentWrapper, promptConfig) {
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

            const checkout = await stripeInstance.initEmbeddedCheckout({ clientSecret });
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
                        if (!mounted || mounted.children.length === 0) {
                            observer.disconnect();
                                if (embeddedCheckoutRef && typeof embeddedCheckoutRef.destroy === 'function') {
                                    embeddedCheckoutRef.destroy();
                                }
                            embeddedCheckoutRef = null;
                            if (currentResolve) currentResolve({ status: 'answered', value: 'completed' });
                        }
                    });
                    observer.observe(container, { childList: true });
                } catch (err) {
                    console.error('Embedded checkout error:', err);
                    if (currentResolve) currentResolve({ status: 'canceled', value: null });
                        if (embeddedCheckoutRef && typeof embeddedCheckoutRef.destroy === 'function') {
                            embeddedCheckoutRef.destroy();
                        }
                    embeddedCheckoutRef = null;
                    try { document.body.classList.remove('prompt-no-dim'); } catch (_) {}
                }
            })();
        }

function _handleDomainPrompt(promptContentWrapper, promptConfig) {
    _createDomainInput(promptContentWrapper, promptConfig);
}

function _handleSelectPrompt(promptContentWrapper, promptConfig) {
            const selectContainer = document.createElement('div');
            selectContainer.className = 'prompt-select-container';
            
            promptConfig.items.forEach(item => {
                const p = document.createElement('p');
                p.textContent = item.text;
                p.className = 'prompt-select-option';
                p.onclick = () => {
                    if (currentResolve) {
                        currentResolve({ status: 'answered', value: item.id });
                    }
                };
                selectContainer.appendChild(p);
            });
            promptContentWrapper.appendChild(selectContainer);
}

function _handleFormPrompt(promptContentWrapper, promptConfig) {
            const form = document.createElement('form');
            form.className = 'prompt-form';
            promptConfig.items.forEach(item => {
                const itemContainer = document.createElement('div');
                itemContainer.className = 'prompt-form-item';

                const label = document.createElement('label');
                label.textContent = item.label;
                label.htmlFor = `prompt-input-${item.id}`;
                itemContainer.appendChild(label);

                if (item.type === 'select') {
                    const select = document.createElement('select');
                    select.id = `prompt-input-${item.id}`;
                    select.name = item.id;
                    item.options.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        select.appendChild(option);
                    });
                    itemContainer.appendChild(select);
                }
                form.appendChild(itemContainer);
            });

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'prompt-options-container';
            (promptConfig.buttons || []).forEach(buttonConfig => {
                const button = document.createElement('button');
                button.textContent = buttonConfig.label;
                button.className = 'prompt-option-button';
                if (buttonConfig.isSubmit) {
                    button.type = 'submit';
                } else {
                    button.type = 'button';
                    button.onclick = () => currentResolve({ status: 'answered', value: buttonConfig.value });
                }
                buttonContainer.appendChild(button);
            });
            form.appendChild(buttonContainer);

            form.onsubmit = (e) => {
                e.preventDefault();
                const formData = new FormData(form);
                const values = Object.fromEntries(formData.entries());
                currentResolve({ status: 'answered', value: values });
            };

            promptContentWrapper.appendChild(form);
}

const promptHandlers = {
    'text': _handleTextPrompt,
    'phone': _handlePhonePrompt,
    'options': _handleOptionsPrompt,
    'embedded_checkout': _handleEmbeddedCheckoutPrompt,
    'domain': _handleDomainPrompt,
    'select': _handleSelectPrompt,
    'form': _handleFormPrompt,
};

function _showActualPrompt(promptConfig) {
    const { type } = promptConfig;
    // For embedded checkout, we enter prompt mode but without the dimming overlay.
    enterPromptMode({ dim: type !== 'embedded_checkout' });

    // Recompute header height CSS var on open to avoid first-load mismatch
    try {
        const header = document.getElementById('header-container');
        if (header) {
            const h = header.getBoundingClientRect().height || 0;
            document.documentElement.style.setProperty('--header-height', `${Math.ceil(h)}px`);
        }
    } catch (_) {}
    const promise = new Promise(resolve => {
        currentResolve = resolve;
        currentPromptConfig = promptConfig; // Store current config

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

        const handler = promptHandlers[type];
        if (handler) {
            handler(promptContentWrapper, promptConfig);
        }
    });

    // Automatically clean up the UI once the promise is settled (resolved or rejected).
    promise.finally(() => {
        cleanupPromptUI();
    });

    return promise;
}
