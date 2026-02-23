// website/src/static/scripts/what.js
import { prompt } from '/static/pages/prompt.js';
import { TextScramble } from '/static/scripts/utils.js';

const adjectives = [
    'best', 'most transparent', 'sickest', 'cat friendliest', 
    'most open source', 'least stupid', 'least extortion', 
    'coolest', 'cheapest', 'most scalable'
];

export async function showWhatPrompt() {
    const promptText = `
        <div style="text-align: left; max-width: 500px; margin: auto; max-height: 50vh; overflow-y: auto; padding-right: 15px;">
            <p><b>The <span id="adjective-scramble"></span> hosting service on the planet.</b></p>
            <p>We enable our customers to own their infrastructure and their websites.</p>
            <p>This means:</p>
            <h3>Ultimate Freedom</h3>
            <ul>
                <li>Cancel and your site stays working</li>
                <li>Easily download your site and move to another platform</li>
                <li>Access & manage via Google Cloud Platform!</li>
            </ul>
            <h3>Technically superior</h3>
            <ul>
                <li>Transparent infrastructure<br><small>(See everything!)</small></li>
                <li>Built using Enterprise Grade tools and configurations</li>
                <li>Maximally affordable<br><small>(Pay per compute cycle)</small></li>
            </ul>
            <h3>Easy to use</h3>
            <ul>
                <li>Automatic Backups to Google Drive</li>
                <li>No need to use a terminal<br><small>(But you can if you want!)</small></li>
                <li>24 hour customer support<br><small>(Call or text!)</small></li>
            </ul>
        </div>
    `;

    const promptPromise = prompt({
        id: 'what-is-this-prompt',
        text: promptText,
        type: 'options',
        options: [{ label: 'OK', value: 'ok' }]
    });

    // Wait a tick for the prompt to render to the DOM
    await new Promise(resolve => setTimeout(resolve, 0));

    const scrambleEl = document.getElementById('adjective-scramble');
    if (scrambleEl) {
        const scramble = new TextScramble(scrambleEl, {
            idleScramble: {
                probability: 0.7, // 70% chance to have an idle scramble
                maxInstances: 1,
                interval: 2500, // Max delay for an idle scramble to start (must be < cycle interval)
            }
        });
        const animationControl = scramble.cycle(adjectives, 3000);

        // Clean up the interval when the prompt is closed
        promptPromise.finally(() => {
            animationControl.stop();
        });
    }

    await promptPromise;
}

