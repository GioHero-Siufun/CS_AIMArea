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
      ballR: 14, ballColor: '#e8b339', dirs: [true, true, true, true, true], hoverSecs: 3 }
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
})();
