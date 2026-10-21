/*
 * DigiFrame page list. Merge these objects into config/config.js.
 *
 * This is for sdetweil/MMM-pages. Rotation stays off with rotationTime 0.
 * That fork has no timings object. MMM-ButtonMenu owns the hold and
 * sends HOME_PAGE when it ends. Page changes use PAGE_CHANGED.
 *
 * Keep MMM-ButtonMenu in `fixed` so the menu is drawn on every page.
 */

module.exports = [
    {
        module: "MMM-pages",
        config: {
            rotationTime: 0,
            rotationHomePage: 0,
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
