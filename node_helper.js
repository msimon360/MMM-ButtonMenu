const NodeHelper = require("node_helper");
const { spawn } = require("child_process");
const { parseGpiomonLine } = require("./lib/gpiomonLine");

const COMMANDS = {
    blank: true,
    unblank: true,
    restart: true,
    reboot: true
};

function isPin(value) {
    return Number.isInteger(value) && value >= 0;
}

function monitorSignature(config) {
    const source = config || {};
    const pins = Object.assign(
        { menu: 17, next: 27, select: 22 },
        source.pins
    );
    return JSON.stringify({
        gpioChip: source.gpioChip || "gpiochip0",
        menu: pins.menu,
        next: pins.next,
        select: pins.select,
        debounceMs: typeof source.debounceMs === "number" ? source.debounceMs : 50
    });
}

module.exports = NodeHelper.create({

    start() {
        this.monitor = null;
        this.monitorGeneration = 0;
        this.stopRequested = false;
        this.restartTimer = null;
        this.buffer = "";
        this.lastPressAt = {};
        this.buttonsByPin = {};
        this.debounceMs = 50;
        this.monitorSignature = null;
        console.log("[MMM-ButtonMenu] Node helper started");
        if (typeof this.getServerModuleConfig === "function") {
            try {
                this.startMonitor(this.getServerModuleConfig() || {});
            } catch (error) {
                console.error(
                    "[MMM-ButtonMenu] Could not read server config:",
                    error.message
                );
            }
        }
    },

    stop() {
        this.stopRequested = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        if (this.monitor) {
            this.monitor.kill("SIGTERM");
            this.monitor = null;
        }
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "START_GPIO") {
            this.startMonitor(payload || {});
        }

        if (notification === "RUN_COMMAND") {
            this.runCommand(payload || {});
        }
    },

    startMonitor(config) {
        const signature = monitorSignature(config);
        if (this.monitor && this.monitorSignature === signature) {
            return;
        }

        this.stopRequested = false;
        this.monitorSignature = signature;
        this.monitorGeneration += 1;
        const generation = this.monitorGeneration;

        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        if (this.monitor) {
            this.monitor.kill("SIGTERM");
            this.monitor = null;
        }

        const pins = Object.assign(
            { menu: 17, next: 27, select: 22 },
            config.pins
        );
        const chip = config.gpioChip || "gpiochip0";
        this.debounceMs = typeof config.debounceMs === "number"
            ? config.debounceMs
            : 50;
        this.buffer = "";
        this.lastPressAt = {};
        this.buttonsByPin = {};

        ["menu", "next", "select"].forEach((name) => {
            if (!isPin(pins[name])) {
                console.error(
                    "[MMM-ButtonMenu] Ignoring invalid pin for " + name
                );
                return;
            }
            this.buttonsByPin[pins[name]] = name;
        });

        const pinList = ["menu", "next", "select"]
            .map((name) => pins[name])
            .filter(isPin);

        if (!pinList.length) {
            console.error("[MMM-ButtonMenu] No GPIO pins configured");
            return;
        }

        /*
         * libgpiod 2.2: the chip is --chip, not a positional argument.
         * Internal pull-up. A press is active low, so a falling edge
         * is the button. Debounce is applied here, not via sysfs.
         */
        const args = [
            "--chip=" + chip,
            "--bias=pull-up",
            "--edges=both"
        ].concat(pinList.map(String));

        console.log("[MMM-ButtonMenu] gpiomon " + args.join(" "));

        const child = spawn("gpiomon", args, {
            stdio: ["ignore", "pipe", "pipe"]
        });
        this.monitor = child;

        const scheduleRestart = () => {
            if (this.stopRequested || generation !== this.monitorGeneration) {
                return;
            }
            if (this.restartTimer) {
                return;
            }
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null;
                if (!this.stopRequested && generation === this.monitorGeneration) {
                    this.startMonitor(config);
                }
            }, 5000);
        };

        child.stdout.on("data", (chunk) => {
            this.buffer += chunk.toString();
            let newline = this.buffer.indexOf("\n");
            while (newline >= 0) {
                const line = this.buffer.slice(0, newline).replace(/\r$/, "");
                this.buffer = this.buffer.slice(newline + 1);
                this.handleMonitorLine(line);
                newline = this.buffer.indexOf("\n");
            }
        });

        child.stderr.on("data", (chunk) => {
            const text = chunk.toString().trim();
            if (text) {
                console.error("[MMM-ButtonMenu] gpiomon:", text);
            }
        });

        child.on("error", (error) => {
            console.error("[MMM-ButtonMenu] gpiomon failed:", error.message);
            if (error.code === "ENOENT") {
                console.error(
                    "[MMM-ButtonMenu] Install the gpiod package so gpiomon is on PATH."
                );
            }
            scheduleRestart();
        });

        child.on("exit", (code) => {
            if (generation !== this.monitorGeneration) {
                return;
            }
            console.error("[MMM-ButtonMenu] gpiomon exited (" + code + ")");
            this.monitor = null;
            scheduleRestart();
        });
    },

    handleMonitorLine(line) {
        const parsed = parseGpiomonLine(line);
        if (!parsed || parsed.edge !== "falling") {
            return;
        }

        const button = this.buttonsByPin[parsed.offset];
        if (!button) {
            return;
        }

        const now = Date.now();
        const last = this.lastPressAt[parsed.offset] || 0;
        if (now - last < this.debounceMs) {
            return;
        }
        this.lastPressAt[parsed.offset] = now;

        this.sendSocketNotification("BUTTON_PRESS", {
            button: button,
            pin: parsed.offset
        });
    },

    /*
     * Runs only after the menu UI has already confirmed the action.
     * Empty commands are skipped. Unit tests never load this file.
     */
    runCommand(payload) {
        const name = payload.name;
        const command = typeof payload.command === "string"
            ? payload.command.trim()
            : "";

        if (!COMMANDS[name]) {
            console.error("[MMM-ButtonMenu] Refusing unknown command:", name);
            return;
        }

        if (!command) {
            console.log(
                "[MMM-ButtonMenu] No command configured for " + name +
                ". Copy blank and unblank from `sudo crontab -l`."
            );
            return;
        }

        console.log("[MMM-ButtonMenu] Running " + name);
        const child = spawn(command, {
            shell: true,
            detached: true,
            stdio: "ignore"
        });
        child.unref();
        child.on("error", (error) => {
            console.error(
                "[MMM-ButtonMenu] Command failed:",
                error.message
            );
        });
    }
});
