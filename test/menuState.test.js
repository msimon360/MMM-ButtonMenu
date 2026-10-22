"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMenu, dispatch } = require("../menuState");

test("menu state is available without require in the browser", () => {
    assert.equal(globalThis.MMMButtonMenuState.createMenu, createMenu);
    assert.equal(globalThis.MMMButtonMenuState.dispatch, dispatch);
});

function sampleConfig() {
    return {
        holdMs: 1000,
        menuTimeoutMs: 5000,
        pages: [
            { label: "Weather", pageIndex: 1 },
            { label: "News", pageIndex: 2, holdMs: 2500 }
        ]
    };
}

function openAt(state, command) {
    let current = dispatch(state, "menu").state;
    const index = current.rows.findIndex((row) => row.command === command);
    assert.ok(index > 0, "missing row " + command);
    for (let i = 0; i < index; i += 1) {
        current = dispatch(current, "next").state;
    }
    assert.equal(current.rows[current.highlight].command, command);
    return current;
}

function visitFirstPage(state) {
    let current = dispatch(state, "menu").state;
    current = dispatch(current, "next").state;
    return dispatch(current, "select");
}

test("starts on the primary page", () => {
    const state = createMenu(sampleConfig());
    assert.equal(state.place, "primary");
    assert.equal(state.pageIndex, 0);
    assert.equal(state.menuOpen, false);
    assert.equal(state.confirming, null);
    assert.equal(state.holdMs, null);
});

test("Menu opens the menu", () => {
    const state = createMenu(sampleConfig());
    const opened = dispatch(state, "menu");
    assert.equal(opened.state.menuOpen, true);
    assert.equal(opened.state.highlight, 0);
    assert.equal(opened.state.place, "primary");
    assert.equal(opened.state.rows[0].label, "Primary");
    assert.equal(opened.state.rows[0].kind, "home");
    assert.deepEqual(
        opened.state.rows.slice(-4).map((row) => row.label),
        ["Blank", "Unblank", "Restart MagicMirror", "Reboot"]
    );
    assert.equal(
        opened.state.rows.find((row) => row.command === "blank").kind,
        "command"
    );
    assert.equal(
        opened.state.rows.find((row) => row.command === "reboot").kind,
        "confirm"
    );
});

test("Next wraps to the top", () => {
    let state = dispatch(createMenu(sampleConfig()), "menu").state;
    const total = state.rows.length;
    assert.ok(total > 1);
    for (let i = 0; i < total; i += 1) {
        const result = dispatch(state, "next");
        state = result.state;
        assert.equal(state.menuOpen, true);
        assert.equal(state.highlight, (i + 1) % total);
    }
    assert.equal(state.highlight, 0);
    assert.equal(state.rows[state.highlight].label, "Primary");
});

test("Select visits a page", () => {
    const result = visitFirstPage(createMenu(sampleConfig()));
    assert.equal(result.state.menuOpen, false);
    assert.equal(result.state.place, "page");
    assert.equal(result.state.pageIndex, 1);
    assert.equal(result.state.holdMs, 1000);
    assert.equal(result.state.holdPaused, false);
    const select = result.effects.find((effect) => effect.name === "PAGE_SELECT");
    assert.ok(select);
    assert.equal(select.payload, 1);
    assert.equal(typeof select.payload, "number");
    assert.ok(result.effects.some((effect) =>
        effect.type === "hold" && effect.action === "start" && effect.ms === 1000
    ));
});

test("hold elapsed sends HOME_PAGE", () => {
    const visit = visitFirstPage(createMenu(sampleConfig()));
    const result = dispatch(visit.state, "holdElapsed");
    assert.equal(result.state.place, "primary");
    assert.equal(result.state.pageIndex, 0);
    assert.equal(result.state.menuOpen, false);
    assert.equal(result.state.holdMs, null);
    assert.ok(result.effects.some((effect) =>
        effect.type === "notification" && effect.name === "HOME_PAGE"
    ));
    assert.equal(
        result.effects.some((effect) => effect.type === "command"),
        false
    );
});

test("second Select confirms reboot", () => {
    const armed = openAt(createMenu(sampleConfig()), "reboot");
    const first = dispatch(armed, "select");
    assert.equal(first.state.confirming, "reboot");
    assert.equal(first.state.menuOpen, true);
    assert.equal(first.effects.some((effect) => effect.type === "command"), false);

    const second = dispatch(first.state, "select");
    assert.equal(second.state.confirming, null);
    assert.equal(second.state.place, "primary");
    assert.ok(second.effects.some((effect) =>
        effect.type === "command" && effect.name === "reboot"
    ));
});

test("Menu cancels confirm", () => {
    const armed = openAt(createMenu(sampleConfig()), "reboot");
    const first = dispatch(armed, "select");
    const cancelled = dispatch(first.state, "menu");
    assert.equal(cancelled.state.confirming, null);
    assert.equal(cancelled.state.menuOpen, false);
    assert.equal(
        cancelled.effects.some((effect) => effect.type === "command"),
        false
    );
});

test("Next does nothing while the menu is hidden", () => {
    const state = createMenu(sampleConfig());
    const result = dispatch(state, "next");
    assert.equal(result.state, state);
    assert.deepEqual(result.effects, []);
    assert.equal(result.state.menuOpen, false);
    assert.equal(result.state.highlight, 0);
    assert.equal(result.state.place, "primary");
});

test("Select does nothing while the menu is hidden", () => {
    const state = createMenu(sampleConfig());
    const result = dispatch(state, "select");
    assert.equal(result.state, state);
    assert.deepEqual(result.effects, []);
});

