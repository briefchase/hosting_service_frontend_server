/**
 * Opens a new popup window and writes a redirecting document.
 * This approach helps to avoid some popup blocker issues when `window.open`
 * is called with a URL directly from a non-user-initiated event.
 *
 * @param {string} url - The destination URL to redirect to.
 * @param {string} windowName - The name of the window.
 * @param {string} features - The string of window features.
 * @returns {Window | null} The new window object or null if it was blocked.
 */
export function openPopup(url, windowName = '_blank', features = 'noopener,noreferrer,width=800,height=600') {
    const popup = window.open(url, windowName, features);
    if (popup) {
        try {
            popup.focus();
        } catch (e) {
            // Ignore cross-origin focus errors
        }
    }
    return popup;
}


