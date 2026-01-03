/**
 * Finds all elements with the 'rainbow-text' class and wraps each letter
 * in a span to create a staggered animation effect.
 */
export function initializeRainbowText() {
    const rainbowElements = document.querySelectorAll('.rainbow-text');
    rainbowElements.forEach(el => {
        // Prevent re-initializing the same element
        if (el.dataset.rainbowInitialized) return;
        el.dataset.rainbowInitialized = 'true';

        const text = el.textContent;
        el.innerHTML = ''; // Clear original text
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const span = document.createElement('span');
            span.textContent = char;
            // Add a staggered delay, cycling every 2 seconds to match the animation
            span.style.animationDelay = `${(i * 0.1) % 2}s`;
            el.appendChild(span);
        }
        // Fade the text in now that it's styled
        el.style.opacity = '1';
    });
}

