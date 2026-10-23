function buttonMenuState() {
    const root = typeof globalThis !== "undefined" ? globalThis : window;
    return root.MMMButtonMenuState || null;
}

Module.register("MMM-ButtonMenu", {
    /*
     * MagicMirror 2.38 treats a getScripts path that contains "/" as a
     * site-root URL. The filename has no slash, so the loader prefixes
     * the module directory. require is not used here: this file runs
     * in the browser.
     */
    getScripts() {
        return ["menuState.js"];
    },

    defaults: {
        gpioChip: "gpiochip0",
        pins: {
            menu: 17,
            next: 27,
            select: 22
        },
        debounceMs: 50,
        holdMs: 60000,
        menuTimeoutMs: 8000,
        homePage: 0,
        pages: [],
        commands: {
            blank: "",
            unblank: "",
            restart: "pm2 restart mm",
            reboot: "sudo reboot"
        }
    },

    start() {
        this.config.pins = Object.assign(
            { menu: 17, next: 27, select: 22 },
            this.config.pins
        );
        this.config.commands = Object.assign(
            {
                blank: "",
                unblank: "",
                restart: "pm2 restart mm",
                reboot: "sudo reboot"
            },
            this.config.commands
        );

        this.overlay = null;
        this.menu = null;
        this.holdTimer = null;
        this.menuTimer = null;
        this.holdRemainingMs = 0;
        this.holdStartedAt = 0;

        this.menuState = buttonMenuState();
        if (!this.menuState) {
            Log.error("[MMM-ButtonMenu] menuState.js did not load");
            this.sendSocketNotification("MENU_SCRIPT_MISSING");
        } else {
            this.menu = this.menuState.createMenu(this.config);
        }

        /*
         * Always open the helper socket. Returning before this call
         * leaves BUTTON_PRESS with nowhere to go.
         */
        Log.info("[MMM-ButtonMenu] Starting");
        this.sendSocketNotification("START_GPIO", {
            gpioChip: this.config.gpioChip,
            pins: this.config.pins,
            debounceMs: this.config.debounceMs
        });
    },

    getStyles() {
        return ["MMM-ButtonMenu.css"];
    },

    socketNotificationReceived(notification, payload) {
        if (notification !== "BUTTON_PRESS" || !payload || !payload.button) {
            return;
        }

        /*
         * Handle the press even when menuState.js did not load.
         * A draw error is reported on MENU_ACK and must not skip it.
         */
        let failure = null;
        try {
            failure = this.applyDispatch(payload.button);
        } catch (error) {
            failure = error && error.message ? error.message : String(error);
        } finally {
            this.sendSocketNotification("MENU_ACK", {
                open: !!(this.menu && this.menu.menuOpen),
                failure: failure
            });
        }
    },

    ensureMenu() {
        if (this.menu && this.menuState) {
            return true;
        }
        const stateApi = this.menuState || buttonMenuState();
        if (!stateApi) {
            return false;
        }
        this.menuState = stateApi;
        if (!this.menu) {
            this.menu = stateApi.createMenu(this.config);
        }
        return true;
    },

    applyDispatch(event) {
        if (!this.ensureMenu()) {
            return;
        }
        const result = this.menuState.dispatch(this.menu, event);
        this.menu = result.state;
        if (event === "select" && this.menuState.describeSelect) {
            this.sendSocketNotification("SELECT_LOG", {
                line: this.menuState.describeSelect(result)
            });
        }
        this.applyEffects(result.effects);
        try {
            this.syncOverlay();
            this.updateDom(0);
        } catch (error) {
            return error && error.message ? error.message : String(error);
        }
        return null;
    },

    applyEffects(effects) {
        effects.forEach((effect) => {
            if (effect.type === "notification") {
                if (effect.payload === undefined) {
                    this.sendNotification(effect.name);
                } else {
                    this.sendNotification(effect.name, effect.payload);
                }
                return;
            }

            if (effect.type === "command") {
                const commands = this.config.commands || {};
                this.sendSocketNotification("RUN_COMMAND", {
                    name: effect.name,
                    command: commands[effect.name] || ""
                });
                return;
            }

            if (effect.type === "hold") {
                if (effect.action === "start") {
                    this.armHold(effect.ms);
                } else if (effect.action === "pause") {
                    this.pauseHold();
                } else if (effect.action === "resume") {
                    this.resumeHold();
                } else if (effect.action === "clear") {
                    this.clearHold();
                }
                return;
            }

            if (effect.type === "menuTimer") {
                if (effect.action === "start") {
                    this.armMenuTimer(effect.ms);
                } else {
                    this.clearMenuTimer();
                }
            }
        });
    },

    armHold(ms) {
        this.clearHoldTimer();
        if (!(ms > 0)) {
            this.holdRemainingMs = 0;
            return;
        }
        this.holdRemainingMs = ms;
        this.holdStartedAt = Date.now();
        this.holdTimer = setTimeout(() => {
            this.holdTimer = null;
            this.holdRemainingMs = 0;
            this.applyDispatch("holdElapsed");
        }, ms);
    },

    pauseHold() {
        if (!this.holdTimer) {
            return;
        }
        clearTimeout(this.holdTimer);
        this.holdTimer = null;
        const elapsed = Date.now() - this.holdStartedAt;
        this.holdRemainingMs = Math.max(0, this.holdRemainingMs - elapsed);
    },

    resumeHold() {
        if (this.holdTimer || !(this.holdRemainingMs > 0)) {
            return;
        }
        this.armHold(this.holdRemainingMs);
    },

    clearHold() {
        this.clearHoldTimer();
        this.holdRemainingMs = 0;
    },

    clearHoldTimer() {
        if (this.holdTimer) {
            clearTimeout(this.holdTimer);
            this.holdTimer = null;
        }
    },

    armMenuTimer(ms) {
        this.clearMenuTimer();
        if (!(ms > 0)) {
            return;
        }
        this.menuTimer = setTimeout(() => {
            this.menuTimer = null;
            this.applyDispatch("menuTimeout");
        }, ms);
    },

    clearMenuTimer() {
        if (this.menuTimer) {
            clearTimeout(this.menuTimer);
            this.menuTimer = null;
        }
    },

    /*
     * MMM-pages hides modules that are not in `fixed`. A position:fixed
     * child of that wrapper is hidden with it, so the open menu is
     * attached to document.body and removed when the menu closes.
     */
    syncOverlay() {
        if (typeof document === "undefined" || !document.body) {
            return;
        }
        if (!this.menu || !this.menu.menuOpen) {
            this.removeOverlay();
            return;
        }

        if (!this.overlay) {
            this.overlay = document.createElement("div");
            this.overlay.className = "mmm-buttonmenu";
            document.body.appendChild(this.overlay);
        }

        while (this.overlay.firstChild) {
            this.overlay.removeChild(this.overlay.firstChild);
        }
        this.overlay.appendChild(this.buildPanel());
    },

    removeOverlay() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
    },

    buildPanel() {
        const panel = document.createElement("div");
        panel.className = "buttonmenu-panel";

        const title = document.createElement("div");
        title.className = "buttonmenu-title";
        title.innerText = "Menu";
        panel.appendChild(title);

        this.menu.rows.forEach((row, index) => {
            const item = document.createElement("div");
            item.className = "buttonmenu-row";
            const confirming = this.menu.confirming &&
                this.menu.confirming === row.command &&
                index === this.menu.highlight;

            if (index === this.menu.highlight) {
                item.classList.add("is-highlight");
            }
            if (confirming) {
                item.classList.add("is-confirm");
            }

            const label = document.createElement("div");
            label.className = "buttonmenu-label";
            label.innerText = row.label;
            item.appendChild(label);

            if (confirming) {
                const hint = document.createElement("div");
                hint.className = "buttonmenu-confirm";
                hint.innerText = "Press Select again";
                item.appendChild(hint);
            }

            panel.appendChild(item);
        });

        const note = document.createElement("div");
        note.className = "buttonmenu-note";
        if (this.menu.confirming) {
            note.innerText = "Next leaves this row. Menu cancels.";
        } else {
            note.innerText = "Next moves. Select chooses. Menu closes.";
        }
        panel.appendChild(note);
        return panel;
    },

    getDom() {
        this.ensureMenu();
        this.syncOverlay();
        const slot = document.createElement("div");
        slot.className = "mmm-buttonmenu-slot";
        return slot;
    }
});
