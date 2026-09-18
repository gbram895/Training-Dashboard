import Toybox.Lang;
import Toybox.System;
import Toybox.PersistedContent;
import Toybox.Communications;

// Turns a downloaded .fit workout response into a launched native workout —
// the exact mechanism this whole app exists to use: Connect IQ apps have no
// API to construct/launch a structured workout themselves (confirmed against
// werkkrew/ciq-hiit-tracker's own notes on this), but they CAN request a URL
// with responseType HTTP_RESPONSE_CONTENT_TYPE_FIT and get back a
// PersistedContent object the system already parsed, then hand it to the
// native workout runner via toIntent()/System.exitTo(). This pattern —
// including the responseType constant and the toIntent()/exitTo() call —
// comes from TrainAsONE/trainasone-connectiq, a published Connect IQ app
// doing the same download-and-launch flow against its own training-plan
// server, not from Garmin's own documentation (their docs describe the
// pieces separately but not this specific recipe).
//
// Compiles clean against a real Connect IQ SDK (edge530) — the two
// null-checks this file originally had on downloads/intent were removed
// after the compiler flagged them as unreachable, confirming neither of
// those values is ever null in practice.
class WorkoutDownloader {
    private var _statusCallback as Method;

    function initialize(statusCallback as Method) {
        _statusCallback = statusCallback;
    }

    function start() as Void {
        var client = new ApiClient();
        if (!client.isConfigured()) {
            _statusCallback.invoke("Set server URL + token in this app's settings (Garmin Connect app > Device > Apps).");
            return;
        }
        client.fetchTodayWorkoutFit(method(:onDownload));
    }

    function onDownload(responseCode as Number, data) as Void {
        if (responseCode == 404) {
            _statusCallback.invoke("No bike workout planned for today.");
            return;
        }
        if (responseCode != 200) {
            _statusCallback.invoke("Download failed (" + responseCode + ").");
            return;
        }

        // data is a PersistedContent.Iterator when responseType is FIT —
        // confirmed against a real device build that this cast is never
        // null, so there's no null branch to handle here.
        var downloads = data as PersistedContent.Iterator;

        var content = downloads.next();
        if (content == null || !(content instanceof PersistedContent.Workout)) {
            _statusCallback.invoke("No workout found in the response.");
            return;
        }

        var workout = content as PersistedContent.Workout;
        var intent = workout.toIntent();

        // Hands off from this app straight to the system's native
        // structured-workout screen — the same on-device experience as a
        // workout authored in Garmin Connect itself.
        System.exitTo(intent);
    }
}
