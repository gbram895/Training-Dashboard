import Toybox.Communications;
import Toybox.Lang;

// Talks to the same Express API the web dashboard and Apple Watch companion
// use — same JWT bearer auth, same routes. See client/src/api/client.ts for
// the web equivalent.
//
// The URL and token are hardcoded below instead of being Application
// Settings configured through Garmin Connect Mobile, because Garmin Connect
// Mobile only shows a settings screen for apps published to the official
// Connect IQ Store — confirmed against multiple reports on Garmin's own
// developer forum of sideloaded apps' settings.xml/properties.xml being
// silently ignored regardless of how they're built. Since this app is never
// going through the Store, edit the two constants below with your real
// values and rebuild, instead of trying to configure them on-device.
class ApiClient {
    // TODO: replace with your server's URL (no trailing slash).
    private const BASE_URL = "https://training-dashboard-peiv.onrender.com";
    // TODO: replace with the token from the web dashboard's
    // Settings > API access card.
    private const TOKEN = "paste-your-token-here";

    function isConfigured() as Boolean {
        return !TOKEN.equals("paste-your-token-here");
    }

    // responseType Communications.HTTP_RESPONSE_CONTENT_TYPE_FIT tells the
    // system to parse the body as a .fit file and hand back a
    // PersistedContent iterator instead of raw bytes/JSON — this is the
    // documented pattern for downloading a structured workout without ever
    // touching a Garmin account login (see TrainAsONE/trainasone-connectiq,
    // a published Connect IQ app doing the same thing against its own
    // training-plan server).
    function fetchTodayWorkoutFit(callback as Method) as Void {
        var url = BASE_URL + "/api/training-plan/today";
        var params = { "format" => "fit" };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "Authorization" => "Bearer " + TOKEN },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_FIT,
        };
        Communications.makeWebRequest(url, params, options, callback);
    }
}
