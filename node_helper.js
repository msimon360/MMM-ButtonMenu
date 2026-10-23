const NodeHelper = require("node_helper");
const { spawn, execFileSync } = require("child_process");
const {
    edgeFromGpiomonLine,
    gpiomonArgs,
    gpiodMajor
} = require("./lib/gpiomonLine");

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

function readGpiodMajor() {
    try {
        const output = execFileSync("gpiomon", ["--version"], {
            encoding: "utf8"
        });
        return gpiodMajor(output);
    } catch (error) {
        const text = String(error.stdout || "") + String(error.stderr || "");
        if (/v\d+\./.test(text)) {
            return gpiodMajor(text);
        }
        return 2;
    }
}

function childAlive(child) {
    return child && child.exitCode === null && child.signalCode === null && !child.killed;
}

module.exports = NodeHelper.create({

    start() {
        this.monitors = [];
        this.expectedCount = 0;
        this.monitorGeneration = 0;
        this.stopRequested = false;
        this.restartTimer = null;
        this.lastPressAt = {};
        this.debounceMs = 50;
        this.monitorSignature = null;
        this.stdbufMissing = false;
        this.gpiodMajor = null;
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
        this.clearRestart();
        this.killMonitors();
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "START_GPIO") {
            this.startMonitor(payload || {});
        }

        if (notification === "RUN_COMMAND") {
            this.runCommand(payload || {});
        }
    },

    clearRestart() {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    },

    killMonitors() {
        const children = this.monitors;
        this.monitors = [];
        children.forEach((entry) => {
            entry.replaced = true;
            if (entry.child) {
                entry.child.kill("SIGTERM");
            }
        });
    },

    monitorsCoverSignature(signature) {
        return this.expectedCount > 0 &&
            this.monitorSignature === signature &&
            this.monitors.length === this.expectedCount &&
            this.monitors.every((entry) => childAlive(entry.child));
    },

    startMonitor(config) {
        const signature = monitorSignature(config);
        if (this.monitorsCoverSignature(signature)) {
            return;
        }

        this.stopRequested = false;
        this.monitorSignature = signature;
        this.monitorGeneration += 1;
        const generation = this.monitorGeneration;

        this.clearRestart();
        this.killMonitors();

        const pins = Object.assign(
            { menu: 17, next: 27, select: 22 },
            config.pins
        );
        const chip = config.gpioChip || "gpiochip0";
        this.debounceMs = typeof config.debounceMs === "number"
            ? config.debounceMs
            : 50;
        this.lastPressAt = {};

        const buttons = ["menu", "next", "select"].filter((name) => {
            if (isPin(pins[name])) {
                return true;
            }
            console.error(
                "[MMM-ButtonMenu] Ignoring invalid pin for " + name
            );
            return false;
        }).map((name) => ({ button: name, pin: pins[name] }));

        this.expectedCount = buttons.length;
        if (!buttons.length) {
            console.error("[MMM-ButtonMenu] No GPIO pins configured");
            return;
        }

        if (this.gpiodMajor == null) {
            this.gpiodMajor = readGpiodMajor();
            console.log("[MMM-ButtonMenu] libgpiod v" + this.gpiodMajor);
        }

        /*
         * One gpiomon per pin, same flags MMM-Buttons uses for libgpiod 2:
         * -c chip -b pull-up -p <ms>ms <pin>. The press is the falling
         * edge on that process. The chip stays the configured gpiochip0.
         * stdbuf keeps the pipe line-buffered when gpiomon does not flush.
         */
        buttons.forEach((button) => {
            this.spawnPin({
                button: button.button,
                pin: button.pin,
                chip: chip,
                generation: generation,
                config: config
            });
        });
    },

    spawnPin(spec) {
        const args = gpiomonArgs(
            this.gpiodMajor,
            spec.chip,
            spec.pin,
            this.debounceMs
        );
        const command = this.stdbufMissing ? "gpiomon" : "stdbuf";
        const commandArgs = this.stdbufMissing
            ? args
            : ["-oL", "-eL", "gpiomon"].concat(args);

        console.log(
            "[MMM-ButtonMenu] " + command + " " + commandArgs.join(" ")
        );

        const child = spawn(command, commandArgs, {
            stdio: ["ignore", "pipe", "pipe"]
        });
        const entry = {
            pin: spec.pin,
            button: spec.button,
            child: child,
            buffer: "",
            replaced: false,
            generation: spec.generation
        };
        this.monitors.push(entry);

        const scheduleRestart = () => {
            if (this.stopRequested || spec.generation !== this.monitorGeneration || entry.replaced) {
                return;
            }
            if (this.restartTimer) {
                return;
            }
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null;
                if (!this.stopRequested && spec.generation === this.monitorGeneration) {
                    this.startMonitor(spec.config);
                }
            }, 5000);
        };

        child.stdout.on("data", (chunk) => {
            entry.buffer += chunk.toString();
            let newline = entry.buffer.indexOf("\n");
            while (newline >= 0) {
                const line = entry.buffer.slice(0, newline).replace(/\r$/, "");
                entry.buffer = entry.buffer.slice(newline + 1);
                this.handleMonitorLine(entry, line);
                newline = entry.buffer.indexOf("\n");
            }
        });

        child.stderr.on("data", (chunk) => {
            const text = chunk.toString().trim();
            if (text) {
                console.error("[MMM-ButtonMenu] gpiomon " + spec.button + ":", text);
            }
        });

        child.on("error", (error) => {
            if (command === "stdbuf" && error.code === "ENOENT") {
                entry.replaced = true;
                this.stdbufMissing = true;
                this.monitors = this.monitors.filter((item) => item !== entry);
                console.error(
                    "[MMM-ButtonMenu] stdbuf is missing; running gpiomon without line buffering"
                );
                if (!this.stopRequested && spec.generation === this.monitorGeneration) {
                    this.spawnPin(spec);
                }
                return;
            }

            console.error(
                "[MMM-ButtonMenu] " + command + " for " + spec.button + " failed:",
                error.message
            );
            if (error.code === "ENOENT") {
                console.error(
                    "[MMM-ButtonMenu] Install the gpiod package so gpiomon is on PATH."
                );
            }
            scheduleRestart();
        });

        child.on("exit", (code) => {
            if (entry.replaced || spec.generation !== this.monitorGeneration) {
                return;
            }
            console.error(
                "[MMM-ButtonMenu] gpiomon for " + spec.button + " exited (" + code + ")"
            );
            this.monitors = this.monitors.filter((item) => item !== entry);
            scheduleRestart();
        });
    },

    handleMonitorLine(entry, line) {
        if (edgeFromGpiomonLine(line) !== "falling") {
            return;
        }

        const now = Date.now();
        const last = this.lastPressAt[entry.pin] || 0;
        if (now - last < this.debounceMs) {
            return;
        }
        this.lastPressAt[entry.pin] = now;

        this.sendSocketNotification("BUTTON_PRESS", {
            button: entry.button,
            pin: entry.pin
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
