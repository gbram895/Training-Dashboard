import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;

class TrainingDashboardView extends WatchUi.View {
    private var _status as String = "Press SELECT to send\ntoday's workout to\nthis device.";

    function initialize() {
        View.initialize();
    }

    function setStatus(text as String) as Void {
        _status = text;
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.drawText(
            dc.getWidth() / 2,
            dc.getHeight() / 2,
            Graphics.FONT_SMALL,
            _status,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );
    }
}
