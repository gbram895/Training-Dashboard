// Training Dashboard — Lock Screen widget
// Today's planned session plus its workout profile, for the iPhone Lock
// Screen. Runs in Scriptable (https://scriptable.app), free on the App Store.
//
// Companion to TrainingDashboardWidget.js (the Home Screen tile). It reads the
// same widget token out of the same Keychain entry, so if the Home Screen
// widget is already set up there is nothing to paste — add this script, add
// the Lock Screen widget, done.
//
// Supports all three Lock Screen families:
//   accessoryRectangular — session name, duration/zone, and the profile chart
//   accessoryCircular    — duration in a ring, brightness set by zone
//   accessoryInline      — one line above the clock
//
// Setup: see ios-widget/README-lockscreen.md.

const APP_URL = "https://training-dashboard-peiv.onrender.com";
// Deliberately the same key the Home Screen widget uses — Keychain is shared
// across all Scriptable scripts, so both widgets ride on one token and one
// rotation.
const KEYCHAIN_KEY = "training-dashboard-widget-token";

// The Lock Screen renders accessory widgets monochrome: iOS desaturates
// everything and applies its own vibrancy, so the app's zone hexes
// (--chart-z1..z5) would all collapse to roughly the same grey. Intensity is
// carried by brightness instead — a VO2max block is opaque white, a recovery
// block is a faint wash — which survives the treatment and preserves the same
// "harder = louder" reading the colored chart has in the app.
const ZONE_ALPHA = [0.3, 0.46, 0.62, 0.8, 1.0];
const ZONE_LABELS = ["Recovery", "Endurance", "Tempo", "Threshold", "VO2max"];

const CATEGORY_LABELS = {
  ENDURANCE: "Endurance",
  TEMPO: "Tempo",
  THRESHOLD: "Threshold",
  VO2MAX: "VO2max",
};

// Mirrors WIDTH_POWER in client/src/components/WorkoutProfileChart.tsx — see
// the long comment there for why bar widths are duration^0.75 rather than
// linear. Kept identical so the Lock Screen profile and the one in the app
// are the same shape.
const WIDTH_POWER = 0.75;

const fm = FileManager.local();
const CACHE_PATH = fm.joinPath(fm.documentsDirectory(), "training-dashboard-lockscreen-cache.json");

// ---- data ---------------------------------------------------------------

