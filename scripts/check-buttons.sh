#!/usr/bin/env bash
# Print DigiFrame button wiring and the gpiomon commands.
# Missing GPIO tools are not an error. This script does not touch the header.

echo "DigiFrame three-button wiring"
echo
echo "Power the Pi off before any wire touches the header."
echo "Pin 1 is the square pad at the corner nearest the USB-C power connector."
echo "These four pins sit in one column:"
echo
echo "  Physical pin 9   GND          common wire"
echo "  Physical pin 11  BCM GPIO 17  Menu"
echo "  Physical pin 13  BCM GPIO 27  Next"
echo "  Physical pin 15  BCM GPIO 22  Select"
echo
echo "Leave 5V empty. Physical pins 2 and 4 are 5V. Never connect these switches to 5V."
echo "The switches only connect a GPIO pin to ground."
echo
echo "Find the common wire with a meter before it is plugged in."
echo "It is the only wire that beeps to each of the other three while that button is held."
echo
echo "gpiomon commands (libgpiod 2.2: the chip is --chip, not a positional argument):"
echo
echo "  gpiomon --chip=gpiochip0 --bias=pull-up --edges=both 17"
echo "  gpiomon --chip=gpiochip0 --bias=pull-up --edges=both 27"
echo "  gpiomon --chip=gpiochip0 --bias=pull-up --edges=both 22"
echo
echo "The module watches all three pins with:"
echo
echo "  gpiomon --chip=gpiochip0 --bias=pull-up --edges=both 17 27 22"
echo

if command -v gpiodetect >/dev/null 2>&1; then
    echo "gpiodetect:"
    gpiodetect || true
    echo
    echo "The 40-pin header is the chip labeled pinctrl-rp1."
    echo "On this Pi 5 that chip is gpiochip0. Use that name after --chip."
else
    echo "gpiodetect is not available on this machine, so no GPIO chips are listed."
    echo "On the Pi, install the gpiod package and run gpiodetect."
    echo "The 40-pin header is the chip labeled pinctrl-rp1 (gpiochip0 on this Pi 5)."
fi

exit 0
