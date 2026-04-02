// website/src/static/pages/editor.js

import { pushBackHandler, popBackHandler, getStack } from '/static/scripts/back.js';
import { positionMusicControls } from '/static/pages/landing.js';
import { registerHandler } from '/static/scripts/registry.js';
import { prompt, clearPromptStack } from '/static/pages/prompt.js';
import { CONFIG } from '/static/config.js';

// Global error listener to catch and log detailed React errors
window.addEventListener('error', (event) => {
    if (event.error && (event.error.stack || event.error.componentStack)) {
        console.group("%c[React Crash Detected]", "color: white; background: red; padding: 4px; font-weight: bold;");
        console.error("Message:", event.error.message);
        console.error("Stack:", event.error.stack);
        if (event.error.componentStack) {
            console.error("Component Stack:", event.error.componentStack);
        }
        console.groupEnd();
    }
});

const EDITOR_HTML = `
<div id="editor-container" class="terminal-container">
    <div id="gjs" style="height: 100%; width: 100%;"></div>
</div>
`;

let editorRoot = null;

/**
 * Loads the GrapesJS Studio SDK bundle.
 */
async function ensureSdkLoaded() {
    if (window.mountStudioEditor) return;

    console.log("[Editor] Loading SDK bundle...");
    
    const loadStyles = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/static/pages/sdk.bundle.css';
        link.onload = resolve;
        link.onerror = () => reject(new Error("Failed to load SDK styles."));
        document.head.appendChild(link);
    });

    const loadScript = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/static/pages/sdk.bundle.js';
        script.type = 'text/javascript';
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load SDK script."));
        document.head.appendChild(script);
    });

    await Promise.all([loadStyles, loadScript]);
    console.log("[Editor] SDK bundle loaded successfully.");
}

export async function loadEditorView(params = {}) {
    console.log("[Editor] loadEditorView called", params);
    const { site_id, deployment_name } = params;

    document.body.classList.add('editor-view-active');
    document.body.classList.add('overlay-active');
    
    positionMusicControls();

    const editorBackButtonHandler = async () => {
        const result = await prompt({
            text: "Are you sure you want to exit? Unsaved changes will be lost.",
            type: 'form',
            buttons: [
                { label: 'yes', value: true },
                { label: 'no', value: false }
            ],
            hideBackButton: true,
            id: 'editor_exit_confirm'
        });

        if (result && result.status === 'answered' && result.value === true) {
            clearPromptStack();
            returnFromEditor({ menuId: `site-details-menu-${deployment_name}` });
        } else {
            pushBackHandler(editorBackButtonHandler);
        }
    };

    pushBackHandler(editorBackButtonHandler);

    const consoleContainer = document.getElementById('console-container');
    if (!consoleContainer) {
        console.error("Console container not found.");
        return;
    }

    const { clearConsoleContent } = await import('/static/main.js');
    clearConsoleContent();
    
    consoleContainer.insertAdjacentHTML('beforeend', EDITOR_HTML);

    try {
        // Ensure the heavy SDK bundle is loaded before initializing
        await ensureSdkLoaded();
        
        const licenseKey = CONFIG.GRAPESJS_STUDIO_LICENSE;
        const container = document.getElementById('gjs');

        console.log("[Editor] Initializing Studio Editor via React Component...");

        // Use the React-based renderer provided by the bundle
        editorRoot = window.mountStudioEditor(container, {
            licenseKey: licenseKey,
            height: '100%',
            width: 'auto',
            
            layout: window.layoutSidebarButtons.createLayoutConfig({
                sidebarButtons: ({ sidebarButtons, createSidebarButton }) => [
                    ...sidebarButtons,
                    createSidebarButton({
                        id: 'aiChatPanel',
                        tooltip: 'AI Assistant',
                        icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8V4H8m-4 4h16v12H4V8zm-2 6h2m16 0h2m-7-1v2m-6-2v2\"/></svg>`, 
                        layoutCommand: { header: false },
                        layoutComponent: { type: 'aiChatPanel' }
                    })
                ]
            }),

            plugins: [
                window.layoutSidebarButtons.init({ skipLayoutConfig: true }),
                window.aiChat.init({
                    headline: 'AI Assistant',
                    getAccessToken: async () => {
                        const res = await fetch('/ai/get-token', { 
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${JSON.parse(sessionStorage.getItem('currentUser')).token}`
                            }
                        });
                        const result = await res.json();
                        return result.token; // The Platform API returns { token: "..." }
                    },
                    chatOptions: {
                        onFinish: async (result) => {
                            console.log("[AI Chat] Finished:", result);
                            if (result.usage) {
                                fetch('/ai/log-usage', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${JSON.parse(sessionStorage.getItem('currentUser')).token}`
                                    },
                                    body: JSON.stringify({ usage: result.usage })
                                }).catch(err => console.error("[AI Chat] Usage log error:", err));
                            }
                        }
                    }
                }),
                (editor) => {
                    editor.I18n.addMessages({
                        en: {
                            aiChat: {
                                header: { title: "AI Assistant" },
                                emptyState: { 
                                    title: "AI Assistant", 
                                    subtitle: "How can I help you today?" 
                                }
                            }
                        }
                    });
                }
            ],

            project: {
                type: 'web',
                default: {
                    pages: [
                        {
                            name: 'Home',
                            component: '<h1>Studio SDK (React Component) Loaded</h1>',
                        }
                    ]
                }
            },

            storageManager: false,
            i18n: {
                locale: 'en',
                detectLocale: false,
            }
        });

        console.log("GrapesJS Studio SDK (React) initialized successfully.");

    } catch (error) {
        console.error("Failed to initialize GrapesJS Studio SDK:", error);
    }
}

export async function returnFromEditor(params) {
    if (getStack().length > 0) {
        try { popBackHandler(); } catch (_) {}
    }

    cleanupEditor();

    document.body.classList.remove('editor-view-active');
    document.body.classList.remove('overlay-active');
    
    positionMusicControls();
    
    const { loadConsoleView } = await import('/static/main.js');
    loadConsoleView(params);
}

export function cleanupEditor() {
    if (editorRoot) {
        if (typeof editorRoot.unmount === 'function') {
            editorRoot.unmount();
        }
        editorRoot = null;
    }
    const container = document.getElementById('editor-container');
    if (container) {
        container.remove();
    }
}

// Register the handler so the main app can call it
registerHandler('openEditor', loadEditorView);
