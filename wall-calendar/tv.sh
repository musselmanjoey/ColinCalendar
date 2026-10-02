#!/usr/bin/env bash
# Controls the TV over HDMI-CEC. Installed by setup.sh as /usr/local/bin/wallcal-tv.
#
#   wallcal-tv init     register the Pi as a playback device (run at boot)
#   wallcal-tv on       wake the TV and switch it to the Pi's input
#   wallcal-tv off      put the TV in standby
#   wallcal-tv status   print the TV's power state
#
# The Pi must be plugged into HDMI0 (the micro-HDMI port next to USB-C power),
# which is /dev/cec0. Override with CEC_DEV=/dev/cec1.
set -euo pipefail

DEV="${CEC_DEV:-/dev/cec0}"
CEC="cec-ctl -d $DEV"

phys_addr() {
	# "Physical Address           : 1.0.0.0" -> 1.0.0.0
	$CEC 2>/dev/null | awk -F': ' '/Physical Address/ {print $2; exit}' | tr -d ' '
}

init() {
	$CEC --playback --osd-name WallCal >/dev/null
	echo "Registered on $DEV as playback device, physical address $(phys_addr)"
}

on() {
	$CEC --to 0 --image-view-on >/dev/null
	sleep 3
	local pa
	pa="$(phys_addr)"
	if [[ -z "$pa" || "$pa" == "f.f.f.f" ]]; then
		# Physical address is read from the TV, so it's invalid while the TV was off.
		init >/dev/null
		pa="$(phys_addr)"
	fi
	$CEC --to 15 --active-source "phys-addr=$pa" >/dev/null
	echo "TV on, switched to $pa"
}

off() {
	$CEC --to 0 --standby >/dev/null
	echo "TV standby"
}

status() {
	echo "CEC device: $DEV, Pi physical address: $(phys_addr)"
	$CEC --to 0 --give-device-power-status 2>&1 | grep -i 'pwr-state' || echo "No power-status reply from TV"
}

case "${1:-}" in
	init) init ;;
	on) on ;;
	off) off ;;
	status) status ;;
	*) echo "usage: wallcal-tv {init|on|off|status}" >&2; exit 2 ;;
esac
