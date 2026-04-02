/**
 * website/src/js/scripts/cookies.js
 * Handles secret cookie logic for special promotions.
 */

const COOKIE_NAME = 'sc_special_offer';
const SECRET_CODE = 'kittycat';

/**
 * Sets a secret cookie with the current date and a code.
 */
export function give_secret_cookie() {
    const today = new Date().toISOString().split('T')[0];
    const cookieValue = JSON.stringify({ date: today, code: SECRET_CODE });
    // Set cookie for 1 day
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}; path=/; max-age=86400; SameSite=Strict`;
    console.log("[Cookies] Secret cookie granted.");
}

/**
 * Validates existing cookies and deletes them if they are expired (not today)
 * or have an incorrect code.
 * Returns the cookie data if a valid secret cookie for today exists, otherwise null.
 */
export function check_and_cleanup_cookies() {
    const cookies = document.cookie.split(';');
    let validData = null;

    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === COOKIE_NAME) {
            console.log(`[Cookies] Found existing cookie: ${COOKIE_NAME}=${value}`);
            try {
                const data = JSON.parse(decodeURIComponent(value));
                const today = new Date().toISOString().split('T')[0];
                console.log(`[Cookies] Cookie details - Date: ${data.date}, Code: ${data.code}, Today: ${today}`);
                
                if (data.date === today && data.code === SECRET_CODE) {
                    console.log("[Cookies] Secret cookie is valid for today.");
                    validData = data;
                } else {
                    // Delete expired or invalid cookie (wrong date or wrong code)
                    document.cookie = `${COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
                    console.log(`[Cookies] Invalid or expired secret cookie removed (Date mismatch or wrong code).`);
                }
            } catch (e) {
                // Delete malformed cookie
                document.cookie = `${COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
                console.log(`[Cookies] Malformed secret cookie removed: ${e.message}`);
            }
        }
    }

    if (!validData) {
        console.log("[Cookies] No valid secret cookie found after cleanup.");
    }

    return validData;
}
