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

module.exports = {
    parseGpiomonLine: parseGpiomonLine
};
