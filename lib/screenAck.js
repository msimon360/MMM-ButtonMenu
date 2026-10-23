"use strict";

/*
 * The helper logs a press before it emits BUTTON_PRESS. menu shown is
 * a later reply. If that reply never comes, say so.
 */
function createScreenAck(log) {
    const pending = [];

    return {
        sent() {
            const timer = setTimeout(() => {
                const index = pending.indexOf(timer);
                if (index >= 0) {
                    pending.splice(index, 1);
                }
                log("[MMM-ButtonMenu] screen did not answer");
            }, 1000);
            pending.push(timer);
        },

        answered(payload) {
            const timer = pending.shift();
            if (timer) {
                clearTimeout(timer);
            }
            const source = payload || {};
            if (source.failure) {
                log("[MMM-ButtonMenu] menu draw failed: " + source.failure);
            }
            log(source.open
                ? "[MMM-ButtonMenu] menu shown"
                : "[MMM-ButtonMenu] menu hidden");
        },

        stop() {
            while (pending.length) {
                clearTimeout(pending.shift());
            }
        }
    };
}

module.exports = {
    createScreenAck: createScreenAck
};
