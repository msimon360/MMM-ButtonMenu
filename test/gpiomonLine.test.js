"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
    parseGpiomonLine,
    edgeFromGpiomonLine,
    gpiomonArgs,
    gpiodMajor
} = require("../lib/gpiomonLine");

test("parses the libgpiod 2.2 default falling line", () => {
    const parsed = parseGpiomonLine(
        "10002.907638045\tfalling\tgpiochip0 17 \"GPIO17\""
    );
    assert.deepEqual(parsed, { edge: "falling", offset: 17 });
});

test("parses a rising line with the offset only in the line name", () => {
    const parsed = parseGpiomonLine("10002.907638045\trising\t\"GPIO22\"");
    assert.deepEqual(parsed, { edge: "rising", offset: 22 });
    assert.notEqual(parsed.edge, "falling");
});

test("parses a local-time falling line", () => {
    const parsed = parseGpiomonLine(
        "2022-11-15T10:36:59.129681898\tfalling\tGPIO27"
    );
    assert.deepEqual(parsed, { edge: "falling", offset: 27 });
});

test("accepts uppercase FALLING with the offset after the edge", () => {
    const parsed = parseGpiomonLine(
        "event: FALLING EDGE offset: 17 timestamp: [    10002.907638045]"
    );
    assert.deepEqual(parsed, { edge: "falling", offset: 17 });
});

test("accepts uppercase RISING with the offset before the edge", () => {
    const parsed = parseGpiomonLine("22\tRISING");
    assert.deepEqual(parsed, { edge: "rising", offset: 22 });
    assert.notEqual(parsed.edge, "falling");
});

test("accepts a chip offset that appears before FALLING", () => {
    const parsed = parseGpiomonLine("gpiochip0 27 FALLING \"GPIO27\"");
    assert.deepEqual(parsed, { edge: "falling", offset: 27 });
});

test("does not treat the timestamp as a pin", () => {
    assert.equal(parseGpiomonLine("10002.907638045\tfalling"), null);
    assert.equal(parseGpiomonLine("Monitoring lines '17', '27', and '22'..."), null);
});

test("a falling line with no pin is still a press edge", () => {
    assert.equal(edgeFromGpiomonLine("falling"), "falling");
    assert.equal(parseGpiomonLine("10002.907638045\tfalling"), null);
});

test("accepts libgpiod 1 FALLING EDGE and libgpiod 2 falling", () => {
    assert.equal(
        edgeFromGpiomonLine("event: FALLING EDGE offset: 17 timestamp: [10002.1]"),
        "falling"
    );
    assert.equal(
        edgeFromGpiomonLine("1702483200.123456789\trising\t24"),
        "rising"
    );
    assert.equal(edgeFromGpiomonLine("Monitoring line '17'..."), null);
});

test("a pinctrl-rp1 line is a falling edge without using the 1 as the pin", () => {
    assert.equal(
        edgeFromGpiomonLine(
            "10002.907638045\tfalling\tpinctrl-rp1 17 \"GPIO17\""
        ),
        "falling"
    );
});

test("libgpiod 2 args are one pin, short flags, and hardware debounce", () => {
    assert.deepEqual(
        gpiomonArgs(2, "gpiochip0", 17, 50),
        ["-c", "gpiochip0", "-b", "pull-up", "-p", "50ms", "17"]
    );
    assert.deepEqual(
        gpiomonArgs(1, "gpiochip0", 27, 50),
        ["-B", "pull-up", "gpiochip0", "27"]
    );
    assert.deepEqual(
        gpiomonArgs(2, "gpiochip0", 22, 0),
        ["-c", "gpiochip0", "-b", "pull-up", "22"]
    );
});

test("version text selects the major, and unknown text assumes v2", () => {
    assert.equal(gpiodMajor("gpiomon (libgpiod) v2.2.1\n"), 2);
    assert.equal(gpiodMajor("gpiomon (libgpiod) v1.6.3\n"), 1);
    assert.equal(gpiodMajor(""), 2);
});

test("the browser module file does not call require", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "MMM-ButtonMenu.js"),
        "utf8"
    );
    assert.equal(/\brequire\s*\(/.test(source), false);
    assert.match(source, /return \["menuState\.js"\]/);
});

test("start opens the helper socket even when the menu script is missing", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "MMM-ButtonMenu.js"),
        "utf8"
    );
    const helper = fs.readFileSync(
        path.join(__dirname, "..", "node_helper.js"),
        "utf8"
    );
    assert.match(source, /MENU_SCRIPT_MISSING/);
    assert.match(source, /sendSocketNotification\("START_GPIO"/);
    assert.doesNotMatch(
        source,
        /menuState\.js did not load"\);\s*return;/
    );
    assert.match(source, /document\.body\.appendChild\(this\.overlay\)/);
    assert.match(source, /removeChild\(this\.overlay\)/);
    assert.match(source, /MENU_ACK/);
    assert.match(helper, /\[MMM-ButtonMenu\] menu script missing/);
    assert.match(helper, /\[MMM-ButtonMenu\] menu shown/);
    assert.match(helper, /\[MMM-ButtonMenu\] menu hidden/);
});
