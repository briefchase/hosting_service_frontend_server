let handlerStack = [];

/**
 * Pushes a new back button handler onto the stack and updates the UI.
 * @param {function} handler - The function to call when the back button is clicked.
 */
export function pushBackHandler(handler) {
    if (typeof handler !== 'function') {
        console.error('pushBackHandler: Expected a function, got', typeof handler);
        return;
    }
    
    handlerStack.push(handler);
    console.log(`[BackStack] Pushed handler. New depth: ${handlerStack.length}`);
    _updateUI();
}

/**
 * Pops the current back button handler off the stack and updates the UI.
 */
export function popBackHandler() {
    if (handlerStack.length > 0) {
        handlerStack.pop();
    }
    _updateUI();
}

/**
 * Clears the entire handler stack and hides the back button.
 */
export function clearBackHandlers() {
    handlerStack = [];
    _updateUI();
}

/**
 * Replaces the top handler on the stack with a new one.
 * @param {function} handler - The new function to call when the back button is clicked.
 */
export function replaceBackHandler(handler) {
    if (typeof handler !== 'function') {
        console.error('replaceBackHandler: Expected a function, got', typeof handler);
        return;
    }
    
    if (handlerStack.length > 0) {
        handlerStack[handlerStack.length - 1] = handler;
        console.log(`[BackStack] Replaced top handler. Depth remains: ${handlerStack.length}`);
    } else {
        // If stack is empty, just push it
        pushBackHandler(handler);
    }
    _updateUI();
}

/**
 * Internal function to update the button's visibility based on the stack.
 */
function _updateUI() {
    const backButton = document.getElementById('back-button');
    const hdr = document.getElementById('header-container');

    if (handlerStack.length > 0) {
        if (backButton) {
            backButton.style.display = 'inline-block';
            backButton.style.visibility = 'visible';
            backButton.dataset.targetMenu = ''; // Avoid relying on old attribute
        }
        if (hdr) hdr.style.display = 'flex';
        document.body.classList.add('back-button-active');
    } else {
        if (backButton) {
            backButton.style.display = 'none';
            backButton.style.visibility = 'hidden';
            backButton.dataset.targetMenu = '';
        }
        document.body.classList.remove('back-button-active');
    }

    // Attempt to trigger collision check if available in global scope
    try {
        if (window.checkHeaderCollision) {
            window.checkHeaderCollision();
        } else {
            // Fallback to importing from menu.js if possible
            import('/static/pages/menu.js').then(m => m.checkHeaderCollision && m.checkHeaderCollision());
        }
    } catch (_) {}
}

export const executeBackHandler = (event) => {
    console.log(`[BackStack] executeBackHandler called. Stack depth: ${handlerStack.length}`);
    if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
    }
    if (handlerStack.length > 0) {
        console.log(`🔙 Executing back handler (Stack depth: ${handlerStack.length})`);
        const topHandler = handlerStack[handlerStack.length - 1];
        topHandler();
        return true;
    } else {
        console.log('🔙 Back button clicked, but stack is empty.');
        return false;
    }
};

/**
 * The actual click event handler. Executes the top of the stack.
 */
export function handleBackButtonClick(event) {
    executeBackHandler(event);
}
