import { hideConsoleContainer, showConsoleContainer } from '/static/pages/menu.js';
import { API_BASE_URL } from '/static/main.js';
import { getUser } from '/static/scripts/authenticate.js';

let isPrompting = false;
export let currentResolve = null; // Export to allow external resolution
let promptHostContainer = null;
let debounceTimer;
let currentPromptConfig = {};

document.addEventListener('DOMContentLoaded', () => {
    promptHostContainer = document.getElementById('prompt-host-container');
});

function hidePromptUI() {
    if (promptHostContainer) {
        promptHostContainer.classList.remove('visible');
    }
}

function debounce(func, delay) {
    return function(...args) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(this, args), delay);
    };
}

async function purchaseDomain(domainName, price, projectId, privacy, phoneNumber = null) {
    console.log(`[Domain Purchase] Attempting to purchase ${domainName} for $${price} in project ${projectId} with privacy ${privacy}`);
    const user = getUser();
    if (!user || !user.token) {
        console.error("[Domain Purchase] User not authenticated.");
        return;
    }

    try {
        const payload = { 
            domain: domainName,
            price: price,
            project_id: projectId,
            privacy: privacy
        };
        if (phoneNumber) {
            payload.phone_number = phoneNumber;
        }

        const response = await fetch(`${API_BASE_URL}/domains`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token}`
            },
            body: JSON.stringify(payload)
        });

        // Handle success case first
        if (response.ok) {
            const result = await response.json();
            console.log("[Domain Purchase] Success:", result);
            // If purchase is successful, resolve the main prompt promise
            if (currentResolve) {
                currentResolve({ status: 'answered', value: domainName });
            }
            return;
        }

        // --- Handle ALL error cases below ---

        const errorResult = await response.json();

        // Specifically handle the "phone number required" error
        if (response.status === 428 && errorResult.error === 'phone_number_required') {
            console.log("[Domain Purchase] Phone number required. Prompting user.");

            // If a callback for phone success exists, use it. Otherwise, retry purchase.
            if (currentPromptConfig && typeof currentPromptConfig.onPhoneSuccess === 'function') {
                 const phonePromptResult = await prompt({
                    id: 'phone_number_prompt_for_callback',
                    text: 'A phone number is required for domain registration. Please enter it in E.164 format (e.g., +11234567890).',
                    type: 'text',
                    required: true
                });

                if (phonePromptResult.status === 'answered' && phonePromptResult.value) {
                    // We don't purchase here. We just call the success handler which will
                    // typically restart the domain selection flow.
                    console.log("[Phone Prompt] Success. Calling onPhoneSuccess callback.");
                    currentPromptConfig.onPhoneSuccess();
                } else {
                     console.log("[Domain Purchase] User canceled phone number prompt.");
                    cleanupPromptUI();
                }
            } else {
                 // Fallback to old behavior if no callback is provided
                const promptResult = await prompt({
                    id: 'phone_number_prompt',
                    text: 'A phone number is required for domain registration. Please enter it in E.164 format (e.g., +11234567890).',
                    type: 'text',
                    required: true
                });

                if (promptResult.status === 'answered' && promptResult.value) {
                    // Retry the purchase with the provided phone number
                    return purchaseDomain(domainName, price, projectId, privacy, promptResult.value);
                }
            }
            return; // Exit after handling 428
        }

        // For all other errors, throw an exception
        throw new Error(errorResult.error || `Server returned ${response.status}`);

    } catch (error) {
        console.error("[Domain Purchase] Error:", error);
        // Optionally, update UI to show purchase error
    }
}


async function checkDomainAvailability(domainName, inputElement, priceDisplay, buttonWrapper, projectId) {
    console.log(`[Domain Check] Checking availability for: ${domainName} in project ${projectId}`);
    const user = getUser();
    if (!user || !user.token) {
        console.error("[Domain Check] User not authenticated.");
        return;
    }

    // Clear previous results and buttons
    inputElement.classList.remove('prompt-input-available', 'prompt-input-unavailable', 'prompt-input-checking');
    priceDisplay.style.display = 'none';
    priceDisplay.style.color = ''; // Reset color on each new check
    const existingPurchaseButton = buttonWrapper.querySelector('.prompt-purchase-button');
    if (existingPurchaseButton) existingPurchaseButton.remove();

    if (!domainName) {
        return; // Don't check if the input is empty
    }

    inputElement.classList.add('prompt-input-checking');

    try {
        const response = await fetch(`${API_BASE_URL}/check-domain-availability`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token}`
            },
            body: JSON.stringify({ domain: domainName })
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);

        const result = await response.json();
        console.log("[Domain Check] Received result:", result);

        if (result.status === 'available') {
            inputElement.classList.add('prompt-input-available');

            // Determine the best available privacy option, defaulting to null if none are private.
            let bestPrivacyOption = null;
            if (result.supportedPrivacy.includes('PRIVATE_CONTACT_DATA')) {
                bestPrivacyOption = 'PRIVATE_CONTACT_DATA';
            } else if (result.supportedPrivacy.includes('REDACTED_CONTACT_DATA')) {
                bestPrivacyOption = 'REDACTED_CONTACT_DATA';
            }

            // Only show the purchase button if a private option is available.
            if (bestPrivacyOption) {
                const purchaseButton = document.createElement('button');
                purchaseButton.textContent = `$${result.price} / year`;
                purchaseButton.className = 'prompt-button prompt-purchase-button';
                purchaseButton.onclick = () => {
                    purchaseDomain(domainName, result.price, projectId, bestPrivacyOption);
                };
                buttonWrapper.appendChild(purchaseButton);
            } else {
                // If no private option is available, inform the user.
                priceDisplay.textContent = 'Privacy not supported';
                priceDisplay.style.display = 'block';
            }

        } else {
            inputElement.classList.add('prompt-input-unavailable');
            priceDisplay.textContent = 'unavailable';
            priceDisplay.style.color = '#e53935'; // Make text red for unavailable
            priceDisplay.style.display = 'block';
        }
    } catch (error) {
        console.error("[Domain Check] Error:", error);
        inputElement.classList.add('prompt-input-unavailable');
        // Don't show an error message in the UI, just mark as unavailable.
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
        promptContainer.remove();
    }
    hidePromptUI();
    showConsoleContainer();
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
    hideConsoleContainer(); // Hide the main console
    return new Promise(resolve => {
        currentResolve = resolve;
        currentPromptConfig = promptConfig; // Store current config

        const { id, text, type, options, cancelable = false, required = false, clean = true, defaultValue, inputStatus, context } = promptConfig;

        if (promptHostContainer) {
            promptHostContainer.classList.add('visible');
            promptHostContainer.innerHTML = '<div id="prompt-container"></div>'; // Always recreate
        }

        const promptContainer = document.getElementById('prompt-container');
        const promptWrapper = document.createElement('div');
        promptWrapper.className = 'prompt-wrapper';
        promptContainer.appendChild(promptWrapper);

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


            if (id === 'domain_name_input' || type === 'domain') {
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
                    checkDomainAvailability(domain, inputElement, priceDisplay, buttonWrapper, context.project_id);
                }, 500);

                inputElement.addEventListener('input', () => {
                    debouncedCheck(inputElement.value);
                });
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
                optionButton.textContent = text;
                optionButton.className = 'prompt-option-button';
                optionButton.onclick = () => currentResolve({ status: 'answered', value: value });
                optionsContainer.appendChild(optionButton);
            });
            promptWrapper.appendChild(optionsContainer);
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
                checkDomainAvailability(domain, inputElement, priceDisplay, buttonWrapper, context.project_id);
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
