"use strict";

/*
 * libgpiod 2.2.1 gpiomon (Debian 13) prints, by default:
 *   <seconds>.<nsec><TAB>falling<TAB>gpiochip0 17 "GPIO17"
 *   <seconds>.<nsec><TAB>rising<TAB>"GPIO22"
 * The edge word is lowercase in that source. Accept upper case too,
 * and an offset that sits before or after the edge. A press is falling.
 */

function parseGpiomonLine(line) {
    const text = String(line).replace(/\r$/, "").trim();
    const edgeMatch = text.match(/\b(falling|rising)\b/i);
    if (!edgeMatch) {
        return null;
    }

    const offset = findOffset(text, edgeMatch.index, edgeMatch[1].length);
    if (offset == null) {
        return null;
    }

    return {
        edge: edgeMatch[1].toLowerCase(),
        offset: offset
    };
}

function findOffset(text, edgeAt, edgeLength) {
    const labeled = text.match(/\boffset\s*[:=]\s*(\d+)\b/i);
    if (labeled) {
        return Number(labeled[1]);
    }

    const chip = text.match(/\bgpiochip\d+\s+(\d+)\b/i);
    if (chip) {
        return Number(chip[1]);
    }

    const after = offsetNumbers(text.slice(edgeAt + edgeLength));
    if (after.length) {
        return after[0];
    }

    const before = offsetNumbers(text.slice(0, edgeAt));
    if (before.length) {
        return before[before.length - 1];
    }

    return null;
}

function offsetNumbers(fragment) {
    const stripped = fragment
        .replace(/\d+\.\d+/g, " ")
        .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\b/g, " ");
    const nums = [];
    const re = /\d+/g;
    let match = re.exec(stripped);
    while (match) {
        nums.push(Number(match[0]));
        match = re.exec(stripped);
    }
    return nums;
}

/*
 * MMM-Buttons does not read the pin from the line. Each gpiomon process
 * watches one pin, and any line that contains the edge word is that pin.
 * "FALLING EDGE" (libgpiod 1) and "falling" (libgpiod 2) both match.
 * Rising is checked first, matching that module.
 */
function edgeFromGpiomonLine(line) {
    const text = String(line).replace(/\r$/, "").trim().toLowerCase();
    if (!text) {
        return null;
    }
    if (text.includes("rising")) {
        return "rising";
    }
    if (text.includes("falling")) {
        return "falling";
    }
    return null;
}

/*
 * libgpiod 2: gpiomon -c <chip> -b pull-up -p <ms>ms <pin>
 * libgpiod 1: gpiomon -B pull-up <chip> <pin>
 * The chip is whatever the caller passes. This module's default is gpiochip0.
 */
function gpiomonArgs(version, chip, pin, debounceMs) {
    const major = Number(version) >= 2 || version == null ? 2 : Number(version);
    if (major >= 2) {
        const args = ["-c", chip, "-b", "pull-up"];
        if (Number(debounceMs) > 0) {
            args.push("-p", String(debounceMs) + "ms");
        }
        args.push(String(pin));
        return args;
    }
    return ["-B", "pull-up", chip, String(pin)];
}

function gpiodMajor(versionText) {
    const match = String(versionText).match(/v(\d+)\./);
    if (!match) {
        return 2;
    }
    return Number(match[1]);
}

module.exports = {
    parseGpiomonLine: parseGpiomonLine,
    edgeFromGpiomonLine: edgeFromGpiomonLine,
    gpiomonArgs: gpiomonArgs,
    gpiodMajor: gpiodMajor
};
