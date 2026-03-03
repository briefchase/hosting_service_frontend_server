/**
 * Finds all elements with the 'rainbow-text' class and wraps each letter
 * in a span to create a staggered animation effect.
 * @param {HTMLElement} [root=document] - The root element to search within.
 */
export function initializeRainbowText(root = document) {
    const rainbowElements = root.querySelectorAll('.rainbow-text');
    rainbowElements.forEach(el => {
        applyRainbowEffect(el);
    });
}

/**
 * Applies the rainbow staggered animation effect to a single element.
 * @param {HTMLElement} el - The element to apply the effect to.
 */
export function applyRainbowEffect(el) {
    if (!el || el.dataset.rainbowInitialized) return;
    el.dataset.rainbowInitialized = 'true';

    const text = el.textContent;
    el.innerHTML = ''; // Clear original text
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const span = document.createElement('span');
        span.textContent = char;
        
        // Use a negative delay so the animation starts immediately but "jumps" 
        // to the correct point in the cycle. This keeps them staggered 
        // without the staggered start times.
        const staggerDelay = (i * 0.1) % 2;
        span.style.animationDelay = `-${staggerDelay}s`;
        
        // Pre-calculate the initial color based on the stagger delay
        // This ensures they have the right color even before the first animation frame
        const hue = (staggerDelay / 2) * 360;
        span.style.color = `hsl(${hue}, 100%, 50%)`;

        el.appendChild(span);
    }
    // Fade the text in now that it's styled
    el.style.opacity = '1';
}

/**
 * Applies a staggered wave animation effect to a single element.
 * @param {HTMLElement} el - The element to apply the effect to.
 */
export function applyWaveEffect(el) {
    if (!el || el.dataset.waveInitialized) return;
    el.dataset.waveInitialized = 'true';

    const text = el.textContent;
    el.innerHTML = ''; // Clear original text
    
    // Get a common reference time for all letters
    const startTime = performance.now() / 1000;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const span = document.createElement('span');
        span.textContent = char === ' ' ? '\u00A0' : char; // Handle spaces
        span.style.display = 'inline-block';
        
        // Calculate a negative delay based on index so they are already in motion
        // and staggered relative to each other, but all synced to the same clock.
        const staggerDelay = i * 0.1;
        span.style.animation = `wave 2s ease-in-out infinite`;
        span.style.animationDelay = `-${staggerDelay}s`;
        
        el.appendChild(span);
    }
    el.style.opacity = '1';
}

export class TextScramble {
    constructor(el, options = {}) {
        this.el = el;
        this.options = {
            idleScramble: null, // e.g., { probability: 0.5, maxInstances: 3, interval: 7000 }
            ...options
        };
        this.chars = '!<>-_\\/[]{}—=+*^?#________';
        this.update = this.update.bind(this);
        this.frameRequest = null;
        this.mainInterval = null;
        this.idleTimeouts = [];
        this.isScrambling = false;
    }

    setText(newText) {
        this.isScrambling = true;
        this.stopIdleScramble(); // Stop any idle effects before a new text scramble
        const oldText = this.el.innerText;
        const length = Math.max(oldText.length, newText.length);
        const promise = new Promise((resolve) => this.resolve = resolve).finally(() => {
            this.isScrambling = false;
        });
        this.queue = [];
        for (let i = 0; i < length; i++) {
            const from = oldText[i] || '';
            const to = newText[i] || '';
            const start = Math.floor(Math.random() * 40);
            const end = start + Math.floor(Math.random() * 40);
            this.queue.push({ from, to, start, end });
        }
        if (this.frameRequest) {
            cancelAnimationFrame(this.frameRequest);
        }
        this.frame = 0;
        this.update();
        return promise;
    }

    update() {
        let output = '';
        let complete = 0;
        for (let i = 0, n = this.queue.length; i < n; i++) {
            let { from, to, start, end, char } = this.queue[i];
            if (this.frame >= end) {
                complete++;
                output += to;
            } else if (this.frame >= start) {
                if (!char || Math.random() < 0.28) {
                    char = this.randomChar();
                    this.queue[i].char = char;
                }
                output += `<span class="dud">${char}</span>`;
            } else {
                output += from;
            }
        }
        this.el.innerHTML = output;
        if (complete === this.queue.length) {
            this.resolve();
            this.startIdleScramble(); // Start idle effects after main scramble is done
        } else {
            this.frameRequest = requestAnimationFrame(this.update);
            this.frame++;
        }
    }

    cycle(phrases, interval) {
        let currentIndex = 0;
        const nextPhrase = () => {
            this.setText(phrases[currentIndex]);
            currentIndex = (currentIndex + 1) % phrases.length;
        };

        this.stop(); // Clear any existing intervals before starting a new one
        nextPhrase();
        this.mainInterval = setInterval(nextPhrase, interval);

        // Return a stop function for cleanup
        return {
            stop: () => this.stop()
        };
    }

    stop() {
        if (this.mainInterval) {
            clearInterval(this.mainInterval);
            this.mainInterval = null;
        }
        this.stopIdleScramble();
    }

    startIdleScramble() {
        const config = this.options.idleScramble;
        if (!config || this.idleTimeouts.length > 0) return;

        const numScrambles = Math.random() < (1 - config.probability) 
            ? 0 
            : Math.floor(Math.pow(Math.random(), 2) * (config.maxInstances || 3)) + 1;

        for (let i = 0; i < numScrambles; i++) {
            const startDelay = Math.random() * (config.interval || 7000);
            const timeoutId = setTimeout(() => {
                const text = this.el.innerText;
                const len = text.length;
                if (len > 0) {
                    const position = Math.floor(Math.random() * len);
                    this.animateOneCharScramble(position);
                }
            }, startDelay);
            this.idleTimeouts.push(timeoutId);
        }
    }

    stopIdleScramble() {
        this.idleTimeouts.forEach(clearTimeout);
        this.idleTimeouts = [];
    }

    animateOneCharScramble(position) {
        if (this.isScrambling) return;

        const text = this.el.innerText;
        const originalChar = text[position];
        if (!originalChar || originalChar.trim() === '') return;

        let changesCount = 0;
        const maxChanges = Math.floor(Math.pow(Math.random(), 3) * 5) + 1;

        const changeChar = () => {
            if (this.isScrambling) {
                if (this.el.innerText[position] !== originalChar) {
                     this.el.innerText = text;
                }
                return;
            }
            if (changesCount >= maxChanges) {
                if (this.el.innerText[position] !== originalChar) {
                    this.el.innerText = text;
                }
                return;
            }

            changesCount++;
            let textArray = this.el.innerText.split('');
            textArray[position] = this.randomChar();
            this.el.innerText = textArray.join('');
            
            const delay = Math.pow(Math.random(), 5) * 999 + 1;
            setTimeout(changeChar, delay);
        };
        changeChar();
    }

    randomChar() {
        return this.chars[Math.floor(Math.random() * this.chars.length)];
    }
}

export function isTouchDevice() {
    return window.matchMedia("(pointer: coarse)").matches;
}

