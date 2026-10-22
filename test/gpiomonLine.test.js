"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseGpiomonLine } = require("../lib/gpiomonLine");

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

test("the browser module file does not call require", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "MMM-ButtonMenu.js"),
        "utf8"
    );
    assert.equal(/\brequire\s*\(/.test(source), false);
    assert.match(source, /getScripts\s*\(\)\s*\{/);
    assert.match(source, /lib\/menuState\.js/);
});
