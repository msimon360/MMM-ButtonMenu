/*
 * DigiFrame page list. Merge these objects into config/config.js.
 *
 * MMM-pages rotation stays off. Page timings advance to the next page,
 * so they are not the return-home timer. MMM-ButtonMenu owns that hold
 * and sends HOME_PAGE when it ends.
 *
 * Keep MMM-ButtonMenu in `fixed` so the menu is drawn on every page.
 */

module.exports = [
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
            fixed: [
                "MMM-ButtonMenu"
                // Keep modules that stay on every page here too, such as "clock".
            ]
        }
    },
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
                { label: "News", pageIndex: 2 },
                { label: "Sports", pageIndex: 3 },
                { label: "Calendar", pageIndex: 4 },
                { label: "Photos", pageIndex: 5 }
            ],
            commands: {
                // Copy the CEC blank and unblank lines from `sudo crontab -l`.
                blank: "",
                unblank: "",
                restart: "pm2 restart mm",
                reboot: "sudo reboot"
            }
        }
    }
];
