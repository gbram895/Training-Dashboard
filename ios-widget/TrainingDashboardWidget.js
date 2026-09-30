// Training Dashboard — Today's Session widget
// Runs in Scriptable (https://scriptable.app), free on the App Store.
// Setup: see ios-widget/README.md in the Training Dashboard repo.

const APP_URL = "https://training-dashboard-peiv.onrender.com";
const KEYCHAIN_KEY = "training-dashboard-widget-token";

function dyn(lightHex, darkHex) {
  return Color.dynamic(new Color(lightHex), new Color(darkHex));
}

// Same palette the web app uses (client/src/index.css) — light/dark pairs for
// surfaces, text, and the accent/good/warn tones the hero ring and stat row
// use. Zone hexes are the app's own --chart-z2..z5, which the app doesn't
// redefine under dark mode, so one value each is enough.
const COLORS = {
  bg: dyn("#f6f7f6", "#111514"),
  text: dyn("#101514", "#f2f5f4"),
  textDim: dyn("#66716e", "#9ba6a3"),
  textFaint: dyn("#9aa3a0", "#6d7876"),
  accent: dyn("#0a93a8", "#3fd0c9"),
  good: dyn("#1e9e5a", "#3fbe7b"),
  warn: dyn("#c97a1e", "#e0a23f"),
  track: new Color("#8e8e93", 0.22),
};

const ZONES = {
  ENDURANCE: { label: "Endurance", hex: "#5fc9f0" },
  TEMPO: { label: "Tempo", hex: "#6fcf8e" },
  THRESHOLD: { label: "Threshold", hex: "#f2cb55" },
  VO2MAX: { label: "VO2max", hex: "#ef7b72" },
};

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
    return withCacheFallback("Waking up — showing last known plan");
  }
}

// ---- drawing helpers -------------------------------------------------

function addIcon(container, symbolName, color, size) {
  const symbol = SFSymbol.named(symbolName);
  symbol.applyFont(Font.systemFont(size));
  const img = container.addImage(symbol.image);
  img.imageSize = new Size(size, size);
  img.tintColor = color;
  return img;
}

// A rounded, tinted label — "Threshold" on a soft wash of its own zone color,
// the same idea as the colored segment cards in WorkoutDetailView, just
// inverted (tint-on-surface instead of white-on-solid) since a solid block of
// color reads as too heavy at widget scale.
function addPill(container, text, hex) {
  const pill = container.addStack();
  pill.layoutHorizontally();
  pill.setPadding(2, 7, 2, 7);
  pill.backgroundColor = new Color(hex, 0.16);
  pill.cornerRadius = 5;
  const label = pill.addText(text.toUpperCase());
  label.font = Font.boldSystemFont(9);
  label.textColor = new Color(hex);
  return pill;
}

// Scriptable's Path has no addArc(center, radius, startAngle, endAngle) the
// way UIBezierPath does — only move/addLine/addRect/addEllipse/addCurve etc.
// A partial arc is approximated as a polyline instead: plenty smooth at
// widget scale with ~90 segments per full turn, scaled down for shorter arcs
// (and floored at 8 so even a tiny percentage still reads as a curve).
function arcPath(center, radius, startAngle, endAngle) {
  const path = new Path();
  const span = endAngle - startAngle;
  const segments = Math.max(8, Math.ceil((Math.abs(span) / (2 * Math.PI)) * 90));
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (span * i) / segments;
    const point = new Point(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
    if (i === 0) path.move(point);
    else path.addLine(point);
  }
  return path;
}

// The readiness ring from the Dashboard hero (ProgressRing.tsx), drawn as a
// single image (arc + centered label baked in together) since a widget can't
// overlay a text view on an image the way a web page overlays a div. Reused
// for the small-size Sleep/HRV/Fatigue mini-rings too (same shape, smaller,
// tinted per metric) — one drawing routine rather than two so a fix to one
// automatically covers the other.
function buildRing(size, percent, arcColor, label, fontScale) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const strokeWidth = size * 0.13;
  const center = new Point(size / 2, size / 2);
  const radius = (size - strokeWidth) / 2;

  ctx.setLineWidth(strokeWidth);
  ctx.setStrokeColor(COLORS.track);
  const track = new Path();
  track.addEllipse(new Rect(center.x - radius, center.y - radius, radius * 2, radius * 2));
  ctx.addPath(track);
  ctx.strokePath();

  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  if (percent != null && clamped > 0) {
    const start = -Math.PI / 2;
    const end = start + (clamped / 100) * 2 * Math.PI;
    ctx.setStrokeColor(arcColor);
    ctx.addPath(arcPath(center, radius, start, end));
    ctx.strokePath();
  }

  if (label) {
    ctx.setFont(Font.boldSystemFont(size * fontScale));
    ctx.setTextColor(COLORS.text);
    ctx.setTextAlignedCenter();
    ctx.drawTextInRect(label, new Rect(0, size * 0.34, size, size * 0.36));
  }

  return ctx.getImage();
}

