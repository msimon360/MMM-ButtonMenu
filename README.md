# MMM-ButtonMenu

A [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) module for a three-button DigiFrame menu. Menu, Next, and Select pick another [MMM-pages](https://github.com/edward-shen/MMM-pages) page, show it for a configured time, then return to the primary page.

The mirror rests on the primary page. MMM-pages rotation stays off. This module owns the hold timer and sends `HOME_PAGE` when it ends.

No `npm install` is required. GPIO is read with Debian’s `gpiomon` (libgpiod 2.2). There is no onoff, pigpio, or sysfs dependency.

## Installation

MagicMirror loads a module by its folder name. Clone this repo so the folder is `MMM-ButtonMenu`:

```bash
cd ~/MagicMirror/modules
git clone https://github.com/msimon360/MMM-ButtonMenu MMM-ButtonMenu
```

The folder name has to be `MMM-ButtonMenu`, which is the name MagicMirror loads.

Restart MagicMirror after adding the module (`pm2 restart mm` or your usual command).

Put `MMM-ButtonMenu` in the MMM-pages `fixed` list. See [examples/pages-config.js](examples/pages-config.js). The open menu is attached to the page itself, outside the module wrapper, because MMM-pages hides modules that are not in `fixed` and that also hides a `position: fixed` child.

## Wiring

Power the Pi off before any wire touches the header. Pin 1 is the square pad at the corner of the 40-pin header nearest the USB-C power connector. These four pins sit in one column:

| Physical pin | BCM | Role |
|---|---|---|
| 9 | GND | Common wire |
| 11 | GPIO 17 | Menu |
| 13 | GPIO 27 | Next |
| 15 | GPIO 22 | Select |

Leave 5V empty. Physical pins 2 and 4 are 5V. Never connect these switches to 5V. The switches only connect a GPIO pin to ground.

The board is three normally-open switches on one common wire. Find that wire with a meter before it is plugged in. It is the only wire that beeps to each of the other three while that button is held. Label the four wires, then use female jumper leads onto the header.

This repo does not attach those wires. `scripts/check-buttons.sh` prints the same pin map and the `gpiomon` commands. On a machine without GPIO it still exits 0.

The module enables the internal pull-up, so a press reads low.

## gpiomon test

Debian 13’s `gpiomon` (libgpiod 2.2) takes the chip as `-c` / `--chip`, not as a positional argument. The 40-pin header is the chip labeled `pinctrl-rp1`. On this Pi 5 that is `gpiochip0`.

Confirm it with `gpiodetect`, then watch one pin:

```bash
gpiomon -c gpiochip0 -b pull-up -p 50ms 17
```

Press Menu. A press prints `falling`. Repeat for 27 and 22. Swap the three GPIO roles in config if a button lands on the wrong action.

The module starts that same command once per pin (Menu 17, Next 27, Select 22). A falling line from a pin’s own process is that button. The chip stays `gpiochip0`.

## Button behavior

- **Menu** (BCM 17): show the menu, or hide it. Opening starts on Primary and pauses the return-home timer. Hiding it without a new choice resumes that timer. On the primary page, hiding the menu leaves the mirror where it is.
- **Next** (BCM 27): move the highlight to the next row, wrapping to the top. While the menu is hidden, Next does nothing. Next also leaves a restart or reboot confirmation without running it.
- **Select** (BCM 22): run the highlighted row. While the menu is hidden, Select does nothing.

The first row is **Primary**, which sends `HOME_PAGE` immediately. The next rows are the alternate pages. Select sends `PAGE_SELECT` with that page’s index (an integer) and starts that page’s hold timer. Choosing another page restarts the timer with the new hold.

edward-shen/MMM-pages changes the screen only when that integer is from 0 through `modules.length - 1`. Any other index is ignored, so the menu still closes and the display stays put. The row after two Next presses is the second `pages` entry. Its payload is that entry’s `pageIndex`, or `2` when `pageIndex` is omitted. That slot in `modules` has to be an array of module names.

System rows stay at the bottom: Blank, Unblank, Restart MagicMirror, and Reboot. Blank and Unblank run on the first Select. Restart and Reboot ask for a second Select. Menu cancels that confirmation.

The menu closes itself after `menuTimeoutMs` with no press. That hides the menu the same way the Menu button does, and it cancels a pending restart or reboot.

## Configuration

```js
{
  module: "MMM-ButtonMenu",
  position: "fullscreen_above",
  config: {
    gpioChip: "gpiochip0",
    pins: {
      menu: 17,
      next: 27,
      select: 22
    },
    debounceMs: 50,
    holdMs: 60 * 1000,
    menuTimeoutMs: 8 * 1000,
    pages: [
      { label: "Weather", pageIndex: 1 },
      { label: "News", pageIndex: 2, holdMs: 120000 }
    ],
    commands: {
      blank: "",
      unblank: "",
      restart: "pm2 restart mm",
      reboot: "sudo reboot"
    }
  }
}
```

| Option | Default | Description |
|---|---|---|
| `gpioChip` | `gpiochip0` | Chip passed to `gpiomon -c`. The header chip is the one `gpiodetect` labels `pinctrl-rp1`. |
| `pins.menu` | `17` | BCM pin for Menu |
| `pins.next` | `27` | BCM pin for Next |
| `pins.select` | `22` | BCM pin for Select |
| `debounceMs` | `50` | Hardware debounce passed to `gpiomon -p`, and a second window in the helper |
| `holdMs` | `60000` | How long an alternate page stays up before `HOME_PAGE` |
| `menuTimeoutMs` | `8000` | Close the menu after this long with no press |
| `homePage` | `0` | Page index treated as primary |
| `pages` | `[]` | Alternate rows: `{ label, pageIndex, holdMs }`. `pageIndex` is the 0-based MMM-pages index. Home is 0 and is not in this list, so the default for the first entry is 1, then 2. The third menu row sends `PAGE_SELECT 2`. `holdMs` overrides the default for that page. |
| `commands.blank` | `""` | CEC blank command. Copy it from `sudo crontab -l`. Empty commands are not run. |
| `commands.unblank` | `""` | CEC unblank command. Copy it from `sudo crontab -l`. |
| `commands.restart` | `pm2 restart mm` | Run only after a second Select on Restart MagicMirror |
| `commands.reboot` | `sudo reboot` | Run only after a second Select on Reboot |

Blank, unblank, restart, and reboot run only after the on-screen menu confirms them (restart and reboot need the second Select). The unit tests never execute those commands.

## Turn rotation off

MMM-pages page timings advance to the next page. They are not used to return home. In `config.js`, turn automatic rotation off and keep today’s layout as page 0:

```js
{
  module: "MMM-pages",
  config: {
    timings: {
      default: 0
    },
    rotationHomePage: 0,
    rotationHomePageHidden: 0,
    homePage: 0,
    modules: [
      [], // today's layout
      [], // Weather
      [], // News
      [], // Sports
      [], // Calendar
      [] // Photos
    ],
    fixed: ["MMM-ButtonMenu"]
  }
}
```

Leave every per-page `timings` entry unset or at `0`. A positive page timing still rotates that page. `examples/pages-config.js` is the same block, plus the button menu.

While an alternate page is up, this module also sends `PAUSE_ROTATION`. Returning home sends `RESUME_ROTATION`. With the timings above, rotation was never running.

## Tests

```bash
npm test
```

That runs `node --test`. The tests cover the menu state machine only. They do not open GPIO devices and they do not run blank, unblank, restart, or reboot.
