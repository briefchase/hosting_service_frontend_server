import React from 'react';
import ReactDOM from 'react-dom/client';
import StudioEditor from '@grapesjs/studio-sdk/react';
import { layoutSidebarButtons } from '@grapesjs/studio-sdk-plugins';
import aiChat from '@grapesjs/studio-sdk-plugins/dist/aiChat';
import '@grapesjs/studio-sdk/style';

/**
 * This is the bridge between the React-based SDK and your Vanilla JS website.
 * We use the official @grapesjs/studio-sdk/react component.
 */
window.mountStudioEditor = (container, options) => {
    console.log("[SDK Bundle] Mounting StudioEditor (React Component)...");
    const root = ReactDOM.createRoot(container);
    root.render(
        React.createElement(StudioEditor, { options })
    );
    return root;
};

// Expose the plugins so editor.js can use them in the options object
window.layoutSidebarButtons = layoutSidebarButtons;
window.aiChat = aiChat;

console.log("[SDK Bundle] React-based SDK loader initialized.");