// Any DrawContext/Path API mismatch is caught here, which falls back to a
// plain label instead of crashing the whole widget.
function addRingBadge(container, percent, arcColor, label, size, fontScale) {
  try {
    const img = container.addImage(buildRing(size, percent, arcColor, label, fontScale));
    img.imageSize = new Size(size, size);
  } catch (e) {
    const col = container.addStack();
    col.layoutVertically();
    col.size = new Size(size, size);
    col.centerAlignContent();
    const v = col.addText(label);
    v.font = Font.boldSystemFont(size * fontScale);
    v.textColor = arcColor;
    v.centerAlignText();
  }
}

function addMiniBar(container, pct, color, width, height) {
  const track = container.addStack();
  track.size = new Size(width, height);
  track.backgroundColor = COLORS.track;
  track.cornerRadius = height / 2;
  track.layoutHorizontally();
  const fillWidth = Math.max(3, (width * Math.max(0, Math.min(100, pct))) / 100);
  const fill = track.addStack();
  fill.size = new Size(fillWidth, height);
  fill.backgroundColor = color;
  fill.cornerRadius = height / 2;
}

function addStatColumn(container, label, value, pct, color, note) {
  const col = container.addStack();
  col.layoutVertically();
  const l = col.addText(label.toUpperCase());
  l.font = Font.boldSystemFont(9);
  l.textColor = COLORS.textFaint;
  col.addSpacer(2);
  const v = col.addText(value);
  v.font = Font.semiboldSystemFont(13);
  v.textColor = COLORS.text;
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.8;
  col.addSpacer(3);
  addMiniBar(col, pct, color, 46, 4);
  col.addSpacer(3);
  const n = col.addText(note);
  n.font = Font.systemFont(8.5);
  n.textColor = COLORS.textFaint;
  n.lineLimit = 1;
  n.minimumScaleFactor = 0.8;
  return col;
}

