"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createScreenAck } = require("../lib/screenAck");

test("a press with no reply logs that the screen did not answer", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const lines = [];
    const ack = createScreenAck((line) => lines.push(line));

    ack.sent();
    t.mock.timers.tick(999);
    assert.deepEqual(lines, []);
    t.mock.timers.tick(1);
    assert.deepEqual(lines, ["[MMM-ButtonMenu] screen did not answer"]);
    ack.stop();
});

test("an ack before the second cancels the silence log", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const lines = [];
    const ack = createScreenAck((line) => lines.push(line));

    ack.sent();
    ack.answered({ open: true });
    t.mock.timers.tick(1000);
    assert.deepEqual(lines, ["[MMM-ButtonMenu] menu shown"]);
    ack.stop();
});

test("a draw failure is logged and still answers shown or hidden", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const lines = [];
    const ack = createScreenAck((line) => lines.push(line));

    ack.sent();
    ack.answered({ open: false, failure: "document.body is null" });
    t.mock.timers.tick(1000);
    assert.deepEqual(lines, [
        "[MMM-ButtonMenu] menu draw failed: document.body is null",
        "[MMM-ButtonMenu] menu hidden"
    ]);
    ack.stop();
});

test("only the unanswered press is reported", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const lines = [];
    const ack = createScreenAck((line) => lines.push(line));

    ack.sent();
    ack.sent();
    ack.answered({ open: true });
    t.mock.timers.tick(1000);
    assert.deepEqual(lines, [
        "[MMM-ButtonMenu] menu shown",
        "[MMM-ButtonMenu] screen did not answer"
    ]);
    ack.stop();
});
