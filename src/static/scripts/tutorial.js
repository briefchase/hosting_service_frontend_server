// website/src/static/scripts/tutorial.js
import { isTouchDevice } from '/static/scripts/utils.js';

let activeTutorials = [];
let tutorialTimer = null;

function positionElement(tutorialContainer, anchorElement, position) {
    if (!anchorElement) return;
    const rect = anchorElement.getBoundingClientRect();
    
    let top, left, transform;

    if (position === 'above') {
        top = rect.top + window.scrollY + (rect.height / 2);
        left = rect.left + window.scrollX + (rect.width / 2);
        transform = 'translate(-50%, -100%) translateY(-40px)';
    } else if (position === 'continue-offset') {
        top = rect.top + window.scrollY + (rect.height / 2) - 45;
        left = rect.left + window.scrollX + (rect.width / 2) + 60;
        transform = 'translate(-50%, -50%) rotate(10deg)';
    } else {
        top = rect.top + window.scrollY + (rect.height / 2);
        left = rect.right + window.scrollX;
        transform = 'translate(10px, -50%)';
    }
    
    tutorialContainer.style.top = `${top}px`;
    tutorialContainer.style.left = `${left}px`;
    tutorialContainer.style.transform = transform;
}

function createAndShowTutorial(text, anchorSelector, position = 'top-right') {
    const anchorElement = document.querySelector(anchorSelector);
    if (!anchorElement) return null;

    const tutorialContainer = document.createElement('div');
    tutorialContainer.className = 'tutorial-container';

    const tutorialContent = document.createElement('div');
    tutorialContent.className = 'tutorial-text';
    tutorialContent.textContent = text;
    
    tutorialContainer.appendChild(tutorialContent);
    document.body.appendChild(tutorialContainer);
    
    const tutorial = { el: tutorialContainer, anchor: anchorElement, position: position };
    activeTutorials.push(tutorial);

    positionElement(tutorial.el, tutorial.anchor, tutorial.position);
    
    setTimeout(() => tutorial.el.classList.add('visible'), 50);

    return tutorial;
}

function showTutorial() {
    hideTutorial(); // Clear any existing tutorials

    const explanationText = isTouchDevice() 
        ? 'press and hold for explination' 
        : 'hover for explination';

    createAndShowTutorial('click for brainrot', '#mode-toggle-container', 'above');
    createAndShowTutorial(explanationText, '#console-button', 'continue-offset');
    
    window.addEventListener('resize', handleResize);
}

export function planToShowTutorial(delay) {
    cancelPlannedTutorial(); // Cancel any existing plan
    tutorialTimer = setTimeout(showTutorial, delay);
}

export function cancelPlannedTutorial() {
    if (tutorialTimer) {
        clearTimeout(tutorialTimer);
        tutorialTimer = null;
    }
}

export function hideTutorial() {
    cancelPlannedTutorial(); // Also cancel any pending timers
    activeTutorials.forEach(({ el }) => {
        el.remove();
    });
    activeTutorials = [];
    window.removeEventListener('resize', handleResize);
}

function handleResize() {
    activeTutorials.forEach(({ el, anchor, position }) => {
        positionElement(el, anchor, position);
    });
}
