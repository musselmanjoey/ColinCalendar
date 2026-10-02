/* MagicMirror config for the wall calendar.
 * This is a TEMPLATE: render-config.js fills in the calendar list and weather location
 * from wallcal.env and writes the result to ~/MagicMirror/config/config.js.
 * Edit layout here; edit feeds and settings in wallcal.env.
 */
let config = {
	address: "localhost",
	port: 8080,
	ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"],

	language: "en",
	locale: "en-US",
	timeFormat: 12,
	units: "imperial",

	modules: [
		{
			module: "clock",
			position: "top_left",
			config: {
				displaySeconds: false,
				showPeriodUpper: true,
				dateFormat: "dddd, MMMM D"
			}
		},
		{
			module: "weather",
			position: "top_right",
			config: {
				weatherProvider: "openmeteo",
				type: "current",
				lat: __LAT__,
				lon: __LON__
			}
		},
		{
			module: "weather",
			position: "top_right",
			config: {
				weatherProvider: "openmeteo",
				type: "forecast",
				lat: __LAT__,
				lon: __LON__,
				maxNumberOfDays: 5,
				fade: false
			}
		},
		{
			// No position: fetches the feeds and broadcasts CALENDAR_EVENTS,
			// which MMM-CalendarExt3 draws. Nothing from this module is shown.
			module: "calendar",
			config: {
				broadcastPastEvents: true,
				maximumEntries: 200,
				maximumNumberOfDays: 60,
				fetchInterval: 5 * 60 * 1000,
				calendars: __CALENDARS__
			}
		},
		{
			module: "MMM-CalendarExt3",
			position: "bottom_bar",
			config: {
				mode: "month",
				instanceId: "wallMonth",
				locale: "en-US",
				firstDayOfWeek: 0,
				maxEventLines: 5,
				useMarquee: false,
				refreshInterval: 10 * 60 * 1000
			}
		}
	]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
