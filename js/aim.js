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

    this.stats = { hits: 0, shots: 0, active: 0, reacts: [], lastMs: 0 };
    this.bestTime = 0;
    try { this.bestTime = +localStorage.getItem('csx.aim.best.time') || 0; } catch (e) {}

    this.locked = false;
    this.lockSupported = 'requestPointerLock' in this.canvas;
    this.mouseX = 0; this.mouseY = 0;
    this.w = 0; this.h = 0; this.dpr = 1;

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
      }
    });
    canvas.addEventListener('mousedown', function (e) {
      canvas.blur();
      if (e.button !== 0 && e.button !== 2) return;
      if (!self.locked) { self.lockPointer(); return; }
      e.preventDefault();
      self.shoot();
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    document.addEventListener('pointerlockchange', function () {
      self.locked = document.pointerLockElement === canvas;
      if (!self.locked) self.keyUpAll();
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
    var showLock = !this.locked && !this.endOpen;
    this.els.lockOverlay.hidden = !showLock;
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
      amp: 50, omega: 1, phase: 0, wave: false, r: BALL_R,
      state: 'alive', popT: 0, respawnDelay: 0, trail: [] };
  };

  AimGame.prototype.wallPoint = function () {
    var r = Math.random();
    var w = r < 0.45 ? WALLS[2] : r < 0.65 ? WALLS[3] : (Math.random() < 0.5 ? WALLS[0] : WALLS[1]);
    var off = BALL_R + 1;
    if (w.type === 'x') {
      return { x: w.at > 0 ? w.at - off : w.at + off, y: rand(80, WALL_H - 24), z: rand(ZMIN + 60, ZMAX - 60) };
    }
    return { x: rand(-HALF_X + 60, HALF_X - 60), y: rand(80, WALL_H - 24), z: w.at > 0 ? w.at - off : w.at + off };
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
      var q = Math.random() < 0.62 ? this.wallPoint() : this.floatPoint();
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
    if (!p) p = this.floatPoint();
    ball.base = { x: p.x, y: p.y, z: p.z };
    ball.pos = { x: p.x, y: p.y, z: p.z };
    var ang = Math.random() * TAU;
    ball.tan = { x: Math.cos(ang), y: 0, z: Math.sin(ang) };
    ball.amp = rand(40, 90);
    ball.omega = rand(0.5, 1.1);
    ball.phase = rand(0, TAU);
    ball.wave = opts.wave !== false; // 默认可波浪移动(追踪模式用)
    ball.state = 'alive';
    ball.popT = 0;
    ball.trail = [];
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
    this.stats = { hits: 0, shots: 0, active: 0, reacts: [], lastMs: 0 };
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
    var n = (this.mode === 'track') ? 2 : (this.mode === 'react') ? 1 : 5;
    for (var i = 0; i < n; i++) {
      var b = this.makeBall();
      if (this.mode === 'react') {
        b.state = 'hidden';
        this.react.ball = b; /* 命中后复用同一对象 */
      } else {
        b.wave = (this.mode === 'track');
        this.place(b, { spread: this.mode !== 'track', wave: b.wave });
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
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      b.wave = (this.mode === 'track');
      this.place(b, { spread: this.mode !== 'track', wave: b.wave });
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
    S.SFX.shot();
    this.stats.shots++;
    this.crosshairKick = 1;

    var b = basis(this.yaw, this.pitch);
    var dir = this.aimDir(b);
    var cam = this.camVec();
    var camB = basis(this.yaw, this.pitch);
    var muzzle = {
      x: cam.x + camB.right.x * 9 - camB.up.x * 10 + camB.fwd.x * 26,
      y: cam.y + camB.right.y * 9 - camB.up.y * 10 + camB.fwd.y * 26,
      z: cam.z + camB.right.z * 9 - camB.up.z * 10 + camB.fwd.z * 26
    };

    var hit = this.raycast(dir);
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
            b.wave = (this.mode === 'track');
            this.place(b, { spread: this.mode !== 'track', wave: b.wave });
          }
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
          ctx.fillStyle = 'rgba(232,179,57,' + (0.12 * ti / db.trail.length).toFixed(3) + ')';
          ctx.fill();
        }
      }
      var pop = db.state === 'pop';
      var scale = pop ? (1 + db.popT / 0.16 * 0.9) : 1;
      var alpha = pop ? Math.max(0, 1 - db.popT / 0.22) : 1;
      var scr = project(c, f, w, h);
      var rr = Math.max(1.5, f * db.r * scale / c.z);
      var bg = ctx.createRadialGradient(scr.x - rr * 0.3, scr.y - rr * 0.35, rr * 0.15, scr.x, scr.y, rr);
      bg.addColorStop(0, '#fff3cf');
      bg.addColorStop(0.55, '#e8b339');
      bg.addColorStop(1, '#7e5a12');
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, rr, 0, TAU);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
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

    // 准星
    if (this.locked) {
      var gap = 5 + this.crosshairKick * 9;
      var len = 7, lw = 2;
      var col = this.missFlash > 0 ? 'rgba(226,89,78,0.95)' : 'rgba(127,216,255,0.9)';
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(w / 2 - gap - len, h / 2); ctx.lineTo(w / 2 - gap, h / 2);
      ctx.moveTo(w / 2 + gap, h / 2); ctx.lineTo(w / 2 + gap + len, h / 2);
      ctx.moveTo(w / 2, h / 2 - gap - len); ctx.lineTo(w / 2, h / 2 - gap);
      ctx.moveTo(w / 2, h / 2 + gap); ctx.lineTo(w / 2, h / 2 + gap + len);
      ctx.stroke();
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

  var MODES = { flick: 1, track: 1, react: 1, time: 1 };

  S.Aim = {
    init: function () { return new AimGame(); }
  };
})();