test("Next leaves the confirm row", () => {
    const armed = openAt(createMenu(sampleConfig()), "reboot");
    const first = dispatch(armed, "select");
    const left = dispatch(first.state, "next");
    assert.equal(left.state.confirming, null);
    assert.equal(left.state.menuOpen, true);
    assert.equal(left.effects.some((effect) => effect.type === "command"), false);
    assert.notEqual(left.state.highlight, first.state.highlight);
});

test("opening the menu pauses the hold and hiding resumes it", () => {
    const visit = visitFirstPage(createMenu(sampleConfig()));
    assert.equal(visit.state.holdPaused, false);

    const opened = dispatch(visit.state, "menu");
    assert.equal(opened.state.menuOpen, true);
    assert.equal(opened.state.holdPaused, true);
    assert.equal(opened.state.place, "page");
    assert.equal(opened.state.pageIndex, 1);
    assert.ok(opened.effects.some((effect) =>
        effect.type === "hold" && effect.action === "pause"
    ));

    const hidden = dispatch(opened.state, "menu");
    assert.equal(hidden.state.menuOpen, false);
    assert.equal(hidden.state.holdPaused, false);
    assert.equal(hidden.state.place, "page");
    assert.equal(hidden.state.pageIndex, 1);
    assert.equal(hidden.effects.some((effect) => effect.name === "HOME_PAGE"), false);
    assert.ok(hidden.effects.some((effect) =>
        effect.type === "hold" && effect.action === "resume"
    ));
});

test("hiding the menu on the primary page leaves the mirror there", () => {
    const opened = dispatch(createMenu(sampleConfig()), "menu");
    const hidden = dispatch(opened.state, "menu");
    assert.equal(hidden.state.menuOpen, false);
    assert.equal(hidden.state.place, "primary");
    assert.equal(hidden.state.pageIndex, 0);
    assert.equal(hidden.effects.some((effect) => effect.name === "HOME_PAGE"), false);
});

test("a page holdMs overrides the default", () => {
    let state = dispatch(createMenu(sampleConfig()), "menu").state;
    state = dispatch(state, "next").state;
    state = dispatch(state, "next").state;
    const result = dispatch(state, "select");
    assert.equal(result.state.pageIndex, 2);
    assert.equal(result.state.holdMs, 2500);
    assert.ok(result.effects.some((effect) =>
        effect.type === "hold" && effect.action === "start" && effect.ms === 2500
    ));
});

test("choosing another page restarts the hold", () => {
    const visit = visitFirstPage(createMenu(sampleConfig()));
    assert.equal(visit.state.holdMs, 1000);
    let state = dispatch(visit.state, "menu").state;
    state = dispatch(state, "next").state;
    state = dispatch(state, "next").state;
    const result = dispatch(state, "select");
    assert.equal(result.state.pageIndex, 2);
    assert.equal(result.state.holdPaused, false);
    assert.equal(result.state.holdMs, 2500);
    assert.ok(result.effects.some((effect) =>
        effect.type === "hold" && effect.action === "start" && effect.ms === 2500
    ));
});

test("a paused hold does not send the mirror home", () => {
    const visit = visitFirstPage(createMenu(sampleConfig()));
    const opened = dispatch(visit.state, "menu");
    const result = dispatch(opened.state, "holdElapsed");
    assert.equal(result.state, opened.state);
    assert.deepEqual(result.effects, []);
});

test("the menu closes itself without a new choice", () => {
    const visit = visitFirstPage(createMenu(sampleConfig()));
    const opened = dispatch(visit.state, "menu");
    const result = dispatch(opened.state, "menuTimeout");
    assert.equal(result.state.menuOpen, false);
    assert.equal(result.state.place, "page");
    assert.equal(result.state.pageIndex, 1);
    assert.equal(result.state.holdPaused, false);
    assert.equal(result.effects.some((effect) => effect.name === "HOME_PAGE"), false);
});

test("Blank runs on the first Select", () => {
    const armed = openAt(createMenu(sampleConfig()), "blank");
    const result = dispatch(armed, "select");
    assert.equal(result.state.confirming, null);
    assert.equal(result.state.menuOpen, false);
    assert.ok(result.effects.some((effect) =>
        effect.type === "command" && effect.name === "blank"
    ));
});

test("alternate pages default to the next page indexes", () => {
    const state = createMenu({
        pages: [
            { label: "Weather" },
            { label: "News" }
        ]
    });
    assert.equal(state.rows[1].pageIndex, 1);
    assert.equal(state.rows[2].pageIndex, 2);
    assert.equal(state.rows[1].holdMs, 60000);
});

test("menu timeout cancels a restart confirmation", () => {
    const armed = openAt(createMenu(sampleConfig()), "restart");
    const first = dispatch(armed, "select");
    assert.equal(first.state.confirming, "restart");
    assert.equal(first.effects.some((effect) => effect.type === "command"), false);
    const result = dispatch(first.state, "menuTimeout");
    assert.equal(result.state.confirming, null);
    assert.equal(result.state.menuOpen, false);
    assert.equal(result.effects.some((effect) => effect.type === "command"), false);
});

test("Primary sends HOME_PAGE immediately", () => {
    const visit = visitFirstPage(createMenu(sampleConfig()));
    const opened = dispatch(visit.state, "menu");
    assert.equal(opened.state.highlight, 0);
    const result = dispatch(opened.state, "select");
    assert.equal(result.state.place, "primary");
    assert.equal(result.state.menuOpen, false);
    assert.equal(result.state.holdMs, null);
    assert.ok(result.effects.some((effect) =>
        effect.type === "notification" && effect.name === "HOME_PAGE"
    ));
    assert.equal(
        result.effects.some((effect) => effect.name === "PAGE_SELECT"),
        false
    );
});