function formatHours(hours) {
  if (hours == null) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function weekdayDate() {
  const f = new DateFormatter();
  // Explicit locale — DateFormatter otherwise follows the phone's language
  // (e.g. "WO, SEP 30" for woensdag on a Dutch device), and the rest of the
  // app's UI is English regardless of device locale.
  f.locale = "en_US";
  f.dateFormat = "EEE, MMM d";
  return f.string(new Date()).toUpperCase();
}

// ---- states ------------------------------------------------------------

function centeredMessage(widget, symbolName, text) {
  widget.addSpacer();
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  addIcon(row, symbolName, COLORS.textDim, 15);
  row.addSpacer(6);
  const label = row.addText(text);
  label.font = Font.mediumSystemFont(14);
  label.textColor = COLORS.text;
  widget.addSpacer();
}

function addDashboardRow(widget, dashboard) {
  if (!dashboard) return;
  widget.addSpacer(10);
  const row = widget.addStack();
  row.layoutHorizontally();
  addStatColumn(
    row,
    "Sleep",
    formatHours(dashboard.sleep.hours),
    dashboard.sleep.pct,
    COLORS.good,
    dashboard.sleep.note,
  );
  row.addSpacer();
  addStatColumn(
    row,
    "HRV",
    dashboard.hrv.value != null ? `${Math.round(dashboard.hrv.value)}ms` : "—",
    dashboard.hrv.pct,
    COLORS.accent,
    dashboard.hrv.deltaVs7d != null
      ? `${dashboard.hrv.deltaVs7d >= 0 ? "+" : ""}${dashboard.hrv.deltaVs7d.toFixed(0)} vs 7d`
      : "No HRV data",
  );
  row.addSpacer();
  addStatColumn(
    row,
    "Fatigue",
    dashboard.fatigue.label,
    dashboard.fatigue.pct,
    COLORS.warn,
    dashboard.fatigue.tsb != null ? `TSB ${dashboard.fatigue.tsb >= 0 ? "+" : ""}${dashboard.fatigue.tsb.toFixed(0)}` : "No data",
  );
}

// Small size has no room for the bar-chart stat row, so Sleep/HRV/Fatigue
// become three small rings instead — same shape and colors as the hero
// ring, just tinted per metric and carrying a short value instead of a %.
function addMiniRingRow(widget, dashboard) {
  if (!dashboard) return;
  widget.addSpacer(8);
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const cols = [
    {
      label: "Sleep",
      pct: dashboard.sleep.pct,
      color: COLORS.good,
      value: dashboard.sleep.hours != null ? `${Math.round(dashboard.sleep.hours)}h` : "–",
    },
    {
      label: "HRV",
      pct: dashboard.hrv.pct,
      color: COLORS.accent,
      value: dashboard.hrv.value != null ? `${Math.round(dashboard.hrv.value)}` : "–",
    },
    {
      label: "Fatigue",
      pct: dashboard.fatigue.pct,
      color: COLORS.warn,
      value:
        dashboard.fatigue.tsb != null
          ? `${dashboard.fatigue.tsb >= 0 ? "+" : ""}${Math.round(dashboard.fatigue.tsb)}`
          : "–",
    },
  ];

  cols.forEach((c, i) => {
    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    addRingBadge(col, c.pct, c.color, c.value, 34, 0.28);
    col.addSpacer(2);
    const l = col.addText(c.label.toUpperCase());
    l.font = Font.boldSystemFont(7);
    l.textColor = COLORS.textFaint;
    if (i < cols.length - 1) row.addSpacer();
  });
}

function buildWidget(data) {
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(14, 14, 12, 14);
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

  const family = config.widgetFamily ?? "medium";

  const header = widget.addText(weekdayDate());
  header.font = Font.boldSystemFont(10);
  header.textColor = COLORS.textFaint;

  if (data.needsSetup) {
    widget.url = URLScheme.forRunningScript();
    centeredMessage(widget, "gearshape", "Tap to set up");
    return widget;
  }

  if (data.error) {
    widget.url = URLScheme.forRunningScript();
    centeredMessage(widget, "exclamationmark.triangle", data.error);
    return widget;
  }

  widget.url = APP_URL;

  const readiness = data.dashboard?.readiness ?? null;
  const ringSize = family === "small" ? 46 : 54;

  widget.addSpacer(8);
  const hero = widget.addStack();
  hero.layoutHorizontally();
  hero.centerAlignContent();
  addRingBadge(hero, readiness, COLORS.accent, readiness != null ? `${readiness}%` : "–", ringSize, 0.24);
  hero.addSpacer(10);

  const info = hero.addStack();
  info.layoutVertically();

  if (!data.hasPlan || data.isRestDay) {
    const title = info.addText(data.isRestDay ? "Rest day" : "No plan yet");
    title.font = Font.boldSystemFont(15);
    title.textColor = COLORS.text;
    title.lineLimit = 1;
    if (data.isRestDay && data.restReason) {
      info.addSpacer(2);
      const sub = info.addText(data.restReason);
      sub.font = Font.systemFont(10);
      sub.textColor = COLORS.textDim;
      sub.lineLimit = family === "small" ? 1 : 2;
    }
  } else {
    const zone = ZONES[data.category] ?? null;
    const name = info.addText(data.name || (data.discipline === "BIKE" ? "Bike" : "Run"));
    name.font = Font.boldSystemFont(15);
    name.textColor = COLORS.text;
    name.lineLimit = 1;
    name.minimumScaleFactor = 0.75;

    info.addSpacer(3);
    const meta = info.addStack();
    meta.layoutHorizontally();
    meta.centerAlignContent();
    addIcon(meta, data.discipline === "BIKE" ? "bicycle" : "figure.run", COLORS.textDim, 11);
    if (data.durationMin != null) {
      meta.addSpacer(4);
      const dur = meta.addText(`${data.durationMin}m`);
      dur.font = Font.systemFont(11);
      dur.textColor = COLORS.textDim;
    }
    if (zone && family !== "small") {
      meta.addSpacer(6);
      addPill(meta, zone.label, zone.hex);
    }
  }

  if (family === "small") {
    addMiniRingRow(widget, data.dashboard);
  } else {
    addDashboardRow(widget, data.dashboard);
  }

  if (data.stale) {
    widget.addSpacer(6);
    const noteRow = widget.addStack();
    noteRow.layoutHorizontally();
    noteRow.centerAlignContent();
    addIcon(noteRow, "clock.arrow.circlepath", COLORS.textFaint, 9);
    noteRow.addSpacer(3);
    const note = noteRow.addText(data.staleMessage || "Showing last known plan");
    note.font = Font.systemFont(9);
    note.textColor = COLORS.textFaint;
    note.lineLimit = 1;
  } else {
    widget.addSpacer();
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
