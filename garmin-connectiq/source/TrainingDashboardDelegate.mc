import Toybox.WatchUi;
import Toybox.Lang;

class TrainingDashboardDelegate extends WatchUi.BehaviorDelegate {
    private var _view as TrainingDashboardView;
    private var _downloader as WorkoutDownloader;

    function initialize(view as TrainingDashboardView) {
        BehaviorDelegate.initialize();
        _view = view;
        _downloader = new WorkoutDownloader(method(:onStatus));
    }

    function onSelect() as Boolean {
        _view.setStatus("Fetching today's workout...");
        _downloader.start();
        return true;
    }

    function onStatus(text as String) as Void {
        _view.setStatus(text);
    }
}
