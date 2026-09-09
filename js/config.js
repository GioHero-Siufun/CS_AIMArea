/* CS2 基本功训练器 · 全局配置 / 设置持久化
 * 移动常量取自 CS2 官方控制台参数（totalcsgo 指令库）：
 *   sv_accelerate 5.5 / sv_friction 5.2 / sv_stopspeed 80 / sv_airaccelerate 12
 * 重力 800 u/s²，起跳竖直速度 301.99 u/s（Source 引擎标准）。
 * 武器移速表来自社区测量（刀/C4 250、AK-47 215、AWP 200 …）。
 */
(function () {
  'use strict';
  window.CSX = window.CSX || {};
  var S = window.CSX;

  S.CS2 = {
    accel: 5.5,
    friction: 5.2,
    stopSpeed: 80,
    airAccel: 12,
    gravity: 800,
    jumpVel: 301.99,
    maxSpeed: 250
  };
  S.TICK = 1 / 128;          // 固定物理步长（贴近 CS2 subtick 的平滑度）
  S.STOP_THRESHOLD = 6;      // 判定"已停下"的速度 (u/s)

  S.WEAPONS = [
    { id: 'knife',  name: '刀 / C4',          speed: 250 },
    { id: 'nade',   name: '手雷',             speed: 245 },
    { id: 'pistol', name: '手枪',             speed: 240 },
    { id: 'deagle', name: '沙漠之鹰',          speed: 230 },
    { id: 'mp9',    name: 'MP9 / MAC10 / Bizon', speed: 240 },
    { id: 'p90',    name: 'P90 / UMP45',      speed: 230 },
    { id: 'mp7',    name: 'MP7',              speed: 220 },
    { id: 'famas',  name: 'FAMAS / AUG',      speed: 220 },
    { id: 'm4',     name: 'M4A1-S / M4A4',    speed: 225 },
    { id: 'ak',     name: 'AK-47 / Galil',    speed: 215 },
    { id: 'ssg',    name: 'SSG 08',           speed: 230 },
    { id: 'awp',    name: 'AWP',              speed: 200 },
    { id: 'awpz',   name: 'AWP (开镜)',       speed: 100 },
    { id: 'm249',   name: 'M249',             speed: 195 },
    { id: 'negev',  name: 'Negev',            speed: 150 },
    { id: 'custom', name: '自定义…',          speed: null }
  ];

  S.DEFAULTS = {
    tab: 'left',
    sound: true,
    weapon: 'knife',
    customSpeed: 250,
    left: { dist: 2, vector: true, auto: true, mode: 'train', ring: 56, obstacles: [] },
    aim: { mode: 'flick', sens: 2.0, dpi: 400, fov: 90, move: false,
      ballR: 14, ballColor: '#e8b339', dirs: [true, true, true, true, true], hoverSecs: 3,
      wpOff: { x: 0, y: 0 },
      cross: { color: '#7fd8ff', style: 'cross', gap: 5, len: 7, thick: 2, dot: false, outline: false, dynamic: true } }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function deep(base, patch) {
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      var v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        deep(base[k], v);
      } else {
        base[k] = v;
      }
    }
    return base;
  }

  var settings = null;
  try {
    var raw = localStorage.getItem('csx.settings.v1');
    if (raw) settings = deep(clone(S.DEFAULTS), JSON.parse(raw));
  } catch (e) { /* localStorage 不可用时使用默认值 */ }
  if (!settings) settings = clone(S.DEFAULTS);
  S.settings = settings;

  S.saveSettings = function () {
    try { localStorage.setItem('csx.settings.v1', JSON.stringify(S.settings)); } catch (e) {}
  };

  S.findWeapon = function (id) {
    for (var i = 0; i < S.WEAPONS.length; i++) if (S.WEAPONS[i].id === id) return S.WEAPONS[i];
    return null;
  };
  S.weaponSpeed = function () {
    var w = S.findWeapon(S.settings.weapon);
    if (!w) return 250;
    return w.speed != null ? w.speed : S.settings.customSpeed;
  };

  /* ---- CS 式准星（左右手训练共用） ---- */
  S.CROSS_COLORS = [
    { n: '青(默认)', c: '#7fd8ff' },
    { n: '绿', c: '#00ff00' },
    { n: '黄', c: '#ffff00' },
    { n: '蓝', c: '#00bfff' },
    { n: '粉', c: '#ff00ff' },
    { n: '白', c: '#ffffff' },
    { n: '红', c: '#ff0000' }
  ];
  /* kick: 射击扩散(0..1)  moveFrac: 移动速度占比(0..1); dynamic 开启时准星扩散 */
  S.drawCrosshair = function (ctx, x, y, cfg, kick, moveFrac) {
    var TAU = Math.PI * 2;
    var gap = cfg.gap + (cfg.dynamic ? kick * 9 + moveFrac * 8 : 0);
    var len = cfg.len, th = cfg.thick;
    var arms = cfg.style === 'cross' ? [0, 1, 2, 3] : cfg.style === 't' ? [1, 2, 3] : [];
    function strokeArms(color, wdt) {
      if (!arms.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = wdt;
      ctx.beginPath();
      for (var i = 0; i < arms.length; i++) {
        var a = arms[i];
        if (a === 0) { ctx.moveTo(x, y - gap); ctx.lineTo(x, y - gap - len); }
        else if (a === 1) { ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len); }
        else if (a === 2) { ctx.moveTo(x - gap, y); ctx.lineTo(x - gap - len, y); }
        else { ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y); }
      }
      ctx.stroke();
    }
    function dot(col, r) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    if (cfg.outline) {
      strokeArms('rgba(0,0,0,0.85)', th + 2.5);
      if (cfg.dot) dot('rgba(0,0,0,0.85)', th * 0.55 + 1.5);
    }
    strokeArms(cfg.color, th);
    if (cfg.dot) dot(cfg.color, Math.max(1.5, th * 0.55));
  };
})();
