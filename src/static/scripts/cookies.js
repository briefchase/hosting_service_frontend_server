/**
 * website/src/static/scripts/cookies.js
 * Handles secret cookie logic for special promotions.
 */

const COOKIE_NAME = 'sc_special_offer';
const SECRET_CODE = 'dude_with_sign_2026';

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
 * Validates existing cookies and deletes them if they are expired (not today).
 * Returns the cookie data if a valid secret cookie for today exists, otherwise null.
 */
export function check_and_cleanup_cookies() {
    const cookies = document.cookie.split(';');
    let validData = null;

    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === COOKIE_NAME) {
            try {
                const data = JSON.parse(decodeURIComponent(value));
                const today = new Date().toISOString().split('T')[0];
                
                if (data.date === today && data.code === SECRET_CODE) {
                    validData = data;
                } else {
                    // Delete expired or invalid cookie
                    document.cookie = `${COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
                    console.log("[Cookies] Expired secret cookie removed.");
                }
            } catch (e) {
                // Delete malformed cookie
                document.cookie = `${COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
            }
        }
    }

    return validData;
}
