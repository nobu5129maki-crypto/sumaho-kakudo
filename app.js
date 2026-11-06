/* 首らく
   持ち角度は 0°（画面が水平）〜 90°（垂直）。
   下向き = 基準の持ち角度 − いまの持ち角度。
   基準より閾値以上の下向きが、指定秒数続くと警告する。
   加速度があれば重力ベクトルから傾きを出し、縦横どちらでも同じ意味になる。 */
(function () {
  'use strict';

  const KEY = 'kubiraku-v1';
  const DEFAULT_BASELINE = 55;
  const SCENES = {
    commute: { label: '通勤', threshold: 20, durationSec: 15, breakIntervalMin: 30, flavor: '移動中向け。' },
    desk: { label: 'デスク', threshold: 30, durationSec: 20, breakIntervalMin: 45, flavor: '作業向け。' },
    night: { label: '寝る前', threshold: 15, durationSec: 10, breakIntervalMin: 30, flavor: '休む前向け。' },
    custom: { label: 'カスタム', flavor: '自分用。' }
  };
  const POSES = [
    { pose: 'tilt-r', title: '右の耳を、肩に近づける', note: '左肩は下げたまま。痛みの手前で止めます。' },
    { pose: 'tilt-l', title: '左の耳を、肩に近づける', note: '右肩は下げたまま。ゆっくり戻します。' },
    { pose: 'tuck', title: 'あごを引いて、うなじを伸ばす', note: '上を向かず、後ろの襟を遠くへ。息は止めません。' },
    { pose: 'roll', title: '肩を、ゆっくり回す', note: '胸を軽く開いて、吐きながら回します。' }
  ];
  const VOICE_ALERT = [
    '首が下がっています。画面を少し上げましょう。',
    '下を向いたままです。あごを軽く引いてみてください。',
    'スマホが低い位置です。目線に近づけましょう。'
  ];
  const VOICE_BREAK = [
    '一度立ち上がって、肩を回しましょう。',
    '同じ姿勢が続いています。立って、少し歩きましょう。',
    '角度を保つより、動く方が首は楽になります。'
  ];

  const $ = (id) => document.getElementById(id);

  const DEFAULT_SETTINGS = {
    scene: 'desk',
    threshold: 30,
    durationSec: 20,
    breakIntervalMin: 45,
    goalReduceMin: 5,
    baseline: null,
    forceSim: false,
    welcomed: false,
    floaterX: null,
    floaterY: null,
    alerts: {
      vibrate: true,
      notification: true,
      blur: true,
      color: true,
      voice: true,
      floater: true
    }
  };

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function emptyDay() {
    return {
      downSec: 0,
      useSec: 0,
      alerts: 0,
      stretches: 0,
      breaks: 0,
      hours: Array(24).fill(0),
      hourUse: Array(24).fill(0)
    };
  }
  function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
  function normDay(day) {
    const base = emptyDay();
    const src = day || {};
    base.downSec = num(src.downSec);
    base.useSec = num(src.useSec);
    base.alerts = num(src.alerts);
    base.stretches = num(src.stretches);
    base.breaks = num(src.breaks);
    for (let i = 0; i < 24; i++) {
      base.hours[i] = num(src.hours && src.hours[i]);
      base.hourUse[i] = num(src.hourUse && src.hourUse[i]);
    }
    return base;
  }
  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function shiftDate(key, delta) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    return dateKey(dt);
  }
  function formatDuration(sec) {
    sec = Math.max(0, num(sec));
    if (sec < 60) return `${Math.round(sec)}秒`;
    const m = sec / 60;
    if (m < 60) {
      const rounded = m < 10 ? Math.round(m * 10) / 10 : Math.round(m);
      return `${rounded}分`;
    }
    const h = Math.floor(m / 60);
    const rm = Math.round(m - h * 60);
    return `${h}時間${rm}分`;
  }
  function weekday(key) {
    return '日月火水木金土'[new Date(`${key}T12:00:00`).getDay()];
  }
  function shortDate(key) {
    const [, m, d] = key.split('-');
    return `${Number(m)}/${Number(d)}`;
  }

  function load() {
    const data = { settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), days: {}, goalResults: {} };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!raw) return data;
      data.settings = {
        ...data.settings,
        ...(raw.settings || {}),
        alerts: { ...DEFAULT_SETTINGS.alerts, ...((raw.settings && raw.settings.alerts) || {}) }
      };
      data.days = raw.days || {};
      data.goalResults = raw.goalResults || {};
    } catch (e) { /* 壊れた記録は初期値に戻す */ }
    const s = data.settings;
    s.threshold = clamp(num(s.threshold) || 30, 10, 45);
    s.durationSec = clamp(num(s.durationSec) || 20, 5, 60);
    s.breakIntervalMin = [30, 45, 60].includes(Number(s.breakIntervalMin)) ? Number(s.breakIntervalMin) : 45;
    s.goalReduceMin = clamp(num(s.goalReduceMin) || 5, 1, 20);
    if (!SCENES[s.scene]) s.scene = 'desk';
    if (s.baseline != null) {
      const b = Number(s.baseline);
      s.baseline = Number.isFinite(b) ? clamp(b, -5, 120) : null;
    }
    Object.keys(data.days).forEach((k) => { data.days[k] = normDay(data.days[k]); });
    return data;
  }

  const data = load();
  const settings = data.settings;

  let sensorMode = 'none';
  let smoothBeta = null;
  let simBeta = 55;
  let allowSim = false;
  let watching = false;
  let sessionMs = 0;
  let nextBreakAt = settings.breakIntervalMin * 60000;
  let badAccum = 0;
  let alertArmed = true;
  let sessionAlerts = 0;
  let longSuggested = false;
  let lastSuggest = 0;
  let wakeLock = null;
  let audioCtx = null;
  let dirty = false;
  let gaugeLen = 251.3;
  let calToken = 0;
  let stretchStart = 0;
  let stretchRaf = 0;
  let stretchPose = -1;
  let hiddenAt = 0;
  let deferredPrompt = null;
  let todayKey = dateKey(new Date());
  let chartAcc = 0;
  let tipTimer = 0;
  let recoverSince = 0;
  const drag = { on: false, id: 0, x: 0, y: 0, left: 0, top: 0, moved: false };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 容量不足でも計測は続ける */ }
    dirty = false;
  }
  function mark() { dirty = true; }

  function baseline() {
    return settings.baseline == null ? DEFAULT_BASELINE : settings.baseline;
  }
  function usingSim() {
    return settings.forceSim || (allowSim && sensorMode !== 'live');
  }
  function readBeta() {
    if (settings.forceSim) return simBeta;
    if (sensorMode === 'live' && smoothBeta != null) return smoothBeta;
    if (allowSim) return simBeta;
    return null;
  }
  function sample() {
    const beta = readBeta();
    const base = baseline();
    const down = beta == null ? null : base - beta;
    return { beta, base, down };
  }
  function ensureDay(key) {
    if (!data.days[key]) data.days[key] = emptyDay();
    return data.days[key];
  }
  function yesterdayDown(key) {
    const prev = data.days[shiftDate(key, -1)];
    if (!prev || prev.useSec < 60) return null;
    return prev.downSec;
  }
  function targetFor(key) {
    const y = yesterdayDown(key);
    if (y == null) return null;
    const reduce = Math.min(settings.goalReduceMin * 60, y);
    return Math.max(0, y - reduce);
  }
  function finalizeGoals() {
    const today = dateKey(new Date());
    Object.keys(data.days).forEach((key) => {
      if (key >= today) return;
      if (data.goalResults[key]) return;
      const day = data.days[key];
      const target = targetFor(key);
      if (!day || day.useSec < 60 || target == null) data.goalResults[key] = 'skip';
      else data.goalResults[key] = day.downSec <= target + 0.5 ? 'met' : 'miss';
    });
  }
  function pushBeta(angle) {
    if (!Number.isFinite(angle)) return;
    sensorMode = 'live';
    smoothBeta = smoothBeta == null ? angle : smoothBeta * 0.82 + angle * 0.18;
  }

  /* 0° 水平・90° 垂直。重力の向きだけで決めるので、縦持ちでも横持ちでも同じ。 */
  function tiltFromAccel(a) {
    if (!a || a.x == null || a.y == null || a.z == null) return null;
    const mag = Math.hypot(a.x, a.y, a.z);
    if (mag < 3) return null;
    return Math.atan2(Math.hypot(a.x, a.y), Math.abs(a.z)) * 180 / Math.PI;
  }
  function tiltFromOrientation(e) {
    if (e.beta == null || Number.isNaN(e.beta)) return null;
    const angle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
    if ((angle === 90 || angle === -90 || angle === 270) && e.gamma != null) {
      return clamp(angle === 90 ? -e.gamma : e.gamma, 0, 90);
    }
    return clamp(e.beta, 0, 90);
  }

  window.addEventListener('devicemotion', (e) => {
    if (settings.forceSim) return;
    const tilt = tiltFromAccel(e.accelerationIncludingGravity);
    if (tilt == null) return;
    pushBeta(tilt);
  });
  window.addEventListener('deviceorientation', (e) => {
    if (settings.forceSim || sensorMode === 'live') return;
    // パソコンが送る 0,0,0 の空イベントは、本物の水平と区別して無視する。
    if (e.beta === 0 && e.gamma === 0 && (e.alpha === 0 || e.alpha == null)) return;
    const tilt = tiltFromOrientation(e);
    if (tilt == null) return;
    pushBeta(tilt);
  });

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function speak(text) {
    if (!settings.alerts.voice || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 1;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 音声が使えない端末では表示だけで伝える */ }
  }
  function chime(kind) {
    if (!settings.alerts.voice) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = kind === 'break' ? 523 : 392;
      o.connect(g);
      g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t);
      o.stop(t + 0.4);
    } catch (e) { /* 音が鳴らせなくても警告の表示は出す */ }
  }
  function buzz(pattern) {
    if (!settings.alerts.vibrate || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }
  async function ensureNotify() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try { return (await Notification.requestPermission()) === 'granted'; } catch (e) { return false; }
  }
  function notify(body) {
    if (!settings.alerts.notification || !('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, tag: 'kubiraku', renotify: true, icon: 'icon-192.png' };
    const fallback = () => { try { new Notification('首らく', opts); } catch (e) {} };
    if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistration) { fallback(); return; }
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.showNotification) reg.showNotification('首らく', opts);
      else fallback();
    }).catch(fallback);
  }
  async function lockWake() {
    try {
      if (!navigator.wakeLock) return;
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { wakeLock = null; }
  }
  function unlockWake() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }
  async function ensureSensorPermission() {
    const motionP = (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function')
      ? DeviceMotionEvent.requestPermission()
      : Promise.resolve('granted');
    const orientP = (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function')
      ? DeviceOrientationEvent.requestPermission()
      : Promise.resolve('granted');
    try {
      const [motion, orient] = await Promise.all([motionP, orientP]);
      return motion === 'granted' || orient === 'granted';
    } catch (e) {
      return false;
    }
  }

  function anySheet() {
    return !$('welcome').hidden || !$('cal-sheet').hidden || !$('alert-layer').hidden || !$('break-layer').hidden || !$('stretch-sheet').hidden;
  }
  function modalBlocking() {
    return !$('cal-sheet').hidden || !$('alert-layer').hidden || !$('break-layer').hidden || !$('stretch-sheet').hidden || !$('welcome').hidden;
  }
  function paintDim(dim) {
    dim.classList.toggle('blurred', !!settings.alerts.blur);
    dim.classList.toggle('colored', !!settings.alerts.color);
  }
  function syncTint() {
    document.body.classList.toggle('alert-tint', !$('alert-layer').hidden && !!settings.alerts.color);
    document.body.classList.toggle('break-tint', !$('break-layer').hidden && !!settings.alerts.color);
  }

  function ruleText() {
    const scene = SCENES[settings.scene] || SCENES.custom;
    const breakMin = settings.breakIntervalMin;
    return `${scene.flavor}基準より ${settings.threshold}° 以上の下向きが ${settings.durationSec}秒 続くと知らせます。${breakMin}分ごとに、立つ合図も出します。`;
  }

  function renderChrome() {
    const scene = SCENES[settings.scene] || SCENES.custom;
    const day = data.days[dateKey(new Date())];
    $('scene-chip').textContent = scene.label;
    $('header-tag').textContent = watching
      ? `見守り ${formatDuration(sessionMs / 1000)}`
      : `今日の下向き ${formatDuration(day ? day.downSec : 0)}`;
    $('rule-text').textContent = ruleText();
    $('cal-banner').hidden = settings.baseline != null;
    const sim = usingSim();
    $('sim-box').hidden = !sim;
    $('sim-note').hidden = !(sim && watching);
    $('stat-alerts').textContent = `${day ? day.alerts : 0}回`;
    $('stat-use').textContent = formatDuration(day ? day.useSec : 0);
  }

  function renderGoal() {
    const key = dateKey(new Date());
    const day = data.days[key] || emptyDay();
    const y = yesterdayDown(key);
    const target = targetFor(key);
    const title = $('goal-title');
    const detail = $('goal-detail');
    const caption = $('goal-caption');
    const bar = $('goal-bar');
    title.textContent = '今日の目標';
    if (y == null) {
      detail.textContent = '昨日の記録がまだありません';
      caption.textContent = day.useSec > 0
        ? `今日 ${formatDuration(day.downSec)}。明日はこの時間と比べます。`
        : '見守りを始めると、明日からの目標になります。';
    } else {
      const reduce = Math.min(settings.goalReduceMin * 60, y);
      detail.textContent = `下向きを ${formatDuration(reduce)} 減らす`;
      const state = day.downSec <= target + 0.5 ? 'いまのところ範囲内です。' : `目標を ${formatDuration(day.downSec - target)} 超えています。`;
      caption.textContent = `昨日 ${formatDuration(y)} → 今日 ${formatDuration(day.downSec)}（目標 ${formatDuration(target)} 以内）。${state}`;
    }
    let pct = 0;
    if (target == null) pct = Math.min(100, day.downSec / (20 * 60) * 100);
    else if (target <= 0) pct = day.downSec > 0 ? 100 : 0;
    else pct = Math.min(100, day.downSec / target * 100);
    bar.style.width = `${pct}%`;
    bar.classList.toggle('over', target != null && day.downSec > target + 0.5);
    const rec = $('rec-goal');
    if (rec) rec.textContent = caption.textContent;
  }

  function renderSettings() {
    const scene = settings.scene;
    ['commute', 'desk', 'night'].forEach((name) => {
      $(`scene-${name}`).setAttribute('aria-pressed', String(scene === name));
    });
    $('scene-hint').textContent = ruleText();
    if (document.activeElement !== $('threshold')) $('threshold').value = String(settings.threshold);
    if (document.activeElement !== $('duration')) $('duration').value = String(settings.durationSec);
    $('threshold-out').textContent = `${settings.threshold}°`;
    $('duration-out').textContent = `${settings.durationSec}秒`;
    [30, 45, 60].forEach((min) => {
      $(`break-${min}`).setAttribute('aria-pressed', String(settings.breakIntervalMin === min));
    });
    $('goal-val').textContent = `${settings.goalReduceMin}分`;
    document.querySelectorAll('.switch[data-alert]').forEach((btn) => {
      btn.setAttribute('aria-checked', String(!!settings.alerts[btn.dataset.alert]));
    });
    $('toggle-sim').setAttribute('aria-checked', String(!!settings.forceSim));
    $('baseline-text').textContent = settings.baseline == null
      ? '未設定（55° を基準にしています）'
      : `基準は ${Math.round(settings.baseline)}° です。ここから ${settings.threshold}° 下がると下向きです。`;
    if (!('Notification' in window)) $('notify-note').textContent = 'このブラウザは通知に対応していません。画面の色と音声で知らせます。';
    else if (Notification.permission === 'denied') $('notify-note').textContent = '通知がブロックされています。ブラウザの設定から許可できます。';
    else if (Notification.permission === 'granted') $('notify-note').textContent = '通知は許可されています。';
    else $('notify-note').textContent = '通知をオンにしたとき、または見守り開始時に許可を求めます。';
    renderChrome();
    renderGoal();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, Math.max(0, h) / 2);
    ctx.beginPath();
    if (h <= 3 || radius <= 0) { ctx.rect(x, y, w, Math.max(h, 0)); return; }
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
  function prepCanvas(canvas, cssH) {
    const cssW = canvas.clientWidth || 320;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.font = '12px "Zen Maru Gothic", sans-serif';
    return { ctx, cssW, cssH };
  }
  function lastNDays(n) {
    const keys = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      keys.push(dateKey(d));
    }
    return keys;
  }
  function drawWeek() {
    const canvas = $('week-canvas');
    if (!canvas || canvas.clientWidth === 0) return;
    const keys = lastNDays(7);
    const vals = keys.map((k) => ((data.days[k] && data.days[k].downSec) || 0) / 60);
    const alerts = keys.map((k) => (data.days[k] && data.days[k].alerts) || 0);
    const { ctx, cssW, cssH } = prepCanvas(canvas, canvas.clientHeight || 180);
    const max = Math.max(5, ...vals);
    const padL = 8, padR = 8, padT = 18, padB = 26;
    const innerH = cssH - padT - padB;
    const bw = (cssW - padL - padR - 8 * 6) / 7;
    const today = dateKey(new Date());
    ctx.fillStyle = '#4a524b';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(max)}分`, padL, 12);
    keys.forEach((key, i) => {
      const h = Math.max(2, (vals[i] / max) * innerH);
      const x = padL + i * (bw + 8);
      const y = padT + innerH - h;
      ctx.fillStyle = key === today ? '#2f6d56' : '#9dcebb';
      roundRect(ctx, x, y, bw, h, 7);
      ctx.fill();
      if (alerts[i] > 0) {
        ctx.fillStyle = '#c4543a';
        ctx.beginPath();
        ctx.arc(x + bw / 2, Math.max(8, y - 6), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#4a524b';
      ctx.textAlign = 'center';
      ctx.fillText(weekday(key), x + bw / 2, cssH - 8);
    });
    const summary = keys.map((k, i) => `${shortDate(k)} ${vals[i] < 10 ? Math.round(vals[i] * 10) / 10 : Math.round(vals[i])}分`).join('、');
    canvas.setAttribute('aria-label', `この7日の下向き時間。${summary}`);
    $('week-summary').textContent = summary;
  }
  function drawHours() {
    const canvas = $('hour-canvas');
    if (!canvas || canvas.clientWidth === 0) return;
    const day = data.days[dateKey(new Date())] || emptyDay();
    const useVals = day.hourUse.map((v) => v / 60);
    const downVals = day.hours.map((v) => v / 60);
    const { ctx, cssW, cssH } = prepCanvas(canvas, canvas.clientHeight || 120);
    const max = Math.max(5, ...useVals, ...downVals);
    const padL = 4, padR = 4, padT = 16, padB = 18;
    const innerH = cssH - padT - padB;
    const gap = 3;
    const bw = (cssW - padL - padR - gap * 23) / 24;
    ctx.fillStyle = '#4a524b';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(max)}分`, padL, 12);
    for (let i = 0; i < 24; i++) {
      const x = padL + i * (bw + gap);
      const uh = Math.max(useVals[i] > 0 ? 2 : 0, (useVals[i] / max) * innerH);
      const dh = Math.max(downVals[i] > 0 ? 2 : 0, (downVals[i] / max) * innerH);
      if (uh > 0) {
        ctx.fillStyle = '#efe8dc';
        roundRect(ctx, x, padT + innerH - uh, bw, uh, 3);
        ctx.fill();
      }
      if (dh > 0) {
        ctx.fillStyle = '#2f6d56';
        roundRect(ctx, x, padT + innerH - dh, bw, dh, 3);
        ctx.fill();
      }
      if (i % 6 === 0) {
        ctx.fillStyle = '#4a524b';
        ctx.textAlign = 'center';
        ctx.fillText(String(i), x + bw / 2, cssH - 4);
      }
    }
    canvas.setAttribute('aria-label', `今日の下向きは ${formatDuration(day.downSec)}、使用は ${formatDuration(day.useSec)}です。`);
  }
  function trendSentence() {
    const keys = Object.keys(data.days).filter((k) => data.days[k].useSec >= 60).sort();
    const el = $('trend-text');
    if (keys.length < 4) {
      el.className = 'trend';
      el.textContent = '見守りが数日分たまると、下向きの割合の変化をここに出します。';
      return;
    }
    const recent = keys.slice(-3);
    const prior = keys.slice(-6, -3);
    if (prior.length < 2) {
      el.className = 'trend';
      el.textContent = 'もう少し記録がたまると、前の期間と比べられます。';
      return;
    }
    const avg = (arr) => arr.reduce((s, k) => s + data.days[k].downSec / Math.max(1, data.days[k].useSec), 0) / arr.length;
    const delta = avg(recent) - avg(prior);
    const pct = Math.round(Math.abs(delta) * 100);
    if (Math.abs(delta) < 0.03) {
      el.className = 'trend';
      el.textContent = '直近は、下向きの割合がほぼ横ばいです。';
    } else if (delta < 0) {
      el.className = 'trend good';
      el.textContent = `直近3日は、その前より下向きの割合が ${pct} ポイント減りました。`;
    } else {
      el.className = 'trend warn';
      el.textContent = `直近3日は、下向きの割合が ${pct} ポイント増えています。立つ間隔を短くしてみましょう。`;
    }
  }
  function renderRecord() {
    const key = dateKey(new Date());
    const day = data.days[key] || emptyDay();
    $('rec-down').textContent = formatDuration(day.downSec);
    $('rec-use').textContent = formatDuration(day.useSec);
    $('rec-alerts').textContent = `${day.alerts}回`;
    $('rec-stretch').textContent = `${day.stretches}回`;
    renderGoal();
    drawWeek();
    drawHours();
    trendSentence();
    let streak = 0;
    let cursor = shiftDate(key, -1);
    while (data.goalResults[cursor] === 'met') {
      streak += 1;
      cursor = shiftDate(cursor, -1);
    }
    const target = targetFor(key);
    const todayOk = target != null && day.downSec <= target + 0.5 && day.useSec > 0;
    $('streak-text').textContent = streak > 0
      ? `達成が ${streak}日 続いています。${todayOk ? '今日も範囲内です。' : ''}`
      : (todayOk ? '今日は、いまのところ目標の範囲内です。' : '達成した日は、ここに残ります。');
    const mets = Object.keys(data.goalResults).filter((k) => data.goalResults[k] === 'met').sort().slice(-8).reverse();
    const list = $('goal-list');
    list.innerHTML = '';
    if (!mets.length) {
      const li = document.createElement('li');
      li.textContent = 'まだ達成した日はありません。';
      list.appendChild(li);
    } else {
      mets.forEach((k) => {
        const li = document.createElement('li');
        li.textContent = `${shortDate(k)}（${weekday(k)}）目標達成`;
        list.appendChild(li);
      });
    }
  }

  function updateVisuals() {
    const { beta, base, down } = sample();
    const fg = $('g-fg');
    if (!gaugeLen) gaugeLen = fg.getTotalLength() || 251.3;
    const shown = down == null ? null : Math.max(0, down);
    const ratio = shown == null ? 0 : clamp(shown / settings.threshold, 0, 1);
    fg.style.strokeDasharray = String(gaugeLen);
    fg.style.strokeDashoffset = String(gaugeLen * (1 - ratio));
    const color = ratio < 0.6 ? '#2f6d56' : ratio < 1 ? '#e08a3c' : '#c4543a';
    fg.style.stroke = color;
    $('deg').textContent = shown == null ? '—' : String(Math.round(shown));
    const status = $('status');
    let mode = 'idle';
    let label = '見守り前';
    if (beta == null) {
      label = '角度を待っています';
    } else if (!watching) {
      label = '見守り前';
    } else if (down >= settings.threshold) {
      mode = alertArmed ? 'pending' : 'bad';
      label = alertArmed ? '下向きが続いています' : '首が下がっています';
    } else if (down >= settings.threshold * 0.45) {
      mode = 'mid';
      label = '少し下向きです';
    } else {
      mode = 'ok';
      label = 'いい角度です';
    }
    status.className = `status ${mode}`;
    status.textContent = label;
    const count = $('countdown');
    if (watching && down != null && down >= settings.threshold && alertArmed) {
      const left = Math.max(0, Math.ceil((settings.durationSec * 1000 - badAccum) / 1000));
      count.hidden = false;
      count.textContent = `この角度があと ${left}秒 続くと知らせます`;
    } else {
      count.hidden = true;
    }
    if (beta != null) {
      const tilt = clamp(shown * 0.7, 0, 32);
      $('mini-head').style.transform = `rotate(${tilt}deg)`;
      $('mini-phone').style.transform = `rotate(${clamp(90 - beta, -8, 72)}deg)`;
      const relate = down < -3 ? `基準より ${Math.round(-down)}° 高い` : `下向き ${Math.round(Math.max(0, down))}°`;
      $('level-read').textContent = `持ち角度 ${Math.round(beta)}° · 基準 ${Math.round(base)}° · ${relate}`;
    } else {
      $('level-read').textContent = 'センサーを待っています。出ないときは、つまみで試せます。';
    }
    if (!$('cal-sheet').hidden && beta != null) $('cal-live').textContent = `いま ${Math.round(beta)}°`;
    const progress = !watching || down == null || down < settings.threshold
      ? 0
      : (alertArmed ? clamp(badAccum / (settings.durationSec * 1000), 0, 1) : 1);
    const floaterOn = watching && settings.alerts.floater && !anySheet() && $('screen-watch').hidden === false;
    $('floater').hidden = !floaterOn;
    if (floaterOn) {
      const circ = 2 * Math.PI * 20;
      const ring = $('ring');
      ring.style.strokeDasharray = String(circ);
      ring.style.strokeDashoffset = String(circ * (1 - progress));
      ring.style.stroke = progress >= 1 ? '#c4543a' : progress > 0 ? '#e08a3c' : '#2f6d56';
      let face = 'calm';
      if (progress >= 0.85 || (down != null && down >= settings.threshold && !alertArmed)) face = 'hot';
      else if (progress > 0.05 || (down != null && down >= settings.threshold * 0.7)) face = 'warn';
      $('face').className = `face ${face}`;
      const left = Math.max(0, Math.ceil(settings.durationSec * (1 - progress)));
      let aria = '角度を確認しています';
      if (down != null && down < settings.threshold) aria = `下向き ${Math.round(Math.max(0, down))}度。いい範囲です`;
      else if (down != null && !alertArmed) aria = `下向き ${Math.round(down)}度。角度が戻ると、また見守ります`;
      else if (down != null) aria = `下向き ${Math.round(down)}度。このまま ${left}秒で知らせます`;
      $('floater').setAttribute('aria-label', aria);
      $('floater').dataset.tip = aria;
    }
  }

  function addTime(dtSec, isDown) {
    const key = dateKey(new Date());
    const day = ensureDay(key);
    const hour = new Date().getHours();
    day.useSec += dtSec;
    day.hourUse[hour] += dtSec;
    if (isDown) {
      day.downSec += dtSec;
      day.hours[hour] += dtSec;
    }
    mark();
  }

  function fireAlert(down) {
    alertArmed = false;
    badAccum = 0;
    sessionAlerts += 1;
    const day = ensureDay(dateKey(new Date()));
    day.alerts += 1;
    mark();
    const line = VOICE_ALERT[Math.floor(Math.random() * VOICE_ALERT.length)];
    let body = `基準より ${Math.round(down)}° 下がった状態が ${settings.durationSec}秒 続きました。画面を目の高さに近づけ、あごを軽く引いてみましょう。`;
    if (sessionAlerts >= 3) body += ' 続けて起きています。1分だけ、首を伸ばしましょう。';
    $('alert-body').textContent = body;
    paintDim($('alert-dim'));
    $('alert-layer').hidden = false;
    syncTint();
    $('alert-fix').focus();
    buzz([90, 50, 90]);
    chime('alert');
    speak(line);
    notify(line);
    renderChrome();
  }
  function closeAlert(suggest) {
    $('alert-layer').hidden = true;
    syncTint();
    if (suggest) maybeSuggest('下向きが続いていました。余裕があれば、1分だけ伸ばしましょう。');
  }
  function fireBreak() {
    const day = ensureDay(dateKey(new Date()));
    day.breaks += 1;
    mark();
    const line = VOICE_BREAK[Math.floor(Math.random() * VOICE_BREAK.length)];
    $('break-body').textContent = `同じ姿勢で約 ${settings.breakIntervalMin}分 見ています。完璧な角度を保ち続けることも、首や肩の負担になります。一度立ち上がって、その場で足踏みをしましょう。`;
    paintDim($('break-dim'));
    $('break-layer').hidden = false;
    syncTint();
    $('break-stand').focus();
    buzz([60, 40, 60, 40, 60]);
    chime('break');
    speak(line);
    notify(line);
    nextBreakAt = sessionMs + settings.breakIntervalMin * 60000;
  }
  function closeBreak(snooze) {
    $('break-layer').hidden = true;
    syncTint();
    nextBreakAt = sessionMs + (snooze ? 10 : settings.breakIntervalMin) * 60000;
    if (!snooze) toast('肩をひとつ回したら、また画面の高さを目線に近づけましょう。');
  }
  function maybeSuggest(text) {
    if (Date.now() - lastSuggest < 10 * 60 * 1000) return;
    if (!$('stretch-sheet').hidden) return;
    lastSuggest = Date.now();
    $('suggest-text').textContent = text;
    $('suggest').hidden = false;
  }

  function openStretch() {
    $('suggest').hidden = true;
    stretchPose = -1;
    stretchStart = performance.now();
    $('person').className = 'person';
    $('stretch-sheet').hidden = false;
    $('stretch-stop').focus();
    cancelAnimationFrame(stretchRaf);
    const step = (now) => {
      if ($('stretch-sheet').hidden) return;
      const elapsed = (now - stretchStart) / 1000;
      if (elapsed >= 60) { finishStretch(true); return; }
      const index = Math.min(3, Math.floor(elapsed / 15));
      if (index !== stretchPose) {
        stretchPose = index;
        const pose = POSES[index];
        $('person').className = `person ${pose.pose}`;
        $('stretch-kicker').textContent = `${index + 1} / 4`;
        $('stretch-title').textContent = pose.title;
        $('stretch-note').textContent = pose.note;
        if (index > 0) {
          if (settings.alerts.voice) speak(pose.title);
          buzz(20);
        } else if (settings.alerts.voice) {
          speak(pose.title);
        }
      }
      $('stretch-bar').style.width = `${(elapsed / 60) * 100}%`;
      $('stretch-count').textContent = `残り ${Math.min(60, Math.max(0, Math.ceil(60 - elapsed)))}秒`;
      stretchRaf = requestAnimationFrame(step);
    };
    stretchRaf = requestAnimationFrame(step);
  }
  function finishStretch(done) {
    cancelAnimationFrame(stretchRaf);
    $('stretch-sheet').hidden = true;
    syncTint();
    if (done) {
      ensureDay(dateKey(new Date())).stretches += 1;
      mark();
      save();
      toast('よくできました。画面を、今の目線の高さに近づけましょう。');
      speak('よくできました。画面を目の高さに戻しましょう。');
      renderGoal();
      if (!$('screen-record').hidden) renderRecord();
    } else {
      toast('途中で終わりました。痛みがあるときは、それで大丈夫です。');
    }
  }

  function openCal() {
    calToken += 1;
    $('cal-count').hidden = true;
    $('cal-result').hidden = true;
    $('cal-go').disabled = false;
    $('cal-sheet').hidden = false;
    const beta = readBeta();
    $('cal-live').textContent = beta == null ? 'いま —°' : `いま ${Math.round(beta)}°`;
    $('cal-go').focus();
  }
  function closeCal() {
    calToken += 1;
    $('cal-sheet').hidden = true;
    $('cal-go').disabled = false;
  }
  async function runCal() {
    const token = ++calToken;
    const samples = [];
    $('cal-go').disabled = true;
    $('cal-result').hidden = true;
    for (let i = 3; i >= 1; i--) {
      $('cal-count').hidden = false;
      $('cal-count').textContent = String(i);
      const t0 = performance.now();
      while (performance.now() - t0 < 1000) {
        if (token !== calToken) return;
        const b = readBeta();
        if (b != null) samples.push(b);
        await new Promise((r) => setTimeout(r, 80));
      }
    }
    if (token !== calToken) return;
    $('cal-count').hidden = true;
    $('cal-go').disabled = false;
    if (samples.length < 5) {
      toast('角度を読み取れませんでした。持ち方を保ったまま、もう一度どうぞ。');
      return;
    }
    const avg = samples.reduce((s, n) => s + n, 0) / samples.length;
    settings.baseline = Math.round(avg * 10) / 10;
    badAccum = 0;
    alertArmed = true;
    save();
    $('cal-result').hidden = false;
    $('cal-result').textContent = `基準を ${Math.round(settings.baseline)}° にしました。ここから ${settings.threshold}° 以上下がると知らせます。`;
    renderSettings();
  }

  async function startWatch() {
    const sensorPromise = ensureSensorPermission();
    if (settings.alerts.notification) ensureNotify();
    const permitted = await sensorPromise;
    if (!permitted) {
      allowSim = true;
      toast('センサーが使えません。つまみで傾きを試せます。');
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    watching = true;
    readyAt = performance.now() + 800;
    sessionMs = 0;
    sessionAlerts = 0;
    longSuggested = false;
    badAccum = 0;
    alertArmed = true;
    nextBreakAt = settings.breakIntervalMin * 60000;
    $('start-btn').classList.add('quiet');
    $('start-btn').setAttribute('aria-pressed', 'true');
    $('start-label').textContent = '見守りを止める';
    $('live-dot').hidden = false;
    await lockWake();
    if (settings.baseline == null) toast('基準は 55° です。あとから合わせられます。');
    renderChrome();
  }
  function stopWatch() {
    watching = false;
    badAccum = 0;
    $('start-btn').classList.remove('quiet');
    $('start-btn').setAttribute('aria-pressed', 'false');
    $('start-label').textContent = '見守りを始める';
    $('live-dot').hidden = true;
    unlockWake();
    save();
    renderChrome();
    renderGoal();
  }

  function showScreen(name) {
    ['watch', 'record', 'stretch', 'settings'].forEach((id) => {
      $(`screen-${id}`).hidden = id !== name;
      const tab = $(`tab-${id}`);
      if (id === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    $('main').scrollTop = 0;
    if (name === 'record') renderRecord();
    if (name === 'settings') renderSettings();
    renderChrome();
  }

  function syncScene() {
    const found = ['commute', 'desk', 'night'].find((name) => {
      const preset = SCENES[name];
      return preset.threshold === settings.threshold
        && preset.durationSec === settings.durationSec
        && preset.breakIntervalMin === settings.breakIntervalMin;
    });
    settings.scene = found || 'custom';
  }
  function applyScene(name) {
    const preset = SCENES[name];
    settings.scene = name;
    if (preset && name !== 'custom') {
      settings.threshold = preset.threshold;
      settings.durationSec = preset.durationSec;
      settings.breakIntervalMin = preset.breakIntervalMin;
      if (watching) nextBreakAt = sessionMs + preset.breakIntervalMin * 60000;
    }
    save();
    renderSettings();
  }

  function positionFloater() {
    if (settings.floaterX == null) return;
    const el = $('floater');
    el.style.left = `${settings.floaterX}px`;
    el.style.top = `${settings.floaterY}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }
  function appBox() {
    return document.querySelector('.app').getBoundingClientRect();
  }
  function clampFloater() {
    const el = $('floater');
    if (!el.style.left) return;
    const box = appBox();
    const l = clamp(parseFloat(el.style.left) || 0, 8, Math.max(8, box.width - 72));
    const t = clamp(parseFloat(el.style.top) || 0, 8, Math.max(8, box.height - 150));
    el.style.left = `${l}px`;
    el.style.top = `${t}px`;
  }

  $('start-btn').addEventListener('click', () => {
    if (watching) stopWatch();
    else startWatch();
  });
  $('welcome-start').addEventListener('click', () => {
    settings.welcomed = true;
    save();
    $('welcome').hidden = true;
    document.documentElement.classList.add('welcomed');
  });
  if (settings.welcomed) $('welcome').hidden = true;

  $('banner-cal').addEventListener('click', openCal);
  $('open-cal').addEventListener('click', openCal);
  $('cal-go').addEventListener('click', runCal);
  $('cal-cancel').addEventListener('click', closeCal);
  $('alert-fix').addEventListener('click', () => closeAlert(true));
  $('alert-stretch').addEventListener('click', () => { closeAlert(false); openStretch(); });
  $('break-stand').addEventListener('click', () => closeBreak(false));
  $('break-snooze').addEventListener('click', () => closeBreak(true));
  $('start-stretch').addEventListener('click', openStretch);
  $('open-stretch-link').addEventListener('click', openStretch);
  $('stretch-stop').addEventListener('click', () => finishStretch(false));
  $('suggest-go').addEventListener('click', openStretch);
  $('suggest-x').addEventListener('click', () => { $('suggest').hidden = true; });
  $('scene-chip').addEventListener('click', () => showScreen('settings'));
  $('tab-watch').addEventListener('click', () => showScreen('watch'));
  $('tab-record').addEventListener('click', () => showScreen('record'));
  $('tab-stretch').addEventListener('click', () => showScreen('stretch'));
  $('tab-settings').addEventListener('click', () => showScreen('settings'));

  ['commute', 'desk', 'night'].forEach((name) => {
    $(`scene-${name}`).addEventListener('click', () => applyScene(name));
  });
  $('threshold').addEventListener('input', (e) => {
    settings.threshold = Number(e.target.value);
    syncScene();
    save();
    renderSettings();
  });
  $('duration').addEventListener('input', (e) => {
    settings.durationSec = Number(e.target.value);
    syncScene();
    badAccum = 0;
    save();
    renderSettings();
  });
  [30, 45, 60].forEach((min) => {
    $(`break-${min}`).addEventListener('click', () => {
      settings.breakIntervalMin = min;
      if (watching) nextBreakAt = sessionMs + min * 60000;
      syncScene();
      save();
      renderSettings();
    });
  });
  $('goal-minus').addEventListener('click', () => {
    settings.goalReduceMin = clamp(settings.goalReduceMin - 1, 1, 20);
    save();
    renderSettings();
  });
  $('goal-plus').addEventListener('click', () => {
    settings.goalReduceMin = clamp(settings.goalReduceMin + 1, 1, 20);
    save();
    renderSettings();
  });
  document.querySelectorAll('.switch[data-alert]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.alert;
      settings.alerts[key] = !settings.alerts[key];
      if (key === 'notification' && settings.alerts.notification) await ensureNotify();
      save();
      renderSettings();
    });
  });
  $('toggle-sim').addEventListener('click', () => {
    settings.forceSim = !settings.forceSim;
    if (settings.forceSim) sensorMode = 'none';
    save();
    renderSettings();
  });
  $('sim-range').addEventListener('input', (e) => {
    simBeta = Number(e.target.value);
    $('sim-val').textContent = `${Math.round(simBeta)}°`;
    if (usingSim()) smoothBeta = simBeta;
  });
  $('wipe').addEventListener('click', () => { $('wipe-yes').hidden = false; });
  $('wipe-yes').addEventListener('click', () => {
    localStorage.removeItem(KEY);
    location.reload();
  });
  $('install-btn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('install-btn').hidden = true;
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('install-btn').hidden = false;
  });

  const floater = $('floater');
  floater.addEventListener('pointerdown', (e) => {
    drag.on = true;
    drag.id = e.pointerId;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const host = appBox();
    const rect = floater.getBoundingClientRect();
    drag.left = rect.left - host.left;
    drag.top = rect.top - host.top;
    drag.moved = false;
    floater.classList.remove('bob');
    floater.setPointerCapture(e.pointerId);
  });
  floater.addEventListener('pointermove', (e) => {
    if (!drag.on || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    const host = appBox();
    const left = clamp(drag.left + dx, 8, Math.max(8, host.width - 72));
    const top = clamp(drag.top + dy, 8, Math.max(8, host.height - 150));
    floater.style.left = `${left}px`;
    floater.style.top = `${top}px`;
    floater.style.right = 'auto';
    floater.style.bottom = 'auto';
  });
  function endDrag(e) {
    if (!drag.on || e.pointerId !== drag.id) return;
    drag.on = false;
    floater.classList.add('bob');
    if (!drag.moved) {
      const tip = $('floater-tip');
      tip.textContent = floater.dataset.tip || '';
      tip.classList.add('show');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => tip.classList.remove('show'), 2200);
    } else {
      settings.floaterX = parseFloat(floater.style.left);
      settings.floaterY = parseFloat(floater.style.top);
      save();
    }
  }
  floater.addEventListener('pointerup', endDrag);
  floater.addEventListener('pointercancel', endDrag);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('stretch-sheet').hidden) { finishStretch(false); return; }
    if (!$('alert-layer').hidden) { closeAlert(false); return; }
    if (!$('break-layer').hidden) { closeBreak(true); return; }
    if (!$('cal-sheet').hidden) closeCal();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      save();
    } else if (watching) {
      lockWake();
      if (hiddenAt && Date.now() - hiddenAt > 1500) toast('裏に回っている間は、測定を止めていました');
    }
  });
  window.addEventListener('pagehide', save);
  window.addEventListener('resize', () => {
    clampFloater();
    if (!$('screen-record').hidden) renderRecord();
  });

  let lastFrame = performance.now();
  let readyAt = 0;
  function frame(now) {
    const gap = now - lastFrame;
    lastFrame = now;
    if (gap > 1500 || document.hidden) {
      updateVisuals();
      requestAnimationFrame(frame);
      return;
    }
    const dt = gap;
    const { down } = sample();
    const key = dateKey(new Date());
    if (key !== todayKey) {
      todayKey = key;
      finalizeGoals();
      save();
    }
    if (watching && down != null && now >= readyAt) {
      const isDown = down >= settings.threshold;
      addTime(dt / 1000, isDown);
      sessionMs += dt;
      const recoverAt = Math.max(5, settings.threshold - 8);
      if (modalBlocking()) {
        /* シートを出しているあいだは、秒数を進めない */
      } else if (isDown && alertArmed) {
        badAccum += dt;
        if (badAccum >= settings.durationSec * 1000) fireAlert(down);
      } else if (!isDown) {
        badAccum = 0;
        if (down <= recoverAt) alertArmed = true;
      }
      if (!modalBlocking() && sessionMs >= nextBreakAt) {
        if (!$('alert-layer').hidden || !$('stretch-sheet').hidden) nextBreakAt = sessionMs + 20000;
        else fireBreak();
      }
      if (!longSuggested && sessionMs >= 20 * 60 * 1000 && !modalBlocking()) {
        longSuggested = true;
        maybeSuggest('20分たちました。一度、首と肩を動かしましょう。');
      }
      if (!$('alert-layer').hidden && down != null && down <= recoverAt) {
        if (!recoverSince) recoverSince = now;
        else if (now - recoverSince > 1200) closeAlert(false);
      } else {
        recoverSince = 0;
      }
      chartAcc += dt;
      if (chartAcc > 1000) {
        chartAcc = 0;
        renderChrome();
        renderGoal();
        if (!$('screen-record').hidden) renderRecord();
      }
    }
    updateVisuals();
    requestAnimationFrame(frame);
  }

  setInterval(() => { if (dirty) save(); }, 5000);
  setTimeout(() => { allowSim = true; renderChrome(); }, 1200);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  const fg = $('g-fg');
  requestAnimationFrame(() => {
    try { gaugeLen = fg.getTotalLength() || 251.3; } catch (e) { gaugeLen = 251.3; }
  });
  finalizeGoals();
  positionFloater();
  renderSettings();
  showScreen('watch');
  if (settings.welcomed) $('welcome').hidden = true;
  requestAnimationFrame(frame);
})();
