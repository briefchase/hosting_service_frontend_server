// website/src/static/pages/editor.js

import { pushBackHandler, popBackHandler, replaceBackHandler, getStack } from '/static/scripts/back.js';
import { positionMusicControls } from '/static/pages/landing.js';
import { registerHandler } from '../scripts/registry.js';
import { prompt, clearPromptStack } from '/static/pages/prompt.js';
import { CONFIG } from '/static/config.js';

const EDITOR_HTML = `
<div id="editor-container" class="terminal-container">
    <div id="gjs" style="height: 100%; width: 100%;"></div>
</div>
`;

let currentEditorAPI = null;
let editor = null;

async function loadGrapesJS() {
    if (window.GrapesJsStudioSDK && window.StudioSdkPlugins_aiChat) {
        return { 
            SDK: window.GrapesJsStudioSDK, 
            aiChat: window.StudioSdkPlugins_aiChat
        };
    }

    return new Promise((resolve, reject) => {
        // 1. Load React & ReactDOM (REQUIRED for AI Plugin UMD)
        const reactScript = document.createElement('script');
        reactScript.src = 'https://unpkg.com/react@18/umd/react.production.min.js';
        reactScript.crossOrigin = "anonymous";
        reactScript.onload = () => {
            const reactDomScript = document.createElement('script');
            reactDomScript.src = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js';
            reactDomScript.crossOrigin = "anonymous";
            reactDomScript.onload = () => {
                console.log("[Editor] React & ReactDOM loaded.");

                // 2. Load Studio SDK CSS (v1.0.60)
                const studioCss = document.createElement('link');
                studioCss.rel = 'stylesheet';
                studioCss.href = 'https://unpkg.com/@grapesjs/studio-sdk@1.0.60/dist/style.css';
                document.head.appendChild(studioCss);

                // 3. Load GrapesJS Core (REQUIRED for Engine Hijack)
                const coreScript = document.createElement('script');
                coreScript.src = 'https://unpkg.com/grapesjs';
                coreScript.onload = () => {
                    console.log("[Editor] GrapesJS Core loaded.");

                    // 4. Load Studio SDK Core (v1.0.60)
                    const sdkScript = document.createElement('script');
                    sdkScript.src = 'https://unpkg.com/@grapesjs/studio-sdk@1.0.60/dist/index.umd.js';
                    sdkScript.onload = () => {
                        console.log("[Editor] Studio SDK 1.0.60 loaded.");

                        // 5. Load AI Chat Plugin (v1.0.36)
                        const aiPluginScript = document.createElement('script');
                        aiPluginScript.src = 'https://unpkg.com/@grapesjs/studio-sdk-plugins@1.0.36/dist/aiChat/index.umd.js';
                        aiPluginScript.onload = () => {
                            console.log("[Editor] AI Plugin 1.0.36 loaded.");
                            
                            // Bridge the globals for the AI plugin's internal requirements
                            window.StudioSdkPlugins = window.StudioSdkPlugins || {};
                            const aiChatFn = window.StudioSdkPlugins_aiChat;
                            if (aiChatFn && !window.StudioSdkPlugins.Chat) {
                                window.StudioSdkPlugins.Chat = aiChatFn;
                            }
                            
                            const SDK = window.GrapesJsStudioSDK;
                            resolve({ SDK, aiChat: aiChatFn });
                        };
                        aiPluginScript.onerror = (err) => {
                            console.error("[Editor] AI Plugin load error:", err);
                            reject(new Error("Failed to load AI Plugin"));
                        };
                        document.head.appendChild(aiPluginScript);
                    };
                    sdkScript.onerror = (err) => {
                        console.error("[Editor] Studio SDK load error:", err);
                        reject(new Error("Failed to load Studio SDK"));
                    };
                    document.head.appendChild(sdkScript);
                };
                coreScript.onerror = (err) => {
                    console.error("[Editor] GrapesJS Core load error:", err);
                    reject(new Error("Failed to load GrapesJS Core"));
                };
                document.head.appendChild(coreScript);
            };
            document.head.appendChild(reactDomScript);
        };
        document.head.appendChild(reactScript);
    });
}

