// website/src/js/scripts/registry.js

const handlers = {};

/**
 * Registers a handler function with a given name.
 * @param {string} name - The name of the action handler.
 * @param {Function} fn - The handler function.
 */
export function registerHandler(name, fn) {
    if (handlers[name]) {
        console.warn(`Handler for action "${name}" is already registered and will be overwritten.`);
    }
    handlers[name] = fn;
}

/**
 * Returns the map of all registered handlers.
 * @returns {Object}
 */
export function getHandlers() {
    return handlers;
}
