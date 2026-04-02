import { applyWaveEffect } from '/js/main.js';

/**
 * Injects the "claim free membership" button into the landing page.
 * @param {object} cookieData - The data from the secret cookie.
 */
export function showClaimMembershipButton(cookieData) {
    const landingContainer = document.getElementById('landing-view-container');
    if (!landingContainer) return;

    // Check if button already exists
    if (document.getElementById('claim-membership-button')) return;

    const claimButton = document.createElement('div');
    claimButton.id = 'claim-membership-button';
    claimButton.className = 'landing-option';
    claimButton.textContent = 'claim free membership';
    claimButton.style.opacity = '0'; // Start hidden for effect
    claimButton.style.whiteSpace = 'nowrap'; // Prevent text wrapping

    claimButton.onclick = async () => {
        console.log("Claiming free membership...");
        
        try {
            const { handleSubscribe } = await import('/js/menus/subscription.js');
            const { loadConsoleView } = await import('/js/main.js');
            const { requireAuth } = await import('/js/scripts/authenticate.js');

            // Wrap the subscription call in requireAuth to handle guest users
            const guardedClaim = requireAuth(async (params) => {
                const result = await handleSubscribe(params);

                // If result is provided, it's the session object from the already_active check
                if (result && result.already_active) {
                    const { prompt } = await import('/js/pages/prompt.js');
                    await prompt({
                        id: 'already-subscribed-prompt',
                        text: 'You are already subscribed.',
                        type: 'form',
                        buttons: [{ label: 'ok', value: 'ok' }]
                    });
                    // Stay on landing page if already active
                } else if (result && result.error) {
                    const { prompt } = await import('/js/pages/prompt.js');
                    await prompt({
                        id: 'checkout-error-prompt',
                        text: result.error,
                        type: 'form',
                        buttons: [{ label: 'ok', value: 'ok' }]
                    });
                } else if (result && (result.resumed || result.status === 'completed')) {
                    console.log("Membership claim checkout finished successfully.");
                    // loadConsoleView(); // REMOVED: Stay on landing page after successful claim
                }
            }, 'claim membership');

            await guardedClaim({ 
                promoCode: cookieData.code,
                // Fallback navigation if cancelled
                renderMenu: (menuId) => {
                    if (menuId === 'dashboard-menu') {
                        loadConsoleView();
                    }
                }
            });
        } catch (error) {
            if (error.message === 'UserCancelled') {
                console.log("Membership claim cancelled by user.");
                return;
            }
            console.error("Failed to claim free membership:", error);
        }
    };

    // Append the button directly to the landing container
    landingContainer.appendChild(claimButton);

    // Create and append the countdown timer directly to the landing container
    const timerElement = document.createElement('div');
    timerElement.id = 'membership-countdown-timer';
    timerElement.style.position = 'absolute';
    timerElement.style.whiteSpace = 'nowrap';
    timerElement.style.fontSize = '0.8em';
    timerElement.style.color = '#aaa';
    timerElement.style.fontFamily = 'monospace';
    timerElement.style.pointerEvents = 'none'; // Ensure it doesn't block clicks
    landingContainer.appendChild(timerElement);

    const positionTimer = () => {
        const btnRect = claimButton.getBoundingClientRect();
        // Position relative to the viewport, adjusted for scroll
        timerElement.style.left = `${Math.round(btnRect.right + 10)}px`;
        timerElement.style.top = `${Math.round(btnRect.top + window.scrollY + (btnRect.height / 2))}px`;
        timerElement.style.transform = 'translateY(-50%)';
    };

    let timerInterval;
    const updateTimer = () => {
        const now = new Date();
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        
        const diff = midnight - now;
        if (diff <= 0) {
            if (timerInterval) clearInterval(timerInterval);
            
            // Remove the button and timer
            if (claimButton.parentNode) claimButton.parentNode.removeChild(claimButton);
            if (timerElement.parentNode) timerElement.parentNode.removeChild(timerElement);
            
            // Clean up listeners
            window.removeEventListener('resize', positionTimer);
            window.removeEventListener('landinglayoutchange', positionTimer);
            
            // Notify other modules to reposition
            window.dispatchEvent(new CustomEvent('landinglayoutchange'));
            return;
        }

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        timerElement.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);

    // Initial positioning and update on resize/layout change
    positionTimer();
    window.addEventListener('resize', positionTimer);
    window.addEventListener('landinglayoutchange', positionTimer);

    // Apply wave effect to the newly created button
    applyWaveEffect(claimButton);

    // Notify other modules that the layout has changed (e.g., to reposition cat/tagline)
    window.dispatchEvent(new CustomEvent('landinglayoutchange'));

    // Cleanup interval and listeners if needed
    claimButton._timerInterval = timerInterval;
    claimButton._positionTimer = positionTimer;
}
