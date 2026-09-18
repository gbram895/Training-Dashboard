import Toybox.Application;
import Toybox.Lang;

class TrainingDashboardApp extends Application.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() as [Views] or [Views, InputDelegates] {
        var view = new TrainingDashboardView();
        return [view, new TrainingDashboardDelegate(view)];
    }
}