function loadCache() {
  try {
    if (fm.fileExists(CACHE_PATH)) return JSON.parse(fm.readString(CACHE_PATH));
  } catch (e) {
    // Corrupt or unreadable cache is not worth surfacing — start fresh.
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

// Outside the app's 7am-11pm awake window (see server/src/index.ts) Render is
// asleep and cold-starts slower than a WidgetKit refresh will wait. The Lock
// Screen is exactly where a bare error tile is most annoying, so fall back to
// the last successful pull — and only call it stale if it isn't from today.
function withCacheFallback() {
  const cached = loadCache();
  if (cached) return { ...cached, stale: cached.date !== todayISO() };
  return { error: "No data yet" };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function promptForToken() {
  const alert = new Alert();
  alert.title = "Training Dashboard";
  alert.message = Keychain.contains(KEYCHAIN_KEY)
    ? "A widget token is already saved (shared with the Home Screen widget). Replace it only if you have generated a new one."
    : "Paste the widget token from the app: Settings → Widget → Generate widget token.";
  alert.addTextField("Widget token", Keychain.contains(KEYCHAIN_KEY) ? Keychain.get(KEYCHAIN_KEY) : "");
  alert.addAction("Save");
  alert.addCancelAction("Cancel");
  const idx = await alert.present();
  if (idx !== 0) return;
  const value = alert.textFieldValue(0).trim();
  if (value) Keychain.set(KEYCHAIN_KEY, value);
}

// /api/widget/today is deliberately segment-free (a Home Screen tile has no
// room for a profile), so this pulls the full planned day instead. The widget
// token authenticates the same way there — requireAuth doesn't distinguish it
// from a session token.
async function fetchToday() {
  if (!Keychain.contains(KEYCHAIN_KEY)) return { needsSetup: true };

  const req = new Request(`${APP_URL}/api/training-plan/today`);
  req.headers = { Authorization: `Bearer ${Keychain.get(KEYCHAIN_KEY)}` };
  // Shorter than the Home Screen widget's 25s: Lock Screen refreshes are on a
  // tighter leash, and the cache fallback below is a better outcome than
  // being killed mid-request.
  req.timeoutInterval = 15;

  try {
    const body = await req.loadJSON();
    const status = req.response.statusCode;
    if (status === 200) {
      // The endpoint answers `null` when there is no plan config yet or no row
      // for today — a valid answer, not an error.
      const data = body
        ? { ...body, date: todayISO() }
        : { hasPlan: false, date: todayISO() };
      saveCache(data);
      return data;
    }
    if (status === 401) return { error: "Token expired" };
    return withCacheFallback();
  } catch (e) {
    return withCacheFallback();
  }
}

// ---- zones --------------------------------------------------------------

// Mirrors zoneIntensity in client/src/lib/trainingZones.ts: power and pace are
// zoned on the middle of the prescribed range, heart rate on the top of it.
function zoneIntensity(segment) {
  if (segment.targetMetric === "hr") {
    return segment.intensityHigh ?? segment.intensityFraction ?? 0;
  }
  return segment.intensityFraction ?? segment.intensityHigh ?? 0;
}

// Same cutoffs as getTrainingZone in client/src/lib/trainingZones.ts.
function zoneIndex(intensityFraction) {
  if (intensityFraction <= 0.55) return 0;
  if (intensityFraction <= 0.75) return 1;
  if (intensityFraction <= 0.9) return 2;
  if (intensityFraction <= 1.05) return 3;
  return 4;
}

function hasTarget(segment) {
  return segment.intensityFraction != null || segment.intensityHigh != null;
}

// ---- formatting ---------------------------------------------------------

function formatDuration(min) {
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function shortDuration(min) {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}:${String(m).padStart(2, "0")}`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function sessionName(data) {
  return data.name || (data.discipline === "RUN" ? "Run" : "Ride");
}

function zoneLabel(data) {
  if (data.category && CATEGORY_LABELS[data.category]) return CATEGORY_LABELS[data.category];
  // Fall back to zoning the hardest segment when the server hasn't stored a
  // category (older planned days predate the field).
  const segments = usableSegments(data);
  if (!segments.length) return null;
  const peak = Math.max(...segments.filter(hasTarget).map(zoneIntensity), 0);
  return peak > 0 ? ZONE_LABELS[zoneIndex(peak)] : null;
}

function usableSegments(data) {
  if (!Array.isArray(data.segments)) return [];
  return data.segments.filter((s) => s && typeof s.durationSec === "number" && s.durationSec > 0);
}

function symbolFor(data) {
  return data.discipline === "RUN" ? "figure.run" : "bicycle";
}

// ---- drawing ------------------------------------------------------------

function addIcon(container, symbolName, size, alpha) {
  const symbol = SFSymbol.named(symbolName);
  symbol.applyFont(Font.systemFont(size));
  const img = container.addImage(symbol.image);
  img.imageSize = new Size(size, size);
  img.tintColor = new Color("#ffffff", alpha ?? 1);
  return img;
}

// The app's WorkoutProfileChart, redrawn for a monochrome accessory: bar width
// is duration^0.75 (see WIDTH_POWER), bar height is intensity relative to the
// session's own peak, and bar brightness is the training zone. Untargeted
// blocks (rests, transitions) render as a short faint stub, the way the chart
// renders them in --border grey.
function buildProfileImage(segments, width, height) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const weights = segments.map((s) => Math.pow(s.durationSec, WIDTH_POWER));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return null;

  const levels = segments.map(zoneIntensity);
  const maxLevel = Math.max(1, ...levels);
  const baseline = Math.max(2, height * 0.16);
  const gap = 1;

  let x = 0;
  segments.forEach((segment, i) => {
    const slot = (weights[i] / totalWeight) * width;
    const targeted = hasTarget(segment);
    const barHeight = targeted ? Math.max(baseline, (levels[i] / maxLevel) * height) : baseline;
    const alpha = targeted ? ZONE_ALPHA[zoneIndex(levels[i])] : 0.22;

    // Reserve the gap out of the slot rather than shrinking below 1pt — a
    // sub-point bar disappears entirely once the screen scale is applied.
    const barWidth = Math.max(1, slot - gap);
    const radius = Math.min(1.5, barWidth / 2, barHeight / 2);

    ctx.setFillColor(new Color("#ffffff", alpha));
    const path = new Path();
    path.addRoundedRect(new Rect(x, height - barHeight, barWidth, barHeight), radius, radius);
    ctx.addPath(path);
    ctx.fillPath();

    x += slot;
  });

  return ctx.getImage();
}

function addProfile(container, data, width, height) {
  const segments = usableSegments(data);
  if (!segments.length) return false;
  try {
    const img = buildProfileImage(segments, width, height);
    if (!img) return false;
    const view = container.addImage(img);
    view.imageSize = new Size(width, height);
    return true;
  } catch (e) {
    // Any DrawContext API mismatch degrades to no chart rather than a crashed
    // widget — the name and duration above it still render.
    return false;
  }
}

// ---- families -----------------------------------------------------------

function addRestOrEmpty(widget, data, family) {
  const title = widget.addText(data.isRestDay ? "Rest day" : "No plan yet");
  title.font = Font.semiboldSystemFont(family === "accessoryCircular" ? 11 : 14);
  title.textColor = Color.white();
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.7;

  if (family === "accessoryRectangular" && data.isRestDay && data.restReason) {
    const sub = widget.addText(data.restReason);
    sub.font = Font.systemFont(11);
    sub.textColor = new Color("#ffffff", 0.7);
    sub.lineLimit = 2;
    sub.minimumScaleFactor = 0.8;
  }
}

function buildRectangular(data) {
  const widget = new ListWidget();
  widget.setPadding(0, 2, 0, 2);

  if (data.needsSetup || data.error) {
    const t = widget.addText(data.needsSetup ? "Tap to set up" : data.error);
    t.font = Font.semiboldSystemFont(13);
    t.textColor = Color.white();
    t.lineLimit = 2;
    return widget;
  }

  if (!data.hasPlan && !data.name && !data.isRestDay) {
    addRestOrEmpty(widget, { isRestDay: false }, "accessoryRectangular");
    return widget;
  }
  if (data.isRestDay) {
    addRestOrEmpty(widget, data, "accessoryRectangular");
    return widget;
  }

  const title = widget.addText(sessionName(data));
  title.font = Font.semiboldSystemFont(14);
  title.textColor = Color.white();
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.7;

  widget.addSpacer(1);

  const meta = widget.addStack();
  meta.layoutHorizontally();
  meta.centerAlignContent();
  addIcon(meta, data.stale ? "clock.arrow.circlepath" : symbolFor(data), 10, 0.75);

  const bits = [formatDuration(data.durationMin), zoneLabel(data)].filter(Boolean);
  if (bits.length) {
    meta.addSpacer(4);
    const label = meta.addText(bits.join(" · "));
    label.font = Font.systemFont(11);
    label.textColor = new Color("#ffffff", 0.75);
    label.lineLimit = 1;
    label.minimumScaleFactor = 0.8;
  }
  meta.addSpacer();

  widget.addSpacer(3);
  // 152x22 fits the rectangular accessory (roughly 160x72pt) with the two text
  // rows above it and no clipping on the smaller phones.
  const drew = addProfile(widget, data, 152, 22);
  if (!drew) widget.addSpacer();

  return widget;
}

function buildCircular(data) {
  const widget = new ListWidget();
  widget.addAccessoryWidgetBackground = true;
  widget.setPadding(0, 0, 0, 0);

  // Spacers above and below centre the stack vertically in the circle;
  // centerAlignContent only handles the horizontal axis.
  widget.addSpacer();
  const stack = widget.addStack();
  stack.layoutVertically();
  stack.centerAlignContent();

  if (data.needsSetup || data.error) {
    const row = stack.addStack();
    row.addSpacer();
    addIcon(row, data.needsSetup ? "gearshape" : "exclamationmark.triangle", 16, 0.9);
    row.addSpacer();
    widget.addSpacer();
    return widget;
  }

  if (data.isRestDay || (!data.hasPlan && !data.name)) {
    const row = stack.addStack();
    row.addSpacer();
    addIcon(row, data.isRestDay ? "moon.zzz" : "calendar", 16, 0.9);
    row.addSpacer();
    widget.addSpacer();
    return widget;
  }

  const iconRow = stack.addStack();
  iconRow.addSpacer();
  addIcon(iconRow, symbolFor(data), 12, 0.8);
  iconRow.addSpacer();

  stack.addSpacer(1);

  const valueRow = stack.addStack();
  valueRow.addSpacer();
  const value = valueRow.addText(shortDuration(data.durationMin));
  value.font = Font.boldSystemFont(15);
  value.textColor = Color.white();
  value.lineLimit = 1;
  value.minimumScaleFactor = 0.6;
  valueRow.addSpacer();

  // No room for a labelled zone at this size, so the profile becomes a 7pt
  // strip under the duration — enough to tell a flat endurance ride from a
  // spiky interval session at a glance.
  const segments = usableSegments(data);
  if (segments.length) {
    stack.addSpacer(2);
    const chartRow = stack.addStack();
    chartRow.addSpacer();
    addProfile(chartRow, data, 34, 7);
    chartRow.addSpacer();
  }

  widget.addSpacer();
  return widget;
}

function buildInline(data) {
  const widget = new ListWidget();

  if (data.needsSetup || data.error) {
    widget.addText(data.needsSetup ? "Tap to set up widget" : `Training: ${data.error}`);
    return widget;
  }

  if (data.isRestDay) {
    widget.addText(data.restReason ? `Rest day · ${data.restReason}` : "Rest day");
    return widget;
  }
  if (!data.hasPlan && !data.name) {
    widget.addText("No plan yet");
    return widget;
  }

  // accessoryInline renders one image plus one string, and the system styles
  // both — fonts and colors set here are ignored.
  const symbol = SFSymbol.named(symbolFor(data));
  widget.addImage(symbol.image);
  const bits = [sessionName(data), formatDuration(data.durationMin), zoneLabel(data)].filter(Boolean);
  widget.addText(bits.join(" · "));
  return widget;
}

function buildWidget(data) {
  const family = config.widgetFamily ?? "accessoryRectangular";
  let widget;
  if (family === "accessoryCircular") widget = buildCircular(data);
  else if (family === "accessoryInline") widget = buildInline(data);
  else widget = buildRectangular(data);

  widget.url = data.needsSetup || data.error ? URLScheme.forRunningScript() : APP_URL;
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  return widget;
}

// ---- entry point --------------------------------------------------------

if (config.runsInWidget) {
  Script.setWidget(buildWidget(await fetchToday()));
  Script.complete();
} else {
  await promptForToken();
  const widget = buildWidget(await fetchToday());
  // presentAccessory* landed in Scriptable 1.7; fall back to the small preview
  // on anything older so a manual run still shows something.
  if (typeof widget.presentAccessoryRectangular === "function") {
    await widget.presentAccessoryRectangular();
  } else {
    await widget.presentSmall();
  }
  Script.complete();
}
