// website/src/js/scripts/tooltip.js

let tooltipElement = null;
let tooltipTimeout = null;
let tooltipAnimationInterval = null;
let lastMouseEvent = null;

function ensureTooltipElement() {
    if (tooltipElement && document.body.contains(tooltipElement)) {
        return;
    }
    tooltipElement = document.getElementById('tooltip');
    if (!tooltipElement) {
        tooltipElement = document.createElement('div');
        tooltipElement.id = 'tooltip';
        document.body.appendChild(tooltipElement);
    }
}

/**
 * Allows other modules to update the last known mouse event, enabling shared tooltip logic.
 * @param {MouseEvent|null} event - The latest mouse event, or null to clear it.
 */
export function updateLastMouseEvent(event) {
    lastMouseEvent = event;
}

/**
 * Displays and positions the tooltip. If infoText is provided, it shows the tooltip
 * after a delay. If infoText is null, it just updates the position of the visible tooltip.
 * @param {MouseEvent} event - The mouse event.
 * @param {string|null} infoText - The text to display in the tooltip.
 * @param {boolean} isImmediate - If true, bypasses the initial 500ms show delay.
 */
export function displayAndPositionTooltip(event, infoText = null, isImmediate = false) {
    ensureTooltipElement();
    if (!tooltipElement) return;

    const positionTooltip = (e) => {
        if (tooltipElement.style.display !== 'block') return;

        const isTouchEvent = e.type.startsWith('touch');
        const pos = isTouchEvent ? e.touches[0] : e;

        if (!pos) return; // Can happen on touchend

        const tooltipHeight = tooltipElement.offsetHeight;
        const tooltipWidth = tooltipElement.offsetWidth;
        const bodyRect = document.body.getBoundingClientRect();

        let top, left;

        if (isTouchEvent) {
            // Mobile: Horizontally centered ABOVE the finger, with more offset
            top = pos.pageY - tooltipHeight - 60; // Increased offset further
            left = pos.pageX - (tooltipWidth / 2);

            // Boundary checks
            if (left < bodyRect.left + 5) left = bodyRect.left + 5;
            if (left + tooltipWidth > bodyRect.right - 5) left = bodyRect.right - tooltipWidth - 5;
            if (top < bodyRect.top + 5) top = pos.pageY + 25; // Flip below
        } else {
            // Desktop: To the right of the cursor
            const offsetX = 15;
            top = pos.pageY - (tooltipHeight / 2);
            left = pos.pageX + offsetX;

            // Boundary checks
            if (left + tooltipWidth > bodyRect.right) left = pos.pageX - tooltipWidth - offsetX;
            if (left < bodyRect.left) left = bodyRect.left + 5;
            if (top < bodyRect.top) top = bodyRect.top + 5;
            if (top + tooltipHeight > bodyRect.bottom) top = bodyRect.bottom - tooltipHeight - 5;
        }

        tooltipElement.style.left = `${left}px`;
        tooltipElement.style.top = `${top}px`;
    };

    const showAndAnimate = () => {
        const isTouchEvent = event.type.startsWith('touch');

        // Prepare the tooltip element but keep it invisible.
        tooltipElement.textContent = '';
        tooltipElement.style.display = 'block';
        tooltipElement.style.visibility = 'hidden';

        let i = 0;
        clearInterval(tooltipAnimationInterval);
        tooltipAnimationInterval = setInterval(() => {
            if (i < infoText.length) {
                tooltipElement.textContent += infoText.charAt(i);

                // Position the tooltip based on its current content width.
                const currentPositionEvent = isTouchEvent ? event : lastMouseEvent;
                if (currentPositionEvent) {
                    positionTooltip(currentPositionEvent);
                }

                // Make the tooltip visible only on the first frame, after it has content and is positioned.
                if (i === 0) {
                    tooltipElement.style.visibility = 'visible';
                }

                i++;
            } else {
                clearInterval(tooltipAnimationInterval);
            }
        }, 35);
    };

    if (infoText) { // This is a "show" request
        clearTimeout(tooltipTimeout);
        clearInterval(tooltipAnimationInterval);

        const delay = isImmediate ? 0 : 500;
        tooltipTimeout = setTimeout(showAndAnimate, delay);

    } else { // This is a "reposition" request
        positionTooltip(event);
    }
}

export function hideTooltip() {
    clearTimeout(tooltipTimeout); // Clear any pending show requests
    clearInterval(tooltipAnimationInterval); // Stop any ongoing animation
    if (tooltipElement) {
        tooltipElement.style.display = 'none';
    }
}

