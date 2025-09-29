import { API_BASE_URL } from '/static/main.js';
import { getUser } from '/static/scripts/authenticate.js';

/**
 * Establishes a WebSocket connection.
 * @param {string} targetWebsocketPath - The specific path for the WebSocket endpoint (e.g., /ws/connect/some-id).
 * @param {function} onOpen - Callback for when connection opens (ws, event) => {}
 * @param {function} onMessage - Callback for message events (event) => {}
 * @param {function} onError - Callback for error events (event) => {}
 * @param {function} onClose - Callback for close events (event) => {}
 * @param {function} [statusCallback] - Optional. Called with status updates (e.g., "Connecting...", "Error", "Closed").
 * @returns {Promise<WebSocket>} A promise that resolves with the WebSocket object on successful connection, or rejects on error.
 */
export function establishWebSocketConnection(targetWebsocketPath, onOpen, onMessage, onError, onClose, statusCallback) {
    return new Promise((resolve, reject) => {
        const user = getUser();
        if (!user || !user.token) {
            if (statusCallback) statusCallback("Authentication token not found. Cannot connect to WebSocket.", 'error');
            reject(new Error("User not authenticated"));
            return;
        }

        let socketUrl;
        if (targetWebsocketPath.startsWith('ws://') || targetWebsocketPath.startsWith('wss://')) {
            // If it's already a full URL, use it directly.
            socketUrl = targetWebsocketPath;
        } else {
            // Otherwise, construct the full URL from the path.
            const wsProtocol = API_BASE_URL.startsWith('https:') ? 'wss:' : 'ws:';
            const domain = API_BASE_URL.replace(/^https?:\/\//, ''); // Get domain from API_BASE_URL
            socketUrl = `${wsProtocol}//${domain}${targetWebsocketPath}`;
        }
        
        // Correctly append the auth_token, but only if it's not already in the URL
        if (!socketUrl.includes('auth_token=')) {
            if (socketUrl.includes('?')) {
                socketUrl += `&auth_token=${user.token}`;
            } else {
                socketUrl += `?auth_token=${user.token}`;
            }
        }

        if (statusCallback) statusCallback('Connecting to server…', 'info');

        const ws = new WebSocket(socketUrl);

        ws.onopen = (event) => {
            if (onOpen) onOpen(ws, event);
            resolve(ws);
        };

        ws.onmessage = (event) => {
            if (onMessage) onMessage(event);
        };

        ws.onerror = (event) => {
            console.error('WebSocket error:', event);
            if (statusCallback) statusCallback("WebSocket connection error. Check console for details.", 'error');
            if (onError) onError(event);
            reject(new Error('WebSocket connection error.'));
        };

        ws.onclose = (event) => {
            if (statusCallback) {
                // Suppress close message to avoid noisy UI
            }
            if (onClose) onClose(event);
        };
    });
} 