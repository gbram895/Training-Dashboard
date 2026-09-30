// Training Dashboard — Today's Session widget
// Runs in Scriptable (https://scriptable.app), free on the App Store.
// Setup: see ios-widget/README.md in the Training Dashboard repo.

const APP_URL = "https://training-dashboard-peiv.onrender.com";
const KEYCHAIN_KEY = "training-dashboard-widget-token";

const fm = FileManager.local();
const CACHE_PATH = fm.joinPath(fm.documentsDirectory(), "training-dashboard-widget-cache.json");

function loadCache() {
  try {
    if (fm.fileExists(CACHE_PATH)) return JSON.parse(fm.readString(CACHE_PATH));
  } catch (e) {
    // Corrupt or missing cache is not worth surfacing — just start fresh.
  }
  return null;
}

function saveCache(data) {
  try {
    fm.writeString(CACHE_PATH, JSON.stringify(data));
  } catch (e) {
    // Best effort only — a failed cache write shouldn't break the widget.
  }
}

// Outside the app's 7am-11pm awake window (see server/src/index.ts) the
// backend is asleep and can take the best part of a minute to cold-start,
// well past what a WidgetKit refresh will wait around for. Falling back to
// the last successful pull beats a bare "Network error" tile overnight.
function withCacheFallback(message) {
  const cached = loadCache();
  if (cached) return { ...cached, stale: true, staleMessage: message };
  return { error: message };
}

async function promptForToken() {
  const alert = new Alert();
  alert.title = "Training Dashboard";
  alert.message = "Paste the widget token from the app: Settings → Widget → Generate widget token.";
  alert.addTextField("Widget token", Keychain.contains(KEYCHAIN_KEY) ? Keychain.get(KEYCHAIN_KEY) : "");
  alert.addAction("Save");
  alert.addCancelAction("Cancel");
  const idx = await alert.present();
  if (idx !== 0) return;
  const value = alert.textFieldValue(0).trim();
  if (value) Keychain.set(KEYCHAIN_KEY, value);
}

async function fetchToday() {
  if (!Keychain.contains(KEYCHAIN_KEY)) return { needsSetup: true };

  const req = new Request(`${APP_URL}/api/widget/today`);
  req.headers = { Authorization: `Bearer ${Keychain.get(KEYCHAIN_KEY)}` };
  req.timeoutInterval = 25;

  try {
    const data = await req.loadJSON();
    const status = req.response.statusCode;
    if (status === 200) {
      saveCache(data);
      return data;
    }
    if (status === 401) return { error: "Token expired — regenerate in Settings" };
    return withCacheFallback(`Server error (${status})`);
  } catch (e) {
    return withCacheFallback("Server is waking up — showing last known plan");
  }
}

const ZONE_COLORS = {
  ENDURANCE: new Color("#4a90d9"),
  TEMPO: new Color("#4caf7d"),
  THRESHOLD: new Color("#e8b93a"),
  VO2MAX: new Color("#d9534f"),
};

function addStat(row, value, label) {
  const col = row.addStack();
  col.layoutVertically();
  const v = col.addText(value);
  v.font = Font.semiboldSystemFont(15);
  v.textColor = Color.white();
  const l = col.addText(label);
  l.font = Font.systemFont(10);
  l.textColor = new Color("#8e8e93");
}

function buildWidget(data) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#1c1c1e");
  widget.setPadding(14, 14, 14, 14);
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

  const header = widget.addText("TODAY");
  header.font = Font.boldSystemFont(11);
  header.textColor = new Color("#8e8e93");
  widget.addSpacer(6);

  if (data.needsSetup) {
    const msg = widget.addText("Tap to set up");
    msg.font = Font.mediumSystemFont(15);
    msg.textColor = Color.white();
    widget.url = URLScheme.forRunningScript();
    return widget;
  }

  if (data.error) {
    const msg = widget.addText(data.error);
    msg.font = Font.mediumSystemFont(13);
    msg.textColor = new Color("#ff6961");
    widget.url = URLScheme.forRunningScript();
    return widget;
  }

  widget.url = APP_URL;

  if (!data.hasPlan || data.isRestDay) {
    const msg = widget.addText(data.isRestDay ? data.restReason || "Rest day" : "No plan yet");
    msg.font = Font.mediumSystemFont(15);
    msg.textColor = Color.white();
    return widget;
  }

  const name = widget.addText(data.name || (data.discipline === "BIKE" ? "Bike" : "Run"));
  name.font = Font.boldSystemFont(17);
  name.textColor = Color.white();
  name.minimumScaleFactor = 0.7;

  if (data.category && ZONE_COLORS[data.category]) {
    widget.addSpacer(4);
    const badge = widget.addText(data.category);
    badge.font = Font.boldSystemFont(11);
    badge.textColor = ZONE_COLORS[data.category];
  }

  widget.addSpacer(8);
  const row = widget.addStack();
  row.layoutHorizontally();
  row.spacing = 16;
  if (data.durationMin != null) addStat(row, `${data.durationMin}m`, "Duration");
  if (data.intensity != null) addStat(row, `${data.intensity}/5`, "Intensity");

  if (data.stale) {
    widget.addSpacer(6);
    const note = widget.addText(data.staleMessage || "Showing last known plan");
    note.font = Font.systemFont(9);
    note.textColor = new Color("#8e8e93");
  }

  return widget;
}

if (config.runsInWidget) {
  const widget = buildWidget(await fetchToday());
  Script.setWidget(widget);
  Script.complete();
} else {
  await promptForToken();
  const widget = buildWidget(await fetchToday());
  await widget.presentMedium();
  Script.complete();
}
