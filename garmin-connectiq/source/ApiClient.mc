import Toybox.Communications;
import Toybox.Application;
import Toybox.Lang;

// Talks to the same Express API the web dashboard and Apple Watch companion
// use — same JWT bearer auth, same routes. See client/src/api/client.ts for
// the web equivalent. Base URL and token are Application Settings, configured
// through Garmin Connect Mobile's per-app settings screen (see README) —
// there's no login UI here, same reasoning as the Watch app: this is a
// personal single-user app, and Monkey C has no good way to build a text
// login form on a device with no keyboard.
class ApiClient {
    private var _baseUrl as String;
    private var _token as String;

    function initialize() {
        _baseUrl = Properties.getValue("serverBaseUrl") as String;
        _token = Properties.getValue("apiToken") as String;
    }

    function isConfigured() as Boolean {
        return _baseUrl != null && _baseUrl.length() > 0 && _token != null && _token.length() > 0;
    }

    // responseType Communications.HTTP_RESPONSE_CONTENT_TYPE_FIT tells the
    // system to parse the body as a .fit file and hand back a
    // PersistedContent iterator instead of raw bytes/JSON — this is the
    // documented pattern for downloading a structured workout without ever
    // touching a Garmin account login (see TrainAsONE/trainasone-connectiq,
    // a published Connect IQ app doing the same thing against its own
    // training-plan server).
    function fetchTodayWorkoutFit(callback as Method) as Void {
        var url = _baseUrl + "/api/training-plan/today";
        var params = { "format" => "fit" };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "Authorization" => "Bearer " + _token },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_FIT,
        };
        Communications.makeWebRequest(url, params, options, callback);
    }
}
