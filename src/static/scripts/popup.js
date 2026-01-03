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
export function openPopup(url, windowName, features) {
    const popup = window.open('', windowName, features);

    if (!popup) {
        return null;
    }

    try {
        const doc = popup.document;
        const safeDest = JSON.stringify(url);
        doc.open();
        doc.write(
            '<!DOCTYPE html>' +
            '<html><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<title>Redirecting…</title>' +
            '<style>html,body{background:#fff;color:#000;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;font-size:14px;margin:0;padding:16px}</style>' +
            '<script>(function(){var d=' + safeDest + ';setTimeout(function(){try{location.replace(d);}catch(e){location.href=d;}},50);})();<\/script>' +
            '</head><body>Redirecting...</body></html>'
        );
        doc.close();
        try { popup.focus(); } catch(_) {}
    } catch(_) {
        // Errors can happen due to cross-origin restrictions, but the redirect should still work.
    }

    return popup;
}


