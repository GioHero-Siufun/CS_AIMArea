/* 右手 · 瞄准训练
 * 类 aim_botz 的 3D 打靶训练：指针锁定 + 视角瞄准 + 射线命中判定。
 * 灵敏度一律按 CS2 换算：角度(°) = 0.022 × 灵敏度 × 鼠标计数（1 像素计 = 1 计数）。
 */
(function () {
  'use strict';
  var S = window.CSX;
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  var NEAR = 0.5;
  var HALF_X = 320, ZMIN = -260, ZMAX = 340, WALL_H = 200, BALL_R = 14, EYE = 64;
  var TIME_LIMIT = 60;
  var WALLS = [
    { type: 'x', at: HALF_X }, { type: 'x', at: -HALF_X },
    { type: 'z', at: ZMAX }, { type: 'z', at: ZMIN }
  ];

  function $(id) { return document.getElementById(id); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function basis(yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return {
      right: { x: cy, y: 0, z: -sy },
      up: { x: -sy * sp, y: cp, z: -cy * sp },
      fwd: { x: sy * cp, y: sp, z: cy * cp }
    };
  }
  function toCam(p, cam, b) {
    var dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
    return {
      x: dx * b.right.x + dy * b.right.y + dz * b.right.z,
      y: dx * b.up.x + dy * b.up.y + dz * b.up.z,
      z: dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z
    };
  }
  function project(c, f, w, h) { return { x: w / 2 + f * c.x / c.z, y: h / 2 - f * c.y / c.z }; }

  function clipSegZ(a, b, near) { /* camera-space 线段裁剪 z>=near */
    var aIn = a.z >= near, bIn = b.z >= near;
    if (!aIn && !bIn) return null;
    if (aIn && bIn) return [a, b];
    var t = (near - a.z) / (b.z - a.z);
    var m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near };
    return aIn ? [a, m] : [m, b];
  }
  function clipPolyZ(pts, near) { /* Sutherland–Hodgman */
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      var aIn = a.z >= near, bIn = b.z >= near;
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        var t = (near - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near });
      }
    }
    return out;
  }

  var WALL_QUADS = {
    x0: [{ x: HALF_X, y: 0, z: ZMIN }, { x: HALF_X, y: 0, z: ZMAX }, { x: HALF_X, y: WALL_H, z: ZMAX }, { x: HALF_X, y: WALL_H, z: ZMIN }],
    x1: [{ x: -HALF_X, y: 0, z: ZMIN }, { x: -HALF_X, y: 0, z: ZMAX }, { x: -HALF_X, y: WALL_H, z: ZMAX }, { x: -HALF_X, y: WALL_H, z: ZMIN }],
    z0: [{ x: -HALF_X, y: 0, z: ZMAX }, { x: HALF_X, y: 0, z: ZMAX }, { x: HALF_X, y: WALL_H, z: ZMAX }, { x: -HALF_X, y: WALL_H, z: ZMAX }],
    z1: [{ x: -HALF_X, y: 0, z: ZMIN }, { x: HALF_X, y: 0, z: ZMIN }, { x: HALF_X, y: WALL_H, z: ZMIN }, { x: -HALF_X, y: WALL_H, z: ZMIN }]
  };

  /* ---- 颜色工具 ---- */
  function hexRgb(h) {
    h = String(h || '#e8b339').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return [232, 179, 57];
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function hexLerp(h, target, t) {
    var c = hexRgb(h);
    var r = Math.round(c[0] + (target - c[0]) * t);
    var g = Math.round(c[1] + (target - c[1]) * t);
    var b = Math.round(c[2] + (target - c[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ---- 墙面设置面板几何 (后墙, z = ZMAX) ---- */
  var WP = {
    z: 0, x1: 40, x2: 320, y1: 32, y2: 238,
    red: { id: 'red', x1: 130, y1: 88, x2: 230, y2: 132 },
    tabBall: { id: 'tab-ball', x1: 172, y1: 42, x2: 228, y2: 72 },
    tabCross: { id: 'tab-cross', x1: 232, y1: 42, x2: 286, y2: 72 },
    close: { id: 'close', x1: 290, y1: 40, x2: 314, y2: 68 },
    sizeTk: { id: 'size', x1: 124, y1: 86, x2: 246, y2: 104 },
    hoverTk: { id: 'hover', x1: 124, y1: 206, x2: 246, y2: 224 },
    gapTk: { id: 'gap', x1: 124, y1: 148, x2: 246, y2: 166 },
    lenTk: { id: 'len', x1: 124, y1: 170, x2: 246, y2: 188 },
    thickTk: { id: 'thick', x1: 124, y1: 192, x2: 246, y2: 210 },
    ball: { cx0: 52, gap: 40, sz: 22, colorY: 114, dirY1: 150, dirY2: 178, dirH: 22 },
    cross: { cx0: 52, gap: 30, sz: 20, colorY: 86, styleY: 112, styleH: 24, styleW: 46,
      togY: 206, togH: 22, togW: 60 }
  };
  WP.z = ZMAX - 0.6;
  var BALL_COLORS = ['#e8b339', '#7fd8ff', '#8ae99a', '#f27cc4', '#ffffff', '#e2594e'];
  var DIR_NAMES = ['前', '后', '左', '右', '空中'];
  var STYLE_LIST = [['cross', '十字'], ['t', 'T形'], ['dot', '点']];
  var TOG_LIST = [['dot', '点'], ['outline', '描边'], ['dynamic', '动态']];

  function AimGame() {
    var self = this;
    this.canvas = $('aimCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.els = {
      hits: $('aim-hits'), shots: $('aim-shots'), acc: $('aim-acc'),
      kpm: $('aim-kpm'), react: $('aim-react'),
      timer: $('aim-timer'), timerChip: $('aim-timerChip'), best: $('aim-best'),
      msg: $('aim-msg'),
      lockOverlay: $('aimLockOverlay'), lockBtn: $('aimLockBtn'),
      end: $('aimEnd'), endStats: $('aimEndStats'),
      endAgain: $('aimEndAgain'), endClose: $('aimEndClose'),
      sens: $('aim-sens'), sensVal: $('aim-sensVal'), dpi: $('aim-dpi'), cm360: $('aim-cm360'),
      fov: $('aim-fov'), fovVal: $('aim-fovVal'), move: $('aim-move'),
      wallHint: $('wallCfgHint'),
      modeBtns: document.querySelectorAll('.mode-btn')
    };
    this.sets = S.settings.aim;

    // 视角 / 玩家
    this.player = { x: 0, y: 0, z: 40 };
    this.move = new S.Movement(S.CS2);
    this.move.reset(this.player.x, this.player.z);
    this.yaw = 0; this.pitch = 0;
    this.keys = { w: false, a: false, s: false, d: false };
    this.jumpEdge = false;

    // 场景
    this.mode = 'flick';
    this.balls = [];
    this.animT = 0;
    this.fx = [];
    this.cooldown = 0;
    this.crosshairKick = 0;
    this.hitMark = 0;
    this.missFlash = 0;
    this.react = { phase: 'wait', t: 0, t0: 0 };
    this.over = false;
    this.endOpen = false;

    // 小球外观/出现设置
    this.ballR = +this.sets.ballR || 14;
    this.ballColor = this.sets.ballColor || '#e8b339';
    this.dirs = (this.sets.dirs && this.sets.dirs.length === 5) ? this.sets.dirs.slice() : [true, true, true, true, true];
    this.hoverSecs = +this.sets.hoverSecs || 3;
    this.ballCss = null; this.ballRgb = null;
    this.applyBallStyle();

    this.stats = { hits: 0, shots: 0, active: 0, reacts: [], lastMs: 0, escapes: 0 };
    this.bestTime = 0;
    try { this.bestTime = +localStorage.getItem('csx.aim.best.time') || 0; } catch (e) {}

    this.locked = false;
    this.lockSupported = 'requestPointerLock' in this.canvas;
    this.mouseX = -1; this.mouseY = -1;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.cross = S.settings.aim.cross;
    this.wallUI = { open: false, tab: 'ball', drag: null, hover: null };

    this.bindEvents();
    this.resize();
    this.setMode(this.sets.mode, true);
    this.applyControls();

    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame(function (t) { self.frame(t); });
  }

  AimGame.prototype.bindEvents = function () {
    var self = this;
    var canvas = this.canvas;

    window.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'KeyW') self.keys.w = true;
      if (e.code === 'KeyA') self.keys.a = true;
      if (e.code === 'KeyS') self.keys.s = true;
      if (e.code === 'KeyD') self.keys.d = true;
      if (e.code === 'Space') self.jumpEdge = true;
      if (e.code === 'KeyR') self.respawnAll();
      if (e.code === 'Digit1') self.setMode('flick');
      if (e.code === 'Digit2') self.setMode('track');
      if (e.code === 'Digit3') self.setMode('react');
      if (e.code === 'Digit4') self.setMode('time');
      if (e.code === 'Digit5') self.setMode('follow');
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'KeyW') self.keys.w = false;
      if (e.code === 'KeyA') self.keys.a = false;
      if (e.code === 'KeyS') self.keys.s = false;
      if (e.code === 'KeyD') self.keys.d = false;
    });
    window.addEventListener('blur', function () {
      self.keys.w = self.keys.a = self.keys.s = self.keys.d = false;
    });

    canvas.addEventListener('mousemove', function (e) {
      if (self.locked) {
        var cg = 0.022 * self.sens * DEG;
        self.yaw += e.movementX * cg;
        self.pitch -= e.movementY * cg;
        self.pitch = clamp(self.pitch, -87 * DEG, 87 * DEG);
      } else {
        var r = canvas.getBoundingClientRect();
        self.mouseX = e.clientX - r.left;
        self.mouseY = e.clientY - r.top;
        var hov = self.uiHitFromMouse();
        self.wallUI.hover = hov ? hov.id : null;
        canvas.style.cursor = hov ? 'pointer' : 'default';
      }
    });
    canvas.addEventListener('mousedown', function (e) {
      canvas.blur();
      if (e.button !== 0 && e.button !== 2) return;
      if (!self.locked) {
        if (self.endOpen) return; /* 结算遮罩打开时不要误操作 */
        var uiEl = self.uiHitFromMouse();
        if (uiEl) { self.uiPress(uiEl); return; } /* 墙面设置面板交互 */
        self.lockPointer();
        return;
      }
      e.preventDefault();
      self.shoot();
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* 墙面面板: 滑杆拖动 & 拖拽结束 */
    window.addEventListener('mousemove', function (e) {
      if (!self.wallUI.drag) return;
      var r = canvas.getBoundingClientRect();
      var b = basis(self.yaw, self.pitch);
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var dir = self.aimDirAt(mx, my, b);
      var wp = self.wallHitFromDir(dir);
      if (wp) self.uiDragSet(self.wallUI.drag, wp.x);
    });
    window.addEventListener('mouseup', function () {
      if (self.wallUI.drag) { self.wallUI.drag = null; S.saveSettings(); }
    });

    document.addEventListener('pointerlockchange', function () {
      self.locked = document.pointerLockElement === canvas;
      if (!self.locked) self.keyUpAll();
      if (self.locked) self.wallUI.open = false; /* 锁定即收起墙面面板 */
      self.updateOverlays();
    });
    document.addEventListener('pointerlockerror', function () {
      self.locked = false;
      self.updateOverlays();
    });

    this.els.lockBtn.addEventListener('click', function () { self.lockPointer(); });
    this.els.endAgain.addEventListener('click', function () {
      self.els.endAgain.blur();
      self.endOpen = false;
      self.over = false;
      self.setMode('time', true);
      self.hideEnd();
      self.updateOverlays();
      self.lockPointer();
    });
    this.els.endClose.addEventListener('click', function () {
      self.els.endClose.blur();
      self.endOpen = false;
      self.hideEnd();
      self.setMode('flick');
      self.updateOverlays();
    });

    for (var i = 0; i < this.els.modeBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          btn.blur();
          self.setMode(btn.getAttribute('data-mode'));
        });
      })(this.els.modeBtns[i]);
    }

    window.addEventListener('resize', function () { self.resize(); });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { self.resize(); }).observe(self.canvas.parentElement);
    }
    window.addEventListener('csx-sens-changed', function () { self.applyControls(); });

    // 控制项
    this.els.sens.value = String(this.sets.sens);
    this.els.dpi.value = String(this.sets.dpi);
    this.els.fov.value = String(this.sets.fov);
    this.els.move.checked = !!this.sets.move;
    this.els.sens.addEventListener('input', function () {
      self.sets.sens = +self.els.sens.value;
      self.sens = self.sets.sens;
      self.els.sensVal.textContent = self.sets.sens.toFixed(2);
      self.updateCm360();
      S.saveSettings();
      window.dispatchEvent(new Event('csx-sens-changed')); // 左手训练同步
    });
    this.els.dpi.addEventListener('change', function () {
      self.els.dpi.blur();
      self.sets.dpi = +self.els.dpi.value;
      self.updateCm360();
      S.saveSettings();
    });
    this.els.fov.addEventListener('input', function () {
      self.sets.fov = +self.els.fov.value;
      self.fov = self.sets.fov;
      self.els.fovVal.textContent = self.sets.fov;
      S.saveSettings();
      window.dispatchEvent(new Event('csx-sens-changed')); // 左手训练同步
    });
    this.els.move.addEventListener('change', function () {
      self.sets.move = self.els.move.checked;
      if (!self.sets.move) { self.move.reset(self.player.x, self.player.z); }
      S.saveSettings();
    });

  };

  /* ============ 墙面设置面板 (场景内 3D UI, 射击红色按钮展开) ============ */
  AimGame.prototype.applyBallStyle = function () {
    var c = this.ballColor || '#e8b339';
    this.ballCss = { light: hexLerp(c, 255, 0.45), base: c, dark: hexLerp(c, 0, 0.45) };
    this.ballRgb = hexRgb(c);
  };
  AimGame.prototype.setBallSize = function (v) {
    this.ballR = v;
    this.sets.ballR = v;
    for (var i = 0; i < this.balls.length; i++) this.balls[i].r = v;
    S.saveSettings();
  };
  AimGame.prototype.setBallColor = function (c) {
    this.ballColor = c;
    this.sets.ballColor = c;
    this.applyBallStyle();
    S.saveSettings();
  };
  AimGame.prototype.aimDirAt = function (mx, my, b) {
    var f = this.focal();
    var sx = (mx - this.w / 2) / f;
    var sy = (this.h / 2 - my) / f;
    var d = {
      x: b.fwd.x + b.right.x * sx + b.up.x * sy,
      y: b.fwd.y + b.right.y * sx + b.up.y * sy,
      z: b.fwd.z + b.right.z * sx + b.up.z * sy
    };
    var l = Math.hypot(d.x, d.y, d.z) || 1;
    return { x: d.x / l, y: d.y / l, z: d.z / l };
  };
  AimGame.prototype.wallHitFromDir = function (dir, cam) {
    cam = cam || this.camVec();
    var zp = WP.z;
    if (dir.z < 1e-6) return null;
    var t = (zp - cam.z) / dir.z;
    if (t < NEAR) return null;
    return { x: cam.x + dir.x * t, y: cam.y + dir.y * t, t: t };
  };
  AimGame.prototype.wallHitFromMouse = function () {
    var b = basis(this.yaw, this.pitch);
    return this.wallHitFromDir(this.aimDir(b));
  };

  AimGame.prototype.uiElems = function () {
    var list;
    if (!this.wallUI.open) return [WP.red]; /* 收起时只有红色设置按钮可交互 */
    list = [WP.tabBall, WP.tabCross, WP.close];
    var i, x, wd;
    if (this.wallUI.tab === 'ball') {
      list.push(WP.sizeTk, WP.hoverTk);
      for (i = 0; i < BALL_COLORS.length; i++) {
        x = WP.ball.cx0 + i * WP.ball.gap;
        list.push({ id: 'c-' + BALL_COLORS[i], x1: x, y1: WP.ball.colorY, x2: x + WP.ball.sz, y2: WP.ball.colorY + WP.ball.sz });
      }
      for (i = 0; i < 5; i++) {
        var row = i < 3 ? 0 : 1;
        var cx = 52 + (i < 3 ? i * 60 : (i - 3) * 60);
        wd = (i === 4) ? 72 : 52;
        var cy = row === 0 ? WP.ball.dirY1 : WP.ball.dirY2;
        list.push({ id: 'dir-' + i, x1: cx, y1: cy, x2: cx + wd, y2: cy + WP.ball.dirH });
      }
    } else {
      for (i = 0; i < S.CROSS_COLORS.length; i++) {
        x = WP.cross.cx0 + i * WP.cross.gap;
        list.push({ id: 'chc-' + i, x1: x, y1: WP.cross.colorY, x2: x + WP.cross.sz, y2: WP.cross.colorY + WP.cross.sz });
      }
      for (i = 0; i < STYLE_LIST.length; i++) {
        var sx2 = 52 + i * 60;
        list.push({ id: 'st-' + STYLE_LIST[i][0], x1: sx2, y1: WP.cross.styleY, x2: sx2 + WP.cross.styleW, y2: WP.cross.styleY + WP.cross.styleH });
      }
      list.push(WP.gapTk, WP.lenTk, WP.thickTk);
      for (i = 0; i < TOG_LIST.length; i++) {
        var tx = 52 + i * 70;
        list.push({ id: 'tg-' + TOG_LIST[i][0], x1: tx, y1: WP.cross.togY, x2: tx + WP.cross.togW, y2: WP.cross.togY + WP.cross.togH });
      }
    }
    return list;
  };

  AimGame.prototype.uiHit = function (x, y) {
    var list = this.uiElems();
    for (var i = list.length - 1; i >= 0; i--) {
      var el = list[i];
      if (x >= el.x1 && x <= el.x2 && y >= el.y1 && y <= el.y2) return el;
    }
    return null;
  };
  AimGame.prototype.uiHitFromMouse = function () {
    var wp = this.wallHitFromMouse();
    if (!wp) return null;
    var el = this.uiHit(wp.x, wp.y);
    this.wallUI.lastP = wp;
    return el;
  };

  AimGame.prototype.openWallUI = function () {
    this.wallUI.open = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.canvas.style.cursor = 'default';
    this.updateOverlays();
    S.SFX.ui();
  };
  AimGame.prototype.closeWallUI = function () {
    this.wallUI.open = false;
    this.wallUI.drag = null;
    this.updateOverlays();
    S.SFX.ui();
  };

  AimGame.prototype.uiPress = function (el) {
    var self = this;
    var w = this.wallUI;
    var x = w.lastP ? w.lastP.x : 0;
    if (el.id === 'red') { w.open ? this.closeWallUI() : this.openWallUI(); return; }
    if (el.id === 'close') { this.closeWallUI(); return; }
    if (el.id === 'tab-ball') { w.tab = 'ball'; S.SFX.ui(); return; }
    if (el.id === 'tab-cross') { w.tab = 'cross'; S.SFX.ui(); return; }
    if (el.id.indexOf('c-') === 0) { this.setBallColor(el.id.slice(2)); S.SFX.ui(); return; }
    if (el.id.indexOf('dir-') === 0) {
      var di = +el.id.slice(4);
      this.dirs[di] = !this.dirs[di];
      this.sets.dirs = this.dirs.slice();
      S.saveSettings();
      this.respawnAll();
      S.SFX.ui();
      return;
    }
    if (el.id.indexOf('chc-') === 0) {
      this.cross.color = S.CROSS_COLORS[+el.id.slice(4)].c;
      S.saveSettings();
      S.SFX.ui();
      return;
    }
    if (el.id.indexOf('st-') === 0) {
      this.cross.style = el.id.slice(3);
      S.saveSettings();
      S.SFX.ui();
      return;
    }
    if (el.id.indexOf('tg-') === 0) {
      this.cross[el.id.slice(3)] = !this.cross[el.id.slice(3)];
      S.saveSettings();
      S.SFX.ui();
      return;
    }
    if (this.trackRange(el.id)) {
      w.drag = el.id;
      this.uiDragSet(el.id, x);
    }
  };
  AimGame.prototype.trackRange = function (id) {
    var map = {
      size: { min: 6, max: 32, tk: WP.sizeTk },
      hover: { min: 0.5, max: 10, tk: WP.hoverTk },
      gap: { min: 0, max: 20, tk: WP.gapTk },
      len: { min: 1, max: 16, tk: WP.lenTk },
      thick: { min: 1, max: 6, tk: WP.thickTk }
    };
    return map[id] || null;
  };
  AimGame.prototype.uiDragSet = function (id, x) {
    var m = this.trackRange(id);
    if (!m) return;
    var frac = clamp((x - m.tk.x1) / (m.tk.x2 - m.tk.x1), 0, 1);
    var v = m.min + frac * (m.max - m.min);
    if (id === 'size') { this.setBallSize(Math.round(v)); return; }
    if (id === 'hover') { this.hoverSecs = Math.round(v * 2) / 2; this.sets.hoverSecs = this.hoverSecs; S.saveSettings(); return; }
    this.cross[id] = Math.round(v);
    S.saveSettings();
  };

  /* ---- 渲染墙面设置面板 ---- */
  AimGame.prototype.drawWallUI = function (cam, b, f, w, h) {
    var ctx = this.ctx;
    var wu = this.wallUI;
    var isOpen = wu.open;
    function P(x, y) {
      var c = toCam({ x: x, y: y, z: WP.z }, cam, b);
      if (c.z < NEAR) return null;
      var s = project(c, f, w, h);
      return { x: s.x, y: s.y, d: c.z };
    }
    function rect(x1, y1, x2, y2, fill, stroke, alpha) {
      var a = P(x1, y1), c = P(x2, y2);
      if (!a || !c) return null;
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.fillStyle = fill;
      ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
      }
      ctx.restore();
      return { a: a, c: c };
    }
    function text(t, x, y, px, color, align) {
      var p = P(x, y);
      if (!p) return;
      var fs = clamp(px * f / p.d, 7, 26);
      ctx.font = fs + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = align || 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t, p.x, p.y);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
    function trackEl(tk, frac, valText, label) {
      rect(tk.x1, tk.y1, tk.x2, tk.y2, 'rgba(0,0,0,0.45)', 'rgba(120,150,190,0.3)', 1);
      var fx2 = tk.x1 + frac * (tk.x2 - tk.x1);
      rect(tk.x1, tk.y1 + 2, fx2, tk.y2 - 2, '#e8b339', null, 0.9);
      var p = P(fx2, (tk.y1 + tk.y2) / 2);
      if (p) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2.5, (f * (tk.y2 - tk.y1) / p.d) * 0.45), 0, TAU);
        ctx.fill();
      }
      if (label) text(label, tk.x1 - 10, (tk.y1 + tk.y2) / 2, 8.5, '#9fb2cd', 'right');
      if (valText) text(valText, tk.x2 + 10, (tk.y1 + tk.y2) / 2, 8.5, '#ffd75e', 'left');
    }

    if (!isOpen) {
      /* 红色设置按钮: 锁定时射击它打开; 解锁时点击它打开 */
      var pulse = this.locked ? 1 : 0.72 + 0.28 * Math.sin(performance.now() / 320);
      rect(WP.red.x1, WP.red.y1, WP.red.x2, WP.red.y2, '#c73a31', 'rgba(255,255,255,0.4)', 0.95 * pulse);
      text('⚙ 设置', (WP.red.x1 + WP.red.x2) / 2, (WP.red.y1 + WP.red.y2) / 2 + 1, 10, '#fff');
      return;
    }

    /* 面板底 */
    rect(WP.x1, WP.y1, WP.x2, WP.y2, 'rgba(10,15,22,0.86)', 'rgba(232,179,57,0.4)', 1);
    text('⚙ 设置面板', 52, 57, 8.5, '#e8b339', 'left');

    /* 选项卡 + 关闭 */
    var tabOn = wu.tab === 'ball' ? 'rgba(232,179,57,0.28)' : 'rgba(28,38,52,0.85)';
    rect(WP.tabBall.x1, WP.tabBall.y1, WP.tabBall.x2, WP.tabBall.y2, tabOn, 'rgba(120,150,190,0.4)', 1);
    text('小球', (WP.tabBall.x1 + WP.tabBall.x2) / 2, 57, 8.5, wu.tab === 'ball' ? '#ffd75e' : '#9fb2cd');
    var tabOn2 = wu.tab === 'cross' ? 'rgba(232,179,57,0.28)' : 'rgba(28,38,52,0.85)';
    rect(WP.tabCross.x1, WP.tabCross.y1, WP.tabCross.x2, WP.tabCross.y2, tabOn2, 'rgba(120,150,190,0.4)', 1);
    text('准星', (WP.tabCross.x1 + WP.tabCross.x2) / 2, 57, 8.5, wu.tab === 'cross' ? '#ffd75e' : '#9fb2cd');
    rect(WP.close.x1, WP.close.y1, WP.close.x2, WP.close.y2, '#b23f38', 'rgba(255,255,255,0.35)', 0.95);
    text('✕', (WP.close.x1 + WP.close.x2) / 2, 55, 9, '#fff');

    var i, x, y2;
    if (wu.tab === 'ball') {
      /* 大小 */
      trackEl(WP.sizeTk, (this.ballR - 6) / 26, this.ballR + ' u', '大小');
      /* 颜色 */
      for (i = 0; i < BALL_COLORS.length; i++) {
        x = WP.ball.cx0 + i * WP.ball.gap;
        var active = BALL_COLORS[i].toLowerCase() === this.ballColor.toLowerCase();
        rect(x, WP.ball.colorY, x + WP.ball.sz, WP.ball.colorY + WP.ball.sz,
          BALL_COLORS[i], active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.25)', 1);
      }
      /* 出现方向 */
      for (i = 0; i < 5; i++) {
        var row = i < 3 ? 0 : 1;
        var cx = 52 + (i < 3 ? i * 60 : (i - 3) * 60);
        var wd = (i === 4) ? 72 : 52;
        var cy = row === 0 ? WP.ball.dirY1 : WP.ball.dirY2;
        var on = this.dirs[i];
        rect(cx, cy, cx + wd, cy + WP.ball.dirH,
          on ? 'rgba(86,194,113,0.8)' : 'rgba(28,38,52,0.85)', 'rgba(120,150,190,0.4)', 1);
        text(DIR_NAMES[i], cx + wd / 2, cy + WP.ball.dirH / 2, 8, on ? '#0c2e17' : '#9fb2cd');
      }
      /* 滞留 */
      trackEl(WP.hoverTk, (this.hoverSecs - 0.5) / 9.5, this.hoverSecs.toFixed(1) + ' s', '滞留');
    } else {
      /* 准星颜色 */
      for (i = 0; i < S.CROSS_COLORS.length; i++) {
        x = WP.cross.cx0 + i * WP.cross.gap;
        var act = S.CROSS_COLORS[i].c.toLowerCase() === this.cross.color.toLowerCase();
        rect(x, WP.cross.colorY, x + WP.cross.sz, WP.cross.colorY + WP.cross.sz,
          S.CROSS_COLORS[i].c, act ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.25)', 1);
      }
      /* 样式 */
      for (i = 0; i < STYLE_LIST.length; i++) {
        var sx = 52 + i * 60;
        var on = this.cross.style === STYLE_LIST[i][0];
        rect(sx, WP.cross.styleY, sx + WP.cross.styleW, WP.cross.styleY + WP.cross.styleH,
          on ? 'rgba(232,179,57,0.35)' : 'rgba(28,38,52,0.85)', 'rgba(120,150,190,0.4)', 1);
        text(STYLE_LIST[i][1], sx + WP.cross.styleW / 2, WP.cross.styleY + WP.cross.styleH / 2, 8,
          on ? '#ffd75e' : '#9fb2cd');
      }
      /* 滑杆 */
      trackEl(WP.gapTk, this.cross.gap / 20, '间隙 ' + this.cross.gap, '');
      trackEl(WP.lenTk, (this.cross.len - 1) / 15, '长度 ' + this.cross.len, '');
      trackEl(WP.thickTk, (this.cross.thick - 1) / 5, '粗细 ' + this.cross.thick, '');
      /* 开关 */
      for (i = 0; i < TOG_LIST.length; i++) {
        var tx = 52 + i * 70;
        var on2 = !!this.cross[TOG_LIST[i][0]];
        rect(tx, WP.cross.togY, tx + WP.cross.togW, WP.cross.togY + WP.cross.togH,
          on2 ? 'rgba(86,194,113,0.8)' : 'rgba(28,38,52,0.85)', 'rgba(120,150,190,0.4)', 1);
        text(TOG_LIST[i][1], tx + WP.cross.togW / 2, WP.cross.togY + WP.cross.togH / 2, 8,
          on2 ? '#0c2e17' : '#9fb2cd');
      }
    }

    /* 悬停高亮 */
    if (!this.locked && wu.hover && !wu.drag) {
      var elems = this.uiElems();
      for (var hi = 0; hi < elems.length; hi++) {
        if (elems[hi].id === wu.hover) {
          rect(elems[hi].x1 - 2, elems[hi].y1 - 2, elems[hi].x2 + 2, elems[hi].y2 + 2,
            'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.85)', 1);
          break;
        }
      }
    }
  };

  AimGame.prototype.applyControls = function () {
    this.sens = this.sets.sens;
    this.sensVal = this.sets.sens;
    this.fov = this.sets.fov;
    this.updateCm360();
    this.els.sensVal.textContent = this.sets.sens.toFixed(2);
    this.els.fovVal.textContent = this.sets.fov;
    var bestEl = this.els.best;
    bestEl.textContent = this.bestTime > 0 ? this.bestTime + ' 命中' : '–';
  };
  AimGame.prototype.updateCm360 = function () {
    var sens = this.sets.sens, dpi = this.sets.dpi;
    if (!dpi) return;
    var counts = 360 / (0.022 * sens);
    var inch = counts / dpi;
    this.els.cm360.textContent = '360°≈' + (inch * 2.54).toFixed(1) + 'cm @' + dpi + 'dpi';
  };

  AimGame.prototype.lockPointer = function () {
    if (!this.lockSupported) { this.updateOverlays(); return; }
    S.SFX.ensure();
    S.SFX.ui();
    try {
      var p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(function () {
          try { this.canvas.requestPointerLock(); } catch (err) {}
        }.bind(this));
      }
    } catch (err) {
      try { this.canvas.requestPointerLock(); } catch (err2) {}
    }
  };
  AimGame.prototype.keyUpAll = function () {
    this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
  };

  AimGame.prototype.updateOverlays = function () {
    var showLock = !this.locked && !this.endOpen && !this.wallUI.open;
    this.els.lockOverlay.hidden = !showLock;
    this.els.wallHint.hidden = !(!this.locked && !this.endOpen && this.wallUI.open);
  };
  AimGame.prototype.hideEnd = function () {
    this.els.end.hidden = true;
  };

  AimGame.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  /* ---------- 球 ---------- */
  AimGame.prototype.makeBall = function () {
    return { base: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, tan: { x: 1, y: 0, z: 0 },
      amp: 50, omega: 1, phase: 0, wave: false, r: this.ballR,
      state: 'alive', popT: 0, respawnDelay: 0, trail: [], hoverT: 0 };
  };

  AimGame.prototype.wallPoint = function () {
    /* dirs(设置): 前(+z) 后(-z) 左(-x) 右(+x) */
    var list = [];
    if (this.dirs[0]) list.push(WALLS[2]);
    if (this.dirs[1]) list.push(WALLS[3]);
    if (this.dirs[2]) list.push(WALLS[1]);
    if (this.dirs[3]) list.push(WALLS[0]);
    if (!list.length) list = [WALLS[0], WALLS[1], WALLS[2], WALLS[3]];
    var w = list[Math.floor(Math.random() * list.length)];
    var off = this.ballR + 1;
    if (w.type === 'x') {
      return { x: w.at > 0 ? w.at - off : w.at + off, y: rand(80, WALL_H - 24), z: rand(ZMIN + 60, ZMAX - 60) };
    }
    var xmin = -HALF_X + 60, xmax = HALF_X - 60;
    if (w.at > 0) xmax = 60; /* 后墙: 避让墙面设置面板区域 */
    return { x: rand(xmin, xmax), y: rand(80, WALL_H - 24), z: w.at > 0 ? w.at - off : w.at + off };
  };
  AimGame.prototype.floatPoint = function () {
    for (var i = 0; i < 20; i++) {
      var p = { x: rand(-250, 250), y: rand(70, 185), z: rand(-150, 300) };
      var cam = this.camVec();
      if (Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) >= 170) return p;
    }
    return { x: 0, y: 110, z: 180 };
  };

  AimGame.prototype.place = function (ball, opts) {
    opts = opts || {};
    var p = null;
    for (var i = 0; i < 24; i++) {
      var q = (this.dirs[4] && Math.random() < 0.38) ? this.floatPoint() : this.wallPoint();
      if (opts.spread) {
        var ok = true;
        for (var j = 0; j < this.balls.length; j++) {
          var o = this.balls[j];
          if (o === ball || o.state !== 'alive') continue;
          if (Math.hypot(o.pos.x - q.x, o.pos.y - q.y, o.pos.z - q.z) < 105) { ok = false; break; }
        }
        if (!ok) continue;
      }
      p = q; break;
    }
    if (!p) p = this.dirs[4] ? this.floatPoint() : this.wallPoint();
    ball.base = { x: p.x, y: p.y, z: p.z };
    ball.pos = { x: p.x, y: p.y, z: p.z };
    var ang = Math.random() * TAU;
    ball.tan = { x: Math.cos(ang), y: 0, z: Math.sin(ang) };
    ball.amp = rand(40, 90);
    ball.omega = rand(0.5, 1.1);
    ball.phase = rand(0, TAU);
    ball.wave = opts.wave !== false; // 默认可波浪移动(追踪/跟随模式用)
    ball.state = 'alive';
    ball.popT = 0;
    ball.trail = [];
    ball.hoverT = 0;
    ball.r = this.ballR;
  };

  AimGame.prototype.setWeapon = function (speed) {
    this.move.maxSpeed = speed;
  };

  AimGame.prototype.setMode = function (m, silent) {
    if (!MODES[m]) m = 'flick';
    this.mode = m;
    this.over = false;
    this.endOpen = false;
    this.els.end.hidden = true;
    this.animT = 0;
    this.fx = [];
    this.cooldown = 0;
    this.stats = { hits: 0, shots: 0, active: 0, reacts: [], lastMs: 0, escapes: 0 };
    this.react = { phase: 'wait', t: rand(0.5, 1.0), t0: 0 };
    this.resolveMode();

    for (var i = 0; i < this.els.modeBtns.length; i++) {
      var btn = this.els.modeBtns[i];
      btn.classList.toggle('active', btn.getAttribute('data-mode') === m);
    }
    if (!silent) { this.sets.mode = m; S.saveSettings(); S.SFX.ui(); }
    this.updateHud(true);
  };

  AimGame.prototype.resolveMode = function () { /* 依据当前 mode 组织球 */
    this.balls = [];
    var moving = (this.mode === 'track' || this.mode === 'follow');
    var n = moving ? 2 : (this.mode === 'react') ? 1 : 5;
    for (var i = 0; i < n; i++) {
      var b = this.makeBall();
      if (this.mode === 'react') {
        b.state = 'hidden';
        this.react.ball = b; /* 命中后复用同一对象 */
      } else {
        b.wave = moving;
        this.place(b, { spread: !moving, wave: moving });
      }
      this.balls.push(b);
    }
  };

  AimGame.prototype.respawnAll = function () {
    if (this.mode === 'react') {
      if (this.react.ball) { this.react.ball.state = 'hidden'; }
      this.react.phase = 'wait';
      this.react.t = rand(0.5, 1.0);
      return;
    }
    var moving = (this.mode === 'track' || this.mode === 'follow');
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      b.wave = moving;
      this.place(b, { spread: !moving, wave: moving });
    }
  };

  /* ---------- 输入/射击 ---------- */
  AimGame.prototype.camVec = function () {
    return { x: this.player.x, y: EYE + this.move.pos.y, z: this.player.z };
  };
  AimGame.prototype.focal = function () {
    return (this.h / 2) / Math.tan(this.fov * DEG / 2);
  };
  AimGame.prototype.aimDir = function (b) {
    if (this.locked) return b.fwd;
    var f = this.focal();
    var sx = (this.mouseX - this.w / 2) / f;
    var sy = (this.h / 2 - this.mouseY) / f;
    var d = {
      x: b.fwd.x + b.right.x * sx + b.up.x * sy,
      y: b.fwd.y + b.right.y * sx + b.up.y * sy,
      z: b.fwd.z + b.right.z * sx + b.up.z * sy
    };
    var l = Math.hypot(d.x, d.y, d.z) || 1;
    return { x: d.x / l, y: d.y / l, z: d.z / l };
  };

  AimGame.prototype._occluded = function (dir, tHit) {
    var cam = this.camVec();
    // 地面
    if (dir.y < -1e-6) {
      var tf = -cam.y / dir.y;
      if (tf > 0 && tf < tHit - 0.01) return true;
    }
    // 四面墙
    for (var i = 0; i < WALLS.length; i++) {
      var w = WALLS[i];
      var tw = null;
      if (w.type === 'x') {
        if ((w.at - cam.x) * dir.x <= 0) continue;
        tw = (w.at - cam.x) / dir.x;
        if (tw > 0 && tw < tHit - 0.01) {
          var y = cam.y + dir.y * tw, z = cam.z + dir.z * tw;
          if (y >= 0 && y <= WALL_H && z >= ZMIN && z <= ZMAX) return true;
        }
      } else {
        if ((w.at - cam.z) * dir.z <= 0) continue;
        tw = (w.at - cam.z) / dir.z;
        if (tw > 0 && tw < tHit - 0.01) {
          var y2 = cam.y + dir.y * tw, x2 = cam.x + dir.x * tw;
          if (y2 >= 0 && y2 <= WALL_H && x2 >= -HALF_X && x2 <= HALF_X) return true;
        }
      }
    }
    return false;
  };

  AimGame.prototype.raycast = function (dir) {
    var cam = this.camVec();
    var best = null, bestT = Infinity;
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (b.state !== 'alive') continue;
      var dx = b.pos.x - cam.x, dy = b.pos.y - cam.y, dz = b.pos.z - cam.z;
      var t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t < NEAR) continue;
      var d2 = (dx * dx + dy * dy + dz * dz) - t * t;
      var rr = b.r + 2;
      if (d2 < rr * rr && t < bestT) {
        bestT = t;
        best = { ball: b, t: t };
      }
    }
    if (!best) return null;
    if (this._occluded(dir, best.t)) return null;
    var cam2 = this.camVec();
    return { ball: best.ball, point: { x: cam2.x + dir.x * best.t, y: cam2.y + dir.y * best.t, z: cam2.z + dir.z * best.t } };
  };

  AimGame.prototype.shoot = function () {
    if (!this.locked || this.over || this.cooldown > 0) return;
    this.cooldown = 0.09;

    var b = basis(this.yaw, this.pitch);
    var dir = this.aimDir(b);
    var cam = this.camVec();

    /* 射中墙面「设置」按钮 → 展开设置面板(且退出锁定以便鼠标操作) */
    var hit = this.raycast(dir);
    if (!hit && !this.wallUI.open) {
      var wp = this.wallHitFromDir(dir, cam);
      if (wp) {
        var uiEl = this.uiHit(wp.x, wp.y);
        if (uiEl && uiEl.id === 'red') {
          this.openWallUI();
          S.SFX.shot();
          return; /* 不消耗射击统计 */
        }
      }
    }

    S.SFX.shot();
    this.stats.shots++;
    this.crosshairKick = 1;

    var muzzle = {
      x: cam.x + b.right.x * 9 - b.up.x * 10 + b.fwd.x * 26,
      y: cam.y + b.right.y * 9 - b.up.y * 10 + b.fwd.y * 26,
      z: cam.z + b.right.z * 9 - b.up.z * 10 + b.fwd.z * 26
    };

    var end = hit ? hit.point
      : { x: cam.x + dir.x * 1500, y: cam.y + dir.y * 1500, z: cam.z + dir.z * 1500 };
    this.fx.push({ type: 'tracer', a: muzzle, b: end, t: 0, life: 0.07 });
    this.fx.push({ type: 'flash', p: muzzle, t: 0, life: 0.05 });

    if (hit) {
      S.SFX.hit();
      this.stats.hits++;
      this.hitMark = 0.22;
      var hb = hit.ball;
      if (this.mode === 'react') {
        var ms = (this.animT - this.react.t0) * 1000;
        this.stats.reacts.push(ms);
        this.stats.lastMs = ms;
      }
      hb.state = 'pop';
      hb.popT = 0;
      hb.respawnDelay = this.mode === 'react' ? 0.2 : rand(0.25, 0.55);
      for (var i = 0; i < 10; i++) {
        var a = Math.random() * TAU, b2 = Math.random() * TAU;
        var sp = rand(60, 240);
        this.fx.push({
          type: 'shard', p: hit.point,
          v: { x: Math.cos(a) * Math.cos(b2) * sp, y: Math.sin(b2) * sp, z: Math.sin(a) * Math.cos(b2) * sp },
          t: 0, life: 0.35
        });
      }
    } else {
      S.SFX.miss();
      this.missFlash = 0.14;
    }
    this.updateHud(true);
  };

  /* ---------- 更新 ---------- */
  AimGame.prototype.frame = function (t) {
    var self = this;
    var dt = Math.min((t - this.last) / 1000, 0.05);
    this.last = t;
    if (!this.w || !this.h) this.resize();

    if (this.locked) {
      this.update(dt);
    }
    this.render();
    requestAnimationFrame(function (tt) { self.frame(tt); });
  };

  AimGame.prototype.update = function (dt) {
    this.animT += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.crosshairKick = Math.max(0, this.crosshairKick - dt * 7);
    this.hitMark = Math.max(0, this.hitMark - dt);
    this.missFlash = Math.max(0, this.missFlash - dt);

    // 移动
    if (this.sets.move) {
      var sig = {
        x: (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0),
        y: (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0)
      };
      var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      this.move.step(dt, {
        wx: cy * sig.x + sy * sig.y,
        wz: -sy * sig.x + cy * sig.y,
        jump: this.jumpEdge
      });
      this.player.x = this.move.pos.x;
      this.player.z = this.move.pos.z;
      this.player.x = clamp(this.player.x, -HALF_X + 22, HALF_X - 22);
      this.player.z = clamp(this.player.z, ZMIN + 22, ZMAX - 22);
      if (this.player.x !== this.move.pos.x) { this.move.pos.x = this.player.x; this.move.pos.z = this.player.z; }
    }
    this.jumpEdge = false;

    // 球更新
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (b.state === 'alive') {
        if (b.wave) {
          var s = Math.sin(this.animT * b.omega + b.phase) * b.amp;
          b.pos.x = b.base.x + b.tan.x * s;
          b.pos.y = b.base.y;
          b.pos.z = b.base.z + b.tan.z * s;
        }
        b.trail.push({ x: b.pos.x, y: b.pos.y, z: b.pos.z });
        if (b.trail.length > 9) b.trail.shift();
      } else if (b.state === 'pop') {
        b.popT += dt;
        if (b.popT >= 0.16 && b.popT >= b.respawnDelay) {
          if (this.mode === 'react') {
            b.state = 'hidden';
            this.react.phase = 'wait';
            this.react.t = rand(0.45, 1.05);
          } else {
            var mv = (this.mode === 'track' || this.mode === 'follow');
            b.wave = mv;
            this.place(b, { spread: !mv, wave: mv });
          }
        }
      }
    }

    /* 跟随模式: 准星停留在小球上的时间累积, 超过上限 → 消失逃脱 */
    if (this.mode === 'follow') {
      var dir = basis(this.yaw, this.pitch).fwd;
      var camH = this.camVec();
      for (var hi = 0; hi < this.balls.length; hi++) {
        var hb = this.balls[hi];
        if (hb.state !== 'alive') continue;
        var dx = hb.pos.x - camH.x, dy = hb.pos.y - camH.y, dz = hb.pos.z - camH.z;
        var tt = dx * dir.x + dy * dir.y + dz * dir.z;
        var hover = false;
        if (tt > NEAR) {
          var d2 = (dx * dx + dy * dy + dz * dz) - tt * tt;
          var rrf = hb.r + 3;
          if (d2 < rrf * rrf && !this._occluded(dir, tt)) hover = true;
        }
        if (hover) {
          hb.hoverT += dt;
          if (hb.hoverT >= this.hoverSecs) { /* 逃脱! */
            hb.state = 'pop';
            hb.popT = 0;
            hb.respawnDelay = 0.5;
            this.stats.escapes++;
            S.SFX.miss();
            this.missFlash = 0.14;
          }
        } else {
          hb.hoverT = Math.max(0, hb.hoverT - dt * 2.5); /* 移开准星快速衰减 */
        }
      }
    }

    // 反应模式时序
    if (this.mode === 'react' && this.react.phase === 'wait') {
      this.react.t -= dt;
      if (this.react.t <= 0 && this.react.ball) {
        this.place(this.react.ball, { spread: false, wave: false });
        this.react.ball.state = 'alive';
        this.react.phase = 'live';
        this.react.t0 = this.animT;
        S.SFX.pop();
      }
    }

    // 计时
    this.stats.active += dt;
    if (this.mode === 'time' && this.stats.active >= TIME_LIMIT) this.endTime();

    // 特效
    for (var j = this.fx.length - 1; j >= 0; j--) {
      var f = this.fx[j];
      f.t += dt;
      if (f.t >= f.life) this.fx.splice(j, 1);
    }

    this.updateHud(false);
  };

  AimGame.prototype.endTime = function () {
    this.over = true;
    var hits = this.stats.hits;
    var isRecord = hits > this.bestTime;
    if (isRecord) {
      this.bestTime = hits;
      try { localStorage.setItem('csx.aim.best.time', String(hits)); } catch (e) {}
    }
    var acc = this.stats.shots ? Math.round(hits / this.stats.shots * 100) : 0;
    var avgGap = hits ? Math.round(this.stats.active / hits * 1000) : 0;
    this.els.endStats.innerHTML =
      '<div><span class="lbl">命中</span><b>' + hits + '</b></div>' +
      '<div><span class="lbl">命中率</span><b>' + acc + '%</b></div>' +
      '<div><span class="lbl">平均间隔</span><b>' + avgGap + 'ms</b></div>' +
      '<div><span class="lbl">最佳纪录</span><b>' + this.bestTime + '</b>' + (isRecord ? '<span class="ok-txt">新纪录!</span>' : '') + '</div>';
    this.els.end.hidden = false;
    this.endOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.applyControls();
  };

  /* ---------- HUD ---------- */
  AimGame.prototype.updateHud = function (force) {
    var st = this.stats;
    this.els.hits.textContent = String(st.hits);
    this.els.shots.textContent = String(st.shots);
    this.els.acc.textContent = st.shots ? Math.round(st.hits / st.shots * 100) + ' %' : '–';
    var kpm = st.active > 4 ? Math.round(st.hits / (st.active / 60)) : 0;
    this.els.kpm.textContent = st.active > 4 ? String(kpm) : '–';
    if (this.mode === 'react') {
      var rs = st.reacts;
      var avg = rs.length ? Math.round(rs.reduce(function (a, b) { return a + b; }, 0) / rs.length) : 0;
      this.els.react.textContent = rs.length ? avg + ' ms' : '–';
      this.els.msg.textContent = this.react.phase === 'wait' ? '注意…球出现立刻射击（过早开枪算脱靶）' : '';
    } else if (this.mode === 'follow') {
      this.els.react.textContent = '–';
      this.els.msg.innerHTML = '跟随：逃脱 <b>' + st.escapes + '</b> 次 · 悬停上限 <b>' + this.hoverSecs.toFixed(1) + '</b> s';
    } else {
      this.els.react.textContent = st.lastMs ? Math.round(st.lastMs) + ' ms' : '–';
      this.els.msg.textContent = '';
    }
    if (this.mode === 'time') {
      this.els.timerChip.hidden = false;
      var rem = Math.max(0, Math.ceil(TIME_LIMIT - st.active));
      if (this.els.timer.textContent !== String(rem)) this.els.timer.textContent = String(rem);
    } else {
      this.els.timerChip.hidden = true;
    }
  };

  /* ---------- 渲染 ---------- */
  AimGame.prototype.render = function () {
    var ctx = this.ctx, w = this.w, h = this.h;
    if (!w || !h) return;

    var cam = this.camVec();
    var b = basis(this.yaw, this.pitch);
    var f = this.focal();

    // 天空
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0b111c');
    g.addColorStop(0.55, '#1f2c40');
    g.addColorStop(1, '#3a4e6b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 地平线 & 地面
    var hpC = toCam({ x: cam.x + b.fwd.x * 5000, y: 0, z: cam.z + b.fwd.z * 5000 }, cam, b);
    var hy = hpC.z > NEAR ? project(hpC, f, w, h).y : h;
    var gg = ctx.createLinearGradient(0, hy, 0, h);
    gg.addColorStop(0, '#28303d');
    gg.addColorStop(1, '#1a2029');
    ctx.fillStyle = gg;
    ctx.fillRect(0, Math.max(0, hy), w, h - Math.max(0, hy));

    // 地面网格
    ctx.strokeStyle = 'rgba(130,160,200,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = -512; gx <= 512; gx += 64) {
      var sg = clipSegZ(toCam({ x: gx, y: 0, z: ZMIN - 60 }, cam, b), toCam({ x: gx, y: 0, z: ZMAX + 60 }, cam, b), NEAR);
      if (sg) {
        var p1 = project(sg[0], f, w, h), p2 = project(sg[1], f, w, h);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      }
    }
    for (var gz = ZMIN - 64; gz <= ZMAX + 64; gz += 64) {
      var sg2 = clipSegZ(toCam({ x: -HALF_X - 60, y: 0, z: gz }, cam, b), toCam({ x: HALF_X + 60, y: 0, z: gz }, cam, b), NEAR);
      if (sg2) {
        var q1 = project(sg2[0], f, w, h), q2 = project(sg2[1], f, w, h);
        ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y);
      }
    }
    ctx.stroke();

    // 平台轮廓
    var corners = [[-HALF_X, ZMIN], [HALF_X, ZMIN], [HALF_X, ZMAX], [-HALF_X, ZMAX]];
    ctx.strokeStyle = 'rgba(232,179,57,0.30)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var ci = 0; ci < 4; ci++) {
      var a = corners[ci], c = corners[(ci + 1) % 4];
      var seg = clipSegZ(toCam({ x: a[0], y: 0, z: a[1] }, cam, b), toCam({ x: c[0], y: 0, z: c[1] }, cam, b), NEAR);
      if (!seg) continue;
      var s1 = project(seg[0], f, w, h), s2 = project(seg[1], f, w, h);
      ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
    }
    ctx.stroke();

    // 墙面
    var walls = [[WALL_QUADS.x0, WALLS[0]], [WALL_QUADS.x1, WALLS[1]], [WALL_QUADS.z0, WALLS[2]], [WALL_QUADS.z1, WALLS[3]]];
    for (var wi = 0; wi < walls.length; wi++) {
      var quad = walls[wi][0];
      var pts = quad.map(function (p) { return toCam(p, cam, b); });
      pts = clipPolyZ(pts, NEAR);
      if (pts.length < 3) continue;
      ctx.beginPath();
      for (var pi = 0; pi < pts.length; pi++) {
        var sp = project(pts[pi], f, w, h);
        if (pi === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      }
      ctx.closePath();
      ctx.fillStyle = '#25313f';
      ctx.fill();

      // 墙面网格点
      var wdef = walls[wi][1];
      ctx.fillStyle = 'rgba(140,175,215,0.14)';
      var us, ue;
      if (wdef.type === 'x') { us = ZMIN + 40; ue = ZMAX - 40; } else { us = -HALF_X + 40; ue = HALF_X - 40; }
      for (var u = us; u <= ue; u += 64) {
        for (var v = 40; v <= WALL_H - 24; v += 64) {
          var wp = wdef.type === 'x' ? { x: wdef.at, y: v, z: u } : { x: u, y: v, z: wdef.at };
          var cw = toCam(wp, cam, b);
          if (cw.z < NEAR) continue;
          var sw = project(cw, f, w, h);
          if (sw.x < -8 || sw.x > w + 8 || sw.y < -8 || sw.y > h + 8) continue;
          ctx.fillRect(sw.x - 1.5, sw.y - 1.5, 3, 3);
        }
      }

      // 墙顶边线
      var e1 = wdef.type === 'x' ? { x: wdef.at, y: WALL_H, z: ZMIN } : { x: -HALF_X, y: WALL_H, z: wdef.at };
      var e2 = wdef.type === 'x' ? { x: wdef.at, y: WALL_H, z: ZMAX } : { x: HALF_X, y: WALL_H, z: wdef.at };
      var es = clipSegZ(toCam(e1, cam, b), toCam(e2, cam, b), NEAR);
      if (es) {
        var sp1 = project(es[0], f, w, h), sp2 = project(es[1], f, w, h);
        ctx.strokeStyle = 'rgba(120,150,190,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sp1.x, sp1.y); ctx.lineTo(sp2.x, sp2.y); ctx.stroke();
      }
    }

    // 墙面设置面板(在球之前绘制, 远离视野的球会盖住它 — 符合透视)
    this.drawWallUI(cam, b, f, w, h);

    // 球（远→近）
    var drawable = [];
    for (var bi = 0; bi < this.balls.length; bi++) {
      var ball = this.balls[bi];
      if (ball.state === 'hidden') continue;
      var cb = toCam(ball.pos, cam, b);
      if (cb.z < NEAR * 0.8) continue;
      drawable.push({ ball: ball, c: cb });
    }
    drawable.sort(function (p, q) { return q.c.z - p.c.z; });

    for (var di = 0; di < drawable.length; di++) {
      var db = drawable[di].ball, c = drawable[di].c;
      // 轨迹
      if (db.wave) {
        for (var ti = 1; ti < db.trail.length; ti++) {
          var tc = toCam(db.trail[ti], cam, b);
          if (tc.z < NEAR) continue;
          var tsp = project(tc, f, w, h);
          ctx.beginPath();
          ctx.arc(tsp.x, tsp.y, Math.max(1, f * 4 / tc.z * (ti / db.trail.length)), 0, TAU);
          ctx.fillStyle = 'rgba(' + this.ballRgb.join(',') + ',' + (0.14 * ti / db.trail.length).toFixed(3) + ')';
          ctx.fill();
        }
      }
      var pop = db.state === 'pop';
      var scale = pop ? (1 + db.popT / 0.16 * 0.9) : 1;
      var alpha = pop ? Math.max(0, 1 - db.popT / 0.22) : 1;
      var scr = project(c, f, w, h);
      var rr = Math.max(1.5, f * db.r * scale / c.z);
      var bg = ctx.createRadialGradient(scr.x - rr * 0.3, scr.y - rr * 0.35, rr * 0.15, scr.x, scr.y, rr);
      bg.addColorStop(0, this.ballCss.light);
      bg.addColorStop(0.55, this.ballCss.base);
      bg.addColorStop(1, this.ballCss.dark);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, rr, 0, TAU);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 跟随模式: 悬停滞留进度条(球上方)
      if (this.mode === 'follow' && db.state === 'alive' && db.hoverT > 0.02) {
        var frac = clamp(db.hoverT / this.hoverSecs, 0, 1);
        var bw = rr * 2.4, bh = 4;
        var bx = scr.x - bw / 2, by = scr.y - rr - 14;
        ctx.fillStyle = 'rgba(8,12,18,0.78)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = frac < 0.6 ? '#ffd75e' : '#e2594e';
        ctx.fillRect(bx, by, bw * frac, bh);
      }
    }

    // 特效
    for (var fi = 0; fi < this.fx.length; fi++) {
      var fx = this.fx[fi];
      var k = 1 - fx.t / fx.life;
      if (fx.type === 'tracer') {
        var ca = toCam(fx.a, cam, b), cb2 = toCam(fx.b, cam, b);
        var seg = clipSegZ(ca, cb2, NEAR);
        if (seg) {
          var ta = project(seg[0], f, w, h), tb = project(seg[1], f, w, h);
          ctx.strokeStyle = 'rgba(255,223,158,' + (k * 0.55).toFixed(3) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(ta.x, ta.y); ctx.lineTo(tb.x, tb.y); ctx.stroke();
        }
      } else if (fx.type === 'flash') {
        var fc = toCam(fx.p, cam, b);
        if (fc.z > NEAR) {
          var fsp = project(fc, f, w, h);
          ctx.beginPath();
          ctx.arc(fsp.x, fsp.y, 5 + k * 4, 0, TAU);
          ctx.fillStyle = 'rgba(255,220,140,' + (k * 0.7).toFixed(3) + ')';
          ctx.fill();
        }
      } else if (fx.type === 'shard') {
        var sxp = fx.p.x + fx.v.x * fx.t, syp = fx.p.y + fx.v.y * fx.t, szp = fx.p.z + fx.v.z * fx.t;
        var sc = toCam({ x: sxp, y: syp, z: szp }, cam, b);
        if (sc.z > NEAR) {
          var ssp = project(sc, f, w, h);
          ctx.fillStyle = 'rgba(255,230,170,' + (k * 0.8).toFixed(3) + ')';
          ctx.fillRect(ssp.x - 1.5, ssp.y - 1.5, 3, 3);
        }
      }
    }

    // 准星 (CS 式自定义; 解锁状态显示跟随鼠标的预览)
    if (this.locked) {
      var ccfg = this.cross;
      if (this.missFlash > 0) {
        ccfg = { color: '#e2594e', style: this.cross.style, gap: this.cross.gap,
          len: this.cross.len, thick: this.cross.thick, dot: this.cross.dot,
          outline: this.cross.outline, dynamic: this.cross.dynamic };
      }
      var spdC = Math.hypot(this.move.vel.x, this.move.vel.z);
      S.drawCrosshair(ctx, w / 2, h / 2, ccfg, this.crosshairKick, spdC / 250);
      if (this.hitMark > 0) {
        var hm = 3, hl = 6;
        var a = this.hitMark / 0.22;
        ctx.strokeStyle = 'rgba(255,215,94,' + a.toFixed(2) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        var pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        for (var hi = 0; hi < pts.length; hi++) {
          ctx.moveTo(w / 2 + pts[hi][0] * hm, h / 2 + pts[hi][1] * hm);
          ctx.lineTo(w / 2 + pts[hi][0] * (hm + hl), h / 2 + pts[hi][1] * (hm + hl));
        }
        ctx.stroke();
      }
    } else if (this.mouseX >= 0 && this.mouseY >= 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      S.drawCrosshair(ctx, this.mouseX, this.mouseY, this.cross, 0, 0);
      ctx.restore();
    }

    // 反应模式: 目标在屏幕外时指方向
    if (this.mode === 'react' && this.react.phase === 'live' && this.react.ball &&
        this.react.ball.state === 'alive') {
      var rc = toCam(this.react.ball.pos, cam, b);
      var rscr = rc.z > NEAR ? project(rc, f, w, h) : null;
      var off = !rscr || rscr.x < 30 || rscr.x > w - 30 || rscr.y < 30 || rscr.y > h - 30;
      if (off) {
        var dirAng = rscr ? Math.atan2(rscr.y - h / 2, rscr.x - w / 2)
          : Math.atan2(-rc.y, rc.x); /* 相机系 y 向上, 屏幕 y 向下 */
        var ar = Math.min(w, h) * 0.32;
        var ax = w / 2 + Math.cos(dirAng) * ar, ay = h / 2 + Math.sin(dirAng) * ar;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(dirAng);
        ctx.fillStyle = 'rgba(232,179,57,0.85)';
        ctx.beginPath();
        ctx.moveTo(14, 0); ctx.lineTo(-8, 9); ctx.lineTo(-8, -9);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  };

  var MODES = { flick: 1, track: 1, react: 1, time: 1, follow: 1 };

  S.Aim = {
    init: function () { return new AimGame(); }
  };
})();