export async function loadEditorView(params = {}) {
    console.log("loadEditorView called with params:", params);
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
        throw new Error("Console container not found.");
    }

    const { clearConsoleContent } = await import('/static/main.js');
    clearConsoleContent();
    
    consoleContainer.insertAdjacentHTML('beforeend', EDITOR_HTML);

    try {
        const { SDK, aiChat } = await loadGrapesJS();
        const { createStudioEditor } = SDK;
        
        const licenseKey = CONFIG.GRAPESJS_STUDIO_LICENSE;

        console.log("[Editor] Initializing Studio Editor 1.0.60 with Engine Hijack...");

        // --- THE ENGINE HIJACK FIX (Verified by Console Probe) ---
        // The Studio SDK v1.0.60 UMD build has a private plugin registry.
        // We bypass it by shimming the underlying GrapesJS engine initialization.
        const originalGjsInit = window.grapesjs.init;
        window.grapesjs.init = function(config) {
            console.log("[Editor] Internal engine initializing. Injecting AI plugin...");
            
            // 1. Force the AI plugin into the engine's config
            config.plugins = config.plugins || [];
            if (!config.plugins.includes('ai-chat')) {
                config.plugins.push('ai-chat');
            }
            
            // 2. Ensure the plugin function is in the GJS registry
            window.grapesjs.plugins.add('ai-chat', aiChat.init || aiChat);
            
            // 3. Apply the AI plugin options directly to the engine config
            config.pluginsOpts = config.pluginsOpts || {};
            config.pluginsOpts['ai-chat'] = {
                headline: 'How can I help you design today?',
            };

            // 4. Fix the broken auto-loader paths
            config.loadPlugins = false;
            config.basePath = 'https://unpkg.com/grapesjs/';

            return originalGjsInit.apply(this, arguments);
        };

        editor = await createStudioEditor({
            licenseKey: licenseKey,
            root: '#gjs',
            height: '100%',
            width: 'auto',
            
            // Pass NO plugins to the Studio loader to avoid the SyntaxError crash
            plugins: [],

            // --- THE UI CONFIGURATION ---
            // This explicitly adds the AI button and panel to the Studio UI
            layout: {
                default: {
                    panels: [
                        {
                            id: 'ai-chat-panel',
                            layout: { type: 'aiChatPanel' },
                            placer: { type: 'static', position: 'right' },
                        }
                    ],
                    actions: {
                        items: [
                            'undo', 'redo', 'fullscreen',
                            {
                                id: 'ai-chat-btn',
                                icon: 'chat',
                                label: 'AI Assistant',
                                onClick: ({ editor }) => editor.runCommand('studio:layout-toggle', { id: 'ai-chat-panel' }),
                            }
                        ]
                    }
                }
            },

            project: {
                type: 'web',
                default: {
                    pages: [
                        {
                            name: 'Home',
                            component: '<h1>Studio SDK 1.0.60 + AI Hijack Loaded</h1>',
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

        // Restore the original init function for safety
        window.grapesjs.init = originalGjsInit;

        console.log("GrapesJS Studio SDK 1.0.60 initialized with AI.");

    } catch (error) {
        console.error("Failed to initialize GrapesJS Studio SDK:", error);
    }

    currentEditorAPI = {
        site_id,
        deployment_name,
        cleanup: cleanupEditor
    };

    return;
}

export async function returnFromEditor(params) {
    if (getStack().length > 0) {
        try { popBackHandler(); } catch (_) {}
    }

    if (currentEditorAPI) {
        currentEditorAPI.cleanup();
        currentEditorAPI = null;
    }

    document.body.classList.remove('editor-view-active');
    document.body.classList.remove('overlay-active');
    
    positionMusicControls();
    
    const { loadConsoleView } = await import('/static/main.js');
    loadConsoleView(params);
}

export function cleanupEditor() {
    if (editor) {
        if (typeof editor.destroy === 'function') {
            editor.destroy();
        } else if (editor.then) {
            editor.then(instance => instance && instance.destroy && instance.destroy());
        }
        editor = null;
    }
    const container = document.getElementById('editor-container');
    if (container) {
        container.remove();
    }
}

registerHandler('openEditor', loadEditorView);
