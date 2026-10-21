"use strict";

/*
 * Pure menu state. No DOM and no GPIO.
 * The mirror rests on the primary page. This machine owns the hold
 * and tells the caller when to send HOME_PAGE.
 */

const SYSTEM_ROWS = [
    { label: "Blank", kind: "command", command: "blank" },
    { label: "Unblank", kind: "command", command: "unblank" },
    { label: "Restart MagicMirror", kind: "confirm", command: "restart" },
    { label: "Reboot", kind: "confirm", command: "reboot" }
];

function numberOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : fallback;
}

function normalizeConfig(config) {
    const source = config || {};
    const holdMs = numberOr(source.holdMs, 60000);
    const pages = [];
    const configured = Array.isArray(source.pages) ? source.pages : [];

    configured.forEach((page, index) => {
        if (!page || typeof page !== "object") {
            return;
        }
        pages.push({
            label: page.label || ("Page " + (index + 1)),
            pageIndex: Number.isInteger(page.pageIndex)
                ? page.pageIndex
                : index + 1,
            holdMs: page.holdMs == null ? holdMs : page.holdMs
        });
    });

    return {
        holdMs: holdMs,
        menuTimeoutMs: numberOr(source.menuTimeoutMs, 8000),
        homePage: numberOr(source.homePage, 0),
        pages: pages
    };
}

function buildRows(config) {
    const rows = [
        { label: "Primary", kind: "home" }
    ];

    config.pages.forEach((page) => {
        rows.push({
            label: page.label,
            kind: "page",
            pageIndex: page.pageIndex,
            holdMs: page.holdMs
        });
    });

    SYSTEM_ROWS.forEach((row) => {
        rows.push({
            label: row.label,
            kind: row.kind,
            command: row.command
        });
    });

    return rows;
}

function createMenu(config) {
    const normalized = normalizeConfig(config);
    return {
        place: "primary",
        pageIndex: normalized.homePage,
        menuOpen: false,
        highlight: 0,
        confirming: null,
        holdPaused: false,
        holdMs: null,
        rows: buildRows(normalized),
        config: normalized
    };
}

function cloneState(state) {
    return {
        place: state.place,
        pageIndex: state.pageIndex,
        menuOpen: state.menuOpen,
        highlight: state.highlight,
        confirming: state.confirming,
        holdPaused: state.holdPaused,
        holdMs: state.holdMs,
        rows: state.rows,
        config: state.config
    };
}

function menuTimer(state) {
    return {
        type: "menuTimer",
        action: "start",
        ms: state.config.menuTimeoutMs
    };
}

function openMenu(state, effects) {
    state.menuOpen = true;
    state.confirming = null;
    state.highlight = 0;
    if (state.place === "page" && state.holdMs > 0) {
        state.holdPaused = true;
        effects.push({ type: "hold", action: "pause" });
    }
    effects.push(menuTimer(state));
}

function closeMenu(state, effects) {
    state.menuOpen = false;
    state.confirming = null;
    effects.push({ type: "menuTimer", action: "clear" });
    if (state.place === "page" && state.holdMs > 0 && state.holdPaused) {
        state.holdPaused = false;
        effects.push({ type: "hold", action: "resume" });
    }
}

function goHome(state, effects) {
    const wasAway = state.place === "page";
    state.place = "primary";
    state.pageIndex = state.config.homePage;
    state.menuOpen = false;
    state.confirming = null;
    state.holdPaused = false;
    state.holdMs = null;
    effects.push({ type: "menuTimer", action: "clear" });
    effects.push({ type: "hold", action: "clear" });
    effects.push({ type: "notification", name: "HOME_PAGE" });
    if (wasAway) {
        effects.push({ type: "notification", name: "RESUME_ROTATION" });
    }
}

function selectRow(state) {
    const next = cloneState(state);
    const effects = [];
    const row = next.rows[next.highlight];

    if (!row) {
        return { state: state, effects: effects };
    }

    if (row.kind === "confirm") {
        if (next.confirming === row.command) {
            effects.push({ type: "command", name: row.command });
            goHome(next, effects);
            return { state: next, effects: effects };
        }
        next.confirming = row.command;
        effects.push(menuTimer(next));
        return { state: next, effects: effects };
    }

    if (row.kind === "command") {
        effects.push({ type: "command", name: row.command });
        closeMenu(next, effects);
        return { state: next, effects: effects };
    }

    if (row.kind === "home") {
        goHome(next, effects);
        return { state: next, effects: effects };
    }

    if (row.kind === "page") {
        next.menuOpen = false;
        next.confirming = null;
        next.holdPaused = false;
        next.place = "page";
        next.pageIndex = row.pageIndex;
        next.holdMs = row.holdMs;
        effects.push({ type: "menuTimer", action: "clear" });
        effects.push({
            type: "notification",
            name: "PAGE_SELECT",
            payload: row.pageIndex
        });
        effects.push({ type: "notification", name: "PAUSE_ROTATION" });
        if (row.holdMs > 0) {
            effects.push({
                type: "hold",
                action: "start",
                ms: row.holdMs
            });
        } else {
            effects.push({ type: "hold", action: "clear" });
        }
        return { state: next, effects: effects };
    }

    return { state: state, effects: [] };
}

function dispatch(state, event) {
    const type = typeof event === "string" ? event : event && event.type;

    if (!state || !type) {
        return { state: state, effects: [] };
    }

    if ((type === "next" || type === "select") && !state.menuOpen) {
        return { state: state, effects: [] };
    }

    if (type === "holdElapsed") {
        if (
            state.place !== "page" ||
            state.holdPaused ||
            state.menuOpen ||
            !(state.holdMs > 0)
        ) {
            return { state: state, effects: [] };
        }
        const next = cloneState(state);
        const effects = [];
        goHome(next, effects);
        return { state: next, effects: effects };
    }

    if (type === "menuTimeout") {
        if (!state.menuOpen) {
            return { state: state, effects: [] };
        }
        const next = cloneState(state);
        const effects = [];
        closeMenu(next, effects);
        return { state: next, effects: effects };
    }

    if (type === "menu") {
        const next = cloneState(state);
        const effects = [];
        if (state.menuOpen) {
            closeMenu(next, effects);
        } else {
            openMenu(next, effects);
        }
        return { state: next, effects: effects };
    }

    if (type === "next") {
        const next = cloneState(state);
        const effects = [];
        next.confirming = null;
        const count = next.rows.length || 1;
        next.highlight = (next.highlight + 1) % count;
        effects.push(menuTimer(next));
        return { state: next, effects: effects };
    }

    if (type === "select") {
        return selectRow(state);
    }

    return { state: state, effects: [] };
}

module.exports = {
    createMenu: createMenu,
    dispatch: dispatch
};
