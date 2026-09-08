/* 左手 · 急停训练 (3D 第一人称 + 2D 编辑)
 *
 * 常规训练: 第一人称 3D 视角(指针锁定, CS2 灵敏度), WASD 移动/空格跳跃,
 *   冲入目标圆环急停; 评级与统计规则与 2D 版一致:
 *   计时从"按下刹车那一刻"开始, 效率比 = 实际 ÷ 理论最优(按起停速度)。
 * 编辑障碍物: 选择「拉线墙/矩形块/拆除」时自动切换 2D 俯视视图(释放鼠标锁定),
 *   拖动绘制或点击拆除, 点「3D 训练」返回第一人称。
 * 障碍物三档高度(颜色分级): 14u 可跨上(绿) / 40u 可跳上(蓝) / 96u 不可跳上(红)。
 */
(function () {
  'use strict';
  var S = window.CSX;
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  var BOUND = 1150;          // 场地边界 (u)
  var GRID = 128;
  var PLAYER_R = 16;         // 小球半径 (u, ≈ CS 玩家半宽)
  var EYE = 64;              // 视点高度
  var NEAR = 0.5;
  var BEAM_H = 80;           // 目标圆环光柱高度
  var STOP = S.STOP_THRESHOLD;
  var START_SPEED = 120;
  var STEP_UP = S.Movement.STEP_UP;

  var OB_LEVELS = [
    { h: 14, name: '可跨上',   color: '#56c271', dark: '#3a7c4d', txt: '14u' },
    { h: 40, name: '可跳上',   color: '#4f9df0', dark: '#34689f', txt: '40u' },
    { h: 96, name: '不可跳上', color: '#e2594e', dark: '#94352d', txt: '96u' }
  ];

  function $(id) { return document.getElementById(id); }
  function dist2D(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---- 3D 投影工具 (与右手训练同一套) ---- */
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
  function clipSegZ(a, b, near) {
    var aIn = a.z >= near, bIn = b.z >= near;
    if (!aIn && !bIn) return null;
    if (aIn && bIn) return [a, b];
    var t = (near - a.z) / (b.z - a.z);
    var m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near };
    return aIn ? [a, m] : [m, b];
  }
  function clipPolyZ(pts, near) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], bb = pts[(i + 1) % pts.length];
      var aIn = a.z >= near, bIn = bb.z >= near;
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        var t = (near - a.z) / (bb.z - a.z);
        out.push({ x: a.x + (bb.x - a.x) * t, y: a.y + (bb.y - a.y) * t, z: near });
      }
    }
    return out;
  }

  function LeftGame() {
    var self = this;
    this.canvas = $('leftCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.els = {
      speedVal: $('L-speedVal'), speedMps: $('L-speedMps'),
      timerWrap: $('L-timerWrap'), timer: $('L-timer'),
      feedback: $('L-feedback'),
      n: $('L-n'), avg: $('L-avg'), best: $('L-best'), csfRate: $('L-csfRate'),
      results: $('L-results'),
      theoryBrake: $('L-theoryBrake'), theoryStrafe: $('L-theoryStrafe'),
      modeTrain: $('L-modeTrain'), modeFree: $('L-modeFree'),
      dist: $('L-dist'), vector: $('L-vector'), auto: $('L-auto'),
      resetStats: $('L-resetStats'),
      hint: $('L-hint'),
      ring: $('L-ring'), ringVal: $('L-ringVal'),
      toolSeg: $('L-toolSeg'), hSeg: $('L-hSeg'),
      obList: $('L-obList'), obUndo: $('L-obUndo'), obClear: $('L-obClear'),
      lockOverlay: $('leftLockOverlay'), lockBtn: $('leftLockBtn'),
      sens: $('L-sens'), sensVal: $('L-sensVal')
    };
    this.sets = S.settings.left;

    this.move = new S.Movement(S.CS2);
    this.move.reset(0, 0);
    this.weaponSpeed = 250;

    this.keys = { w: false, a: false, s: false, d: false };
    this.jumpEdge = false;

    // 3D 相机
    this.viewMode = '3d';           // '3d' 训练 | '2d' 编辑
    this.locked = false;
    this.yaw = 0; this.pitch = 0;
    this.sens = +S.settings.aim.sens || 2.0;
    this.fov = +S.settings.aim.fov || 90;

    this.mode = (this.sets.mode === 'free') ? 'free' : 'train';
    this.phase = 'idle';            // idle | running | done
    this.ringR = +this.sets.ring || 56;
    this.target = { x: 0, z: 0 };
    this.entryT0 = 0;
    this.entrySpeed = 0;
    this.brakeStart = null;
    this.brakeSpeed = 0;
    this.csFlag = false;
    this.totals = { n: 0, sum: 0, best: Infinity, csf: 0 };
    this.records = [];
    this.trail = [];
    this.autoNextIn = null;
    this.feedbackTimer = null;
    this.slowHintAt = -9;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.view2d = { px: 0, pz: 0, ppu: 1, w: 0, h: 0 };

    // ---- 障碍物 ----
    this.tool = 'play';             // play | wall | rect | del
    this.hLevel = 0;
    this.drag = null;
    this.hoverOb = -1;
    this.obstacles = [];
    var saved = this.sets.obstacles;
    if (saved && saved.length) {
      for (var si = 0; si < saved.length; si++) {
        this.obstacles.push({
          x1: +saved[si].x1, x2: +saved[si].x2, z1: +saved[si].z1, z2: +saved[si].z2,
          h: +saved[si].h, lv: +saved[si].lv || 0
        });
      }
    }

    // 地形钩子
    this.world = {
      resolve: function (pos, vel, y, axis) {
        for (var i = 0; i < self.obstacles.length; i++) {
          var ob = self.obstacles[i];
          if (ob.h <= y + STEP_UP) continue;
          if (pos.x > ob.x1 - PLAYER_R && pos.x < ob.x2 + PLAYER_R &&
              pos.z > ob.z1 - PLAYER_R && pos.z < ob.z2 + PLAYER_R) {
            if (axis === 'x') {
              if (vel.x > 0) pos.x = ob.x1 - PLAYER_R;
              else if (vel.x < 0) pos.x = ob.x2 + PLAYER_R;
              vel.x = 0;
            } else {
              if (vel.z > 0) pos.z = ob.z1 - PLAYER_R;
              else if (vel.z < 0) pos.z = ob.z2 + PLAYER_R;
              vel.z = 0;
            }
            break;
          }
        }
      },
      groundY: function (x, z) {
        var g = 0;
        for (var i = 0; i < self.obstacles.length; i++) {
          var ob = self.obstacles[i];
          var m = PLAYER_R * 0.6;
          if (x > ob.x1 - m && x < ob.x2 + m && z > ob.z1 - m && z < ob.z2 + m) {
            if (ob.h > g) g = ob.h;
          }
        }
        return g;
      }
    };

    this.bindEvents();
    this.resize();
    this.setMode(this.mode, true);
    this.updateWeaponTheory();
    this.renderObList();
    this.updateLockUI();

    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame(function (t) { self.frame(t); });
  }

  LeftGame.prototype.moveCfg = function () {
    return {
      maxSpeed: this.weaponSpeed, accel: S.CS2.accel, friction: S.CS2.friction,
      stopSpeed: S.CS2.stopSpeed, airAccel: S.CS2.airAccel,
      gravity: S.CS2.gravity, jumpVel: S.CS2.jumpVel
    };
  };

  LeftGame.prototype.bindEvents = function () {
    var self = this;
    var canvas = this.canvas;

    window.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.repeat) return;
      if (e.code === 'KeyW') self.keys.w = true;
      if (e.code === 'KeyA') self.keys.a = true;
      if (e.code === 'KeyS') self.keys.s = true;
      if (e.code === 'KeyD') self.keys.d = true;
      if (e.code === 'Space') self.jumpEdge = true;
      if (e.code === 'Escape') self.drag = null;
      if (e.code === 'KeyF' && self.mode === 'train' && !self.sets.auto) self.spawnTarget();
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'KeyW') self.keys.w = false;
      if (e.code === 'KeyA') self.keys.a = false;
      if (e.code === 'KeyS') self.keys.s = false;
      if (e.code === 'KeyD') self.keys.d = false;
    });
    window.addEventListener('blur', function () {
      self.keys.w = self.keys.a = self.keys.s = self.keys.d = false;
      self.drag = null;
    });

    window.addEventListener('resize', function () { self.resize(); });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { self.resize(); }).observe(canvas.parentElement);
    }

    /* ---- 鼠标: 3D 视角 / 2D 编辑 ---- */
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (self.viewMode === '3d') {
        if (!self.locked) self.lockPointer();
        return;
      }
      // 2D 编辑
      var p = self.screenToWorld(e.clientX, e.clientY);
      if (self.tool === 'del') {
        var idx = self.obstacleAt(p.x, p.z);
        if (idx >= 0) self.removeObstacle(idx);
        return;
      }
      self.drag = { x0: p.x, z0: p.z, x1: p.x, z1: p.z };
    });
    canvas.addEventListener('mousemove', function (e) {
      if (self.viewMode === '3d') {
        if (self.locked) {
          var cg = 0.022 * self.sens * DEG;
          self.yaw += e.movementX * cg;
          self.pitch -= e.movementY * cg;
          self.pitch = clamp(self.pitch, -87 * DEG, 87 * DEG);
        }
        return;
      }
      // 2D 编辑: 拆除悬停高亮
      var p = self.screenToWorld(e.clientX, e.clientY);
      if (self.tool === 'del') {
        var idx = self.obstacleAt(p.x, p.z);
        self.hoverOb = idx;
        canvas.className = idx >= 0 ? 'tool-del' : '';
      }
    });
    window.addEventListener('mousemove', function (e) {
      if (self.drag) {
        var p = self.screenToWorld(e.clientX, e.clientY);
        self.drag.x1 = p.x; self.drag.z1 = p.z;
      }
    });
    window.addEventListener('mouseup', function () {
      if (self.drag) self.commitDrag();
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    document.addEventListener('pointerlockchange', function () {
      self.locked = document.pointerLockElement === canvas;
      if (!self.locked) self.keys.w = self.keys.a = self.keys.s = self.keys.d = false;
      self.updateLockUI();
    });
    document.addEventListener('pointerlockerror', function () {
      self.locked = false;
      self.updateLockUI();
    });
    this.els.lockBtn.addEventListener('click', function () { self.lockPointer(); });

    /* ---- 侧栏控件 ---- */
    this.els.dist.value = String(this.sets.dist);
    this.els.vector.checked = !!this.sets.vector;
    this.els.auto.checked = !!this.sets.auto;
    this.els.ring.value = String(this.ringR);
    this.els.ringVal.textContent = String(this.ringR);
    this.els.sens.value = String(this.sens);
    this.els.sensVal.textContent = this.sens.toFixed(2);

    this.els.dist.addEventListener('change', function () {
      self.sets.dist = +self.els.dist.value;
      S.saveSettings();
      if (self.mode === 'train') self.spawnTarget();
    });
    this.els.vector.addEventListener('change', function () {
      self.sets.vector = self.els.vector.checked;
      S.saveSettings();
    });
    this.els.auto.addEventListener('change', function () {
      self.sets.auto = self.els.auto.checked;
      S.saveSettings();
    });
    this.els.ring.addEventListener('input', function () {
      self.ringR = +self.els.ring.value;
      self.els.ringVal.textContent = String(self.ringR);
      self.sets.ring = self.ringR;
      S.saveSettings();
      if (self.mode === 'train' && self.phase !== 'running') self.spawnTarget();
      S.SFX.ui();
    });
    this.els.sens.addEventListener('input', function () {
      self.sens = +self.els.sens.value;
      self.els.sensVal.textContent = self.sens.toFixed(2);
      S.settings.aim.sens = self.sens;      // 与右手训练共享灵敏度
      S.saveSettings();
      window.dispatchEvent(new Event('csx-sens-changed'));
    });
    window.addEventListener('csx-sens-changed', function () {
      self.sens = +S.settings.aim.sens || 2.0;
      self.fov = +S.settings.aim.fov || 90;
      self.els.sens.value = String(self.sens);
      self.els.sensVal.textContent = self.sens.toFixed(2);
    });
    this.els.modeTrain.addEventListener('click', function () { self.els.modeTrain.blur(); self.setMode('train'); });
    this.els.modeFree.addEventListener('click', function () { self.els.modeFree.blur(); self.setMode('free'); });
    this.els.resetStats.addEventListener('click', function () {
      self.els.resetStats.blur();
      self.totals = { n: 0, sum: 0, best: Infinity, csf: 0 };
      self.records = [];
      self.renderStats();
      self.renderRecords();
    });

    var toolBtns = this.els.toolSeg.querySelectorAll('button');
    for (var i = 0; i < toolBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          btn.blur();
          self.setTool(btn.getAttribute('data-tool'));
        });
      })(toolBtns[i]);
    }
    var hBtns = this.els.hSeg.querySelectorAll('button');
    for (var j = 0; j < hBtns.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          btn.blur();
          self.hLevel = +btn.getAttribute('data-h');
          for (var k = 0; k < hBtns.length; k++) hBtns[k].classList.toggle('active', k === self.hLevel);
          S.SFX.ui();
        });
      })(hBtns[j]);
    }
    this.els.obUndo.addEventListener('click', function () {
      self.els.obUndo.blur();
      if (self.obstacles.length) { self.obstacles.pop(); self.persistObstacles(); }
    });
    this.els.obClear.addEventListener('click', function () {
      self.els.obClear.blur();
      if (self.obstacles.length) { self.obstacles = []; self.persistObstacles(); }
    });
  };

  /* ---- 视图/锁定 ---- */
  LeftGame.prototype.lockPointer = function () {
    S.SFX.ensure();
    try {
      var p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(function () {
          try { this.canvas.requestPointerLock(); } catch (e) {}
        }.bind(this));
      }
    } catch (e) {
      try { this.canvas.requestPointerLock(); } catch (e2) {}
    }
  };
  LeftGame.prototype.updateLockUI = function () {
    var show = (this.viewMode === '3d') && !this.locked;
    this.els.lockOverlay.hidden = !show;
  };
  LeftGame.prototype.onTabEnter = function () {
    this.resize();
    this.updateLockUI();
  };

  LeftGame.prototype.setTool = function (t) {
    this.tool = t;
    this.drag = null;
    this.hoverOb = -1;
    var btns = this.els.toolSeg.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-tool') === t);
    }
    if (t === 'play') {
      this.viewMode = '3d';
      this.els.hint.innerHTML = '第一人称训练：看向目标圆环冲过去，进圈后<b>立刻反向按键急停</b>；鼠标视角灵敏度与右手训练共享';
      this.canvas.className = '';
      this.updateLockUI();
      this.lockPointer(); // 按钮点击属于用户手势, 可直接锁定
    } else {
      this.viewMode = '2d';
      if (document.pointerLockElement) document.exitPointerLock();
      this.els.hint.innerHTML = t === 'del'
        ? '编辑模式 (2D 俯视)：<b>点击</b>障碍物拆除'
        : '编辑模式 (2D 俯视)：<b>拖动鼠标</b>绘制障碍物（' + (t === 'wall' ? '拉线墙' : '矩形块') + '）· 画完点「3D 训练」返回';
      this.canvas.className = (t === 'del') ? 'tool-del' : '';
      this.updateLockUI();
    }
    S.SFX.ui();
  };

  LeftGame.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  LeftGame.prototype.screenToWorld = function (cx, cy) {
    var r = this.canvas.getBoundingClientRect();
    var mx = cx - r.left, my = cy - r.top;
    var v = this.view2d;
    return { x: v.px + (mx - v.w / 2) / v.ppu, z: v.pz - (my - v.h / 2) / v.ppu };
  };
  LeftGame.prototype.obstacleAt = function (x, z) {
    for (var i = this.obstacles.length - 1; i >= 0; i--) {
      var ob = this.obstacles[i];
      if (x >= ob.x1 - 2 && x <= ob.x2 + 2 && z >= ob.z1 - 2 && z <= ob.z2 + 2) return i;
    }
    return -1;
  };
  LeftGame.prototype.persistObstacles = function () {
    var arr = [];
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      arr.push({ x1: o.x1, x2: o.x2, z1: o.z1, z2: o.z2, h: o.h, lv: o.lv });
    }
    this.sets.obstacles = arr;
    S.saveSettings();
    this.renderObList();
  };
  LeftGame.prototype.removeObstacle = function (idx) {
    this.obstacles.splice(idx, 1);
    this.persistObstacles();
    S.SFX.ui();
  };
  LeftGame.prototype.commitDrag = function () {
    var d = this.drag;
    this.drag = null;
    var dx = d.x1 - d.x0, dz = d.z1 - d.z0;
    if (Math.hypot(dx, dz) < 24) return;
    var lv = OB_LEVELS[this.hLevel];
    var ob;
    if (this.tool === 'wall') {
      var T = 12;
      if (Math.abs(dx) >= Math.abs(dz)) {
        ob = { x1: Math.min(d.x0, d.x1) - T, x2: Math.max(d.x0, d.x1) + T, z1: d.z0 - T, z2: d.z0 + T, h: lv.h, lv: this.hLevel };
      } else {
        ob = { x1: d.x0 - T, x2: d.x0 + T, z1: Math.min(d.z0, d.z1) - T, z2: Math.max(d.z0, d.z1) + T, h: lv.h, lv: this.hLevel };
      }
    } else {
      var x1 = Math.min(d.x0, d.x1), x2 = Math.max(d.x0, d.x1);
      var z1 = Math.min(d.z0, d.z1), z2 = Math.max(d.z0, d.z1);
      if (x2 - x1 < 40) { var cxm = (x1 + x2) / 2; x1 = cxm - 20; x2 = cxm + 20; }
      if (z2 - z1 < 40) { var czm = (z1 + z2) / 2; z1 = czm - 20; z2 = czm + 20; }
      ob = { x1: x1, x2: x2, z1: z1, z2: z2, h: lv.h, lv: this.hLevel };
    }
    this.obstacles.push(ob);
    this.persistObstacles();
    S.SFX.ui();
  };
  LeftGame.prototype.renderObList = function () {
    var el = this.els.obList;
    el.innerHTML = '';
    if (!this.obstacles.length) {
      el.innerHTML = '<span class="obs-empty">还没有障碍物 — 选工具后在场地里拖动鼠标绘制</span>';
      return;
    }
    for (var i = 0; i < this.obstacles.length; i++) {
      var ob = this.obstacles[i];
      var lv = OB_LEVELS[ob.lv] || OB_LEVELS[0];
      var div = document.createElement('div');
      div.className = 'ob';
      div.innerHTML = '<i class="h-dot d' + (ob.lv || 0) + '"></i>'
        + ((ob.x2 - ob.x1) >= (ob.z2 - ob.z1) ? '横墙' : '竖墙')
        + ' ' + lv.name + ' <i>#' + (i + 1) + '</i>'
        + '<button class="ob-del" title="删除">✕</button>';
      (function (self, idx) {
        div.querySelector('.ob-del').addEventListener('click', function () {
          self.removeObstacle(idx);
        });
      })(this, i);
      el.appendChild(div);
    }
  };

  LeftGame.prototype.setMode = function (m, silent) {
    this.mode = m;
    this.els.modeTrain.classList.toggle('active', m === 'train');
    this.els.modeFree.classList.toggle('active', m === 'free');
    this.els.hint.innerHTML = (m === 'train')
      ? '按住 WASD 移动小球，以<b> ≥120u/s 冲入圆环</b>后<b>立刻反向按键急停</b>；左侧可切换工具编辑障碍物'
      : '自由练习：跑动中突然反向按键急停，观察速度衰减与惯性；空格跳跃，跳上矮台才能登顶。';
    if (m === 'train') { this.spawnTarget(); this.phase = 'idle'; }
    else { this.phase = 'idle'; this.clearFeedback(); }
    if (!silent) { this.sets.mode = m; S.saveSettings(); }
  };

  LeftGame.prototype.setWeapon = function (speed) {
    this.weaponSpeed = speed;
    this.move.maxSpeed = speed;
    this.updateWeaponTheory();
  };

  LeftGame.prototype.updateWeaponTheory = function () {
    var r = S.Movement.simStopTimes(this.moveCfg());
    this.els.theoryBrake.textContent = '约 ' + Math.round(r.brake) + ' ms';
    this.els.theoryStrafe.textContent = '约 ' + Math.round(r.strafe) + ' ms';
  };

  LeftGame.prototype.circleHitsObstacle = function (tx, tz, r) {
    for (var i = 0; i < this.obstacles.length; i++) {
      var ob = this.obstacles[i];
      var cx = Math.max(ob.x1 - PLAYER_R, Math.min(ob.x2 + PLAYER_R, tx));
      var cz = Math.max(ob.z1 - PLAYER_R, Math.min(ob.z2 + PLAYER_R, tz));
      if (Math.hypot(tx - cx, tz - cz) < r) return true;
    }
    return false;
  };

  LeftGame.prototype.spawnTarget = function () {
    this.brakeStart = null;
    this.csFlag = false;
    var d = this.sets.dist;
    var min = d === 1 ? 260 : d === 2 ? 420 : 660;
    var max = d === 1 ? 360 : d === 2 ? 560 : 900;
    for (var i = 0; i < 24; i++) {
      var a = Math.random() * TAU;
      var r = min + Math.random() * (max - min);
      var tx = this.move.pos.x + Math.cos(a) * r;
      var tz = this.move.pos.z + Math.sin(a) * r;
      tx = Math.max(-BOUND + 220, Math.min(BOUND - 220, tx));
      tz = Math.max(-BOUND + 220, Math.min(BOUND - 220, tz));
      var dd = dist2D(tx, tz, this.move.pos.x, this.move.pos.z);
      if (dd >= min * 0.6 && dd < max * 1.6 &&
          !this.circleHitsObstacle(tx, tz, this.ringR + 26)) {
        this.target = { x: tx, z: tz };
        this.phase = 'idle';
        return;
      }
    }
    for (var j = 0; j < 60; j++) {
      var tx2 = rand(-BOUND + 260, BOUND - 260), tz2 = rand(-BOUND + 260, BOUND - 260);
      if (!this.circleHitsObstacle(tx2, tz2, this.ringR + 26) &&
          dist2D(tx2, tz2, this.move.pos.x, this.move.pos.z) > 200) {
        this.target = { x: tx2, z: tz2 };
        this.phase = 'idle';
        return;
      }
    }
    this.target = { x: 500, z: 300 };
    this.phase = 'idle';
  };

  LeftGame.prototype.clearFeedback = function () {
    this.els.feedback.classList.remove('show');
    if (this.feedbackTimer) { clearTimeout(this.feedbackTimer); this.feedbackTimer = null; }
  };
  LeftGame.prototype.flash = function (html, cls, ms) {
    var f = this.els.feedback;
    f.innerHTML = html;
    f.className = cls || '';
    f.classList.add('show');
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(function () { f.classList.remove('show'); }, ms || 1100);
  };

  /* ---------- 物理步 ---------- */
  LeftGame.prototype.physicsStep = function (dt) {
    var k = this.keys;
    var wx = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    var wz = (k.w ? 1 : 0) - (k.s ? 1 : 0);
    if (this.viewMode === '3d') {
      // 第一人称: 移动方向相对视角 (CS 式 W=前方)
      var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      var rx = cy * wx + sy * wz;
      var rz = -sy * wx + cy * wz;
      wx = rx; wz = rz;
    }
    var wish = { wx: wx, wz: wz, jump: this.jumpEdge };
    this.jumpEdge = false;
    this.move.step(dt, wish, this.world);

    var p = this.move.pos, v = this.move.vel;
    if (p.x > BOUND) { p.x = BOUND; if (v.x > 0) v.x = 0; }
    if (p.x < -BOUND) { p.x = -BOUND; if (v.x < 0) v.x = 0; }
    if (p.z > BOUND) { p.z = BOUND; if (v.z > 0) v.z = 0; }
    if (p.z < -BOUND) { p.z = -BOUND; if (v.z < 0) v.z = 0; }

    if (this.mode === 'train') this.trainLogic(dt, wish, p, v);

    this.trail.push({ x: p.x, z: p.z });
    if (this.trail.length > 36) this.trail.shift();
  };

  LeftGame.prototype.detectBrake = function (wish, v, sp, now) {
    var moving = (wish.wx !== 0 || wish.wz !== 0);
    var dot = wish.wx * v.x + wish.wz * v.z;
    var braking = !moving || dot < -5;
    if (braking && this.brakeStart == null) {
      this.brakeStart = now;
      this.brakeSpeed = sp;
      this.csFlag = dot < -5;
    } else if (!braking && dot > 5 && this.brakeStart != null) {
      this.brakeStart = null;
      this.csFlag = false;
    }
  };

  LeftGame.prototype.trainLogic = function (dt, wish, p, v) {
    var d = dist2D(p.x, p.z, this.target.x, this.target.z);
    var sp = this.move.speed();
    var now = performance.now() / 1000;

    if (this.phase === 'idle') {
      if (d <= this.ringR * 2.5 && sp > STOP) {
        this.detectBrake(wish, v, sp, now);
      } else if (this.brakeStart != null) {
        this.brakeStart = null;
        this.csFlag = false;
      }

      if (d <= this.ringR && sp > STOP) {
        if (sp < START_SPEED) {
          this.brakeStart = null;
          this.csFlag = false;
          if (now - this.slowHintAt > 2) {
            this.slowHintAt = now;
            this.flash('入速不足，请以 ≥' + START_SPEED + 'u/s 冲入圆环', '', 1100);
          }
          return;
        }
        this.phase = 'running';
        this.entryT0 = now;
        this.entrySpeed = sp;
        if (this.brakeStart == null) this.brakeSpeed = sp;
      }
      return;
    }

    if (this.phase !== 'running') return;

    if (d <= this.ringR * 2.5) {
      this.detectBrake(wish, v, sp, now);
    } else if (this.brakeStart != null) {
      this.brakeStart = null;
      this.csFlag = false;
    }

    if (sp <= STOP) {
      if (d <= this.ringR) this.finish(now);
      else {
        this.phase = 'idle';
        this.brakeStart = null;
        this.flash('停在了圆环外 <span class="sub">（提前一点急停，或别滑过头）</span>', '', 1100);
      }
    } else if (d > this.ringR * 2.2) {
      this.phase = 'idle';
      this.brakeStart = null;
      this.flash('滑出目标圈，重新来一次', '', 900);
    }
  };

  LeftGame.prototype.finish = function (now) {
    var ms = this.brakeStart != null ? (now - this.brakeStart) * 1000 : (now - this.entryT0) * 1000;
    var dev = dist2D(this.move.pos.x, this.move.pos.z, this.target.x, this.target.z);
    var brakeSpeed = this.brakeSpeed || this.entrySpeed;

    var best = S.Movement.simStopFrom(this.moveCfg(), brakeSpeed);
    var eff = best > 0 ? ms / best : 1;

    var rr = this.ringR;
    var r;
    if (eff <= 1.25 && dev <= rr * 0.22) r = 'S';
    else if (eff <= 1.5 && dev <= rr * 0.38) r = 'A';
    else if (eff <= 1.9 && dev <= rr * 0.6) r = 'B';
    else r = 'C';

    var rec = {
      ms: Math.round(ms), dev: Math.round(dev), csf: this.csFlag,
      entry: Math.round(brakeSpeed), eff: eff, r: r
    };
    this.records.unshift(rec);
    if (this.records.length > 30) this.records.pop();

    var t = this.totals;
    t.n++; t.sum += ms; if (ms < t.best) t.best = ms; if (this.csFlag) t.csf++;
    this.renderStats();
    this.renderRecords();

    var html = '<b class="r-' + r + '">' + r + '</b> 急停 <b>' + rec.ms + '</b>ms · 偏移 ' + rec.dev + 'u'
      + ' · 入速 ' + rec.entry
      + (this.csFlag ? ' <span class="ok-txt">✓ 反向急停</span>' : ' <span class="sub">· 松开刹车</span>')
      + '<br><span class="sub">效率 ' + eff.toFixed(2) + '× 理论最优(' + Math.round(best) + 'ms)</span>';
    this.flash(html, '', 1300);

    this.phase = 'done';
    this.autoNextIn = this.sets.auto ? 1.0 : null;
  };

  LeftGame.prototype.renderStats = function () {
    var t = this.totals;
    this.els.n.textContent = String(t.n);
    this.els.avg.textContent = t.n ? Math.round(t.sum / t.n) + ' ms' : '–';
    this.els.best.textContent = t.n ? Math.round(t.best) + ' ms' : '–';
    this.els.csfRate.textContent = t.n ? Math.round(t.csf / t.n * 100) + ' %' : '–';
  };

  LeftGame.prototype.renderRecords = function () {
    var el = this.els.results;
    if (!this.records.length) { el.innerHTML = '<span class="dim-txt">暂无记录</span>'; return; }
    el.innerHTML = '';
    this.records.slice(0, 12).forEach(function (rec) {
      var div = document.createElement('div');
      div.className = 'res r-' + rec.r;
      div.innerHTML = '<b>' + rec.r + '</b> ' + rec.ms + 'ms <i>偏移' + rec.dev + 'u</i>'
        + '<i>入速' + rec.entry + '</i>' + (rec.csf ? '<span class="ok-txt">✓</span>' : '');
      el.appendChild(div);
    });
  };

  /* ---------- 主循环 ---------- */
  LeftGame.prototype.frame = function (t) {
    var self = this;
    var dt = Math.min((t - this.last) / 1000, 0.05);
    this.last = t;
    if (!this.w || !this.h) this.resize();

    this.acc += dt;
    var step = S.TICK, steps = 0;
    while (this.acc >= step && steps < 24) {
      this.physicsStep(step);
      this.acc -= step;
      steps++;
    }

    if (this.phase === 'done' && this.autoNextIn != null) {
      this.autoNextIn -= dt;
      if (this.autoNextIn <= 0) { this.autoNextIn = null; this.spawnTarget(); }
    }

    var alpha = Math.min(this.acc / step, 1);
    if (this.viewMode === '2d') this.render2D(alpha, t / 1000);
    else this.render3D(alpha, t / 1000);
    requestAnimationFrame(function (tt) { self.frame(tt); });
  };

  /* ============ 2D 俯视编辑视图 ============ */
  LeftGame.prototype.render2D = function (alpha, now) {
    var ctx = this.ctx, w = this.w, h = this.h;
    if (!w || !h) return;

    var m = this.move;
    var px = m.prevPos.x + (m.pos.x - m.prevPos.x) * alpha;
    var pz = m.prevPos.z + (m.pos.z - m.prevPos.z) * alpha;
    var py = m.prevPos.y + (m.pos.y - m.prevPos.y) * alpha;
    var vx = m.prevVel.x + (m.vel.x - m.prevVel.x) * alpha;
    var vz = m.prevVel.z + (m.vel.z - m.prevVel.z) * alpha;

    var cx = w / 2, cy = h / 2;
    var ppu = Math.min(w, h) / 1050;
    this.view2d = { px: px, pz: pz, ppu: ppu, w: w, h: h };

    var g = ctx.createRadialGradient(cx, cy, 50, cx, cy, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#131a26');
    g.addColorStop(1, '#0b0f16');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(100,125,160,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var gx0 = Math.ceil((px - BOUND - GRID) / GRID) * GRID;
    var gx1 = px + BOUND + GRID;
    for (var gx = gx0; gx <= gx1; gx += GRID) {
      var sx = cx + (gx - px) * ppu;
      if (sx < -4 || sx > w + 4) continue;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    var gz0 = Math.ceil((pz - BOUND - GRID) / GRID) * GRID;
    var gz1 = pz + BOUND + GRID;
    for (var gz = gz0; gz <= gz1; gz += GRID) {
      var sy = cy - (gz - pz) * ppu;
      if (sy < -4 || sy > h + 4) continue;
      ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();

    var bx0 = cx + (-BOUND - px) * ppu, bx1 = cx + (BOUND - px) * ppu;
    var by0 = cy - (BOUND - pz) * ppu, by1 = cy - (-BOUND - pz) * ppu;
    ctx.strokeStyle = 'rgba(232,179,57,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);

    if (this.mode === 'train') {
      var tx = cx + (this.target.x - px) * ppu;
      var ty = cy - (this.target.z - pz) * ppu;
      var pulse = 1 + 0.07 * Math.sin(now * 5);
      var rc = this.ringR * ppu * pulse;
      var running = this.phase === 'running';

      ctx.beginPath();
      ctx.arc(tx, ty, rc, 0, TAU);
      ctx.fillStyle = running ? 'rgba(138,233,154,0.10)' : 'rgba(232,179,57,0.08)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tx, ty, rc, 0, TAU);
      ctx.strokeStyle = running ? 'rgba(138,233,154,0.95)' : 'rgba(232,179,57,0.9)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.save();
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -now * 26;
      ctx.beginPath();
      ctx.arc(tx, ty, rc + 9 + 3 * Math.sin(now * 5), 0, TAU);
      ctx.strokeStyle = running ? 'rgba(138,233,154,0.35)' : 'rgba(232,179,57,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      if (tx < 26 || tx > w - 26 || ty < 26 || ty > h - 26) {
        var ang = Math.atan2(ty - cy, tx - cx);
        var ex = cx + Math.cos(ang) * Math.min(w, h) * 0.34;
        var ey = cy + Math.sin(ang) * Math.min(w, h) * 0.34;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(ang);
        ctx.fillStyle = running ? '#8ae99a' : '#e8b339';
        ctx.beginPath();
        ctx.moveTo(12, 0); ctx.lineTo(-7, 7); ctx.lineTo(-7, -7);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    for (var i = 0; i < this.trail.length; i++) {
      var tp = this.trail[i];
      var a = i / this.trail.length;
      ctx.beginPath();
      ctx.arc(cx + (tp.x - px) * ppu, cy - (tp.z - pz) * ppu, 1.5 + a * 2.6, 0, TAU);
      ctx.fillStyle = 'rgba(127,216,255,' + (a * 0.22).toFixed(3) + ')';
      ctx.fill();
    }

    for (var oi = 0; oi < this.obstacles.length; oi++) this.drawObstacle2D(oi, px, pz, ppu, cx, cy, w, h);
    if (this.drag) this.drawDragPreview(px, pz, ppu, cx, cy, w, h);

    var spd = Math.hypot(vx, vz);
    if (this.sets.vector && spd > 2) {
      var vlen = (spd / this.weaponSpeed) * 150;
      var vx2 = cx + vx / spd * vlen, vy2 = cy - vz / spd * vlen;
      ctx.save();
      ctx.strokeStyle = spd > this.weaponSpeed * 0.85 ? 'rgba(226,89,78,0.85)'
        : spd > this.weaponSpeed * 0.4 ? 'rgba(232,179,57,0.85)' : 'rgba(138,233,154,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(vx2, vy2); ctx.stroke();
      var va = Math.atan2(vy2 - cy, vx2 - cx);
      ctx.translate(vx2, vy2); ctx.rotate(va);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-4, 5); ctx.lineTo(-4, -5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    var hgt = Math.max(0, py);
    var scale = 1 + Math.min(hgt, 320) / 560;
    var br = PLAYER_R * ppu * scale;
    var shadowR = PLAYER_R * ppu * Math.max(0.45, 1 - hgt / 900);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 7, shadowR, shadowR * 0.42, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    var bg = ctx.createRadialGradient(cx - br * 0.35, cy - br * 0.4, br * 0.15, cx, cy, br);
    bg.addColorStop(0, '#e8f2ff');
    bg.addColorStop(0.55, '#8fb2d8');
    bg.addColorStop(1, '#4a6a92');
    ctx.beginPath();
    ctx.arc(cx, cy, br, 0, TAU);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    this.updateHudCommon(px, py, vx, vz);
  };

  LeftGame.prototype.drawObstacle2D = function (oi, px, pz, ppu, cx, cy, w, h) {
    var ctx = this.ctx;
    var ob = this.obstacles[oi];
    var lv = OB_LEVELS[ob.lv] || OB_LEVELS[0];
    var x1 = cx + (ob.x1 - px) * ppu, x2 = cx + (ob.x2 - px) * ppu;
    var y1 = cy - (ob.z1 - pz) * ppu, y2 = cy - (ob.z2 - pz) * ppu;
    if (x2 < -8 || x1 > w + 8 || y2 < -8 || y1 > h + 8) return;

    ctx.fillStyle = lv.color;
    ctx.globalAlpha = 0.72;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = lv.dark;
    ctx.lineWidth = 2;
    ctx.strokeRect(x1 + 1, y1 + 1, x2 - x1 - 2, y2 - y1 - 2);

    if (x2 - x1 > 44 && y2 - y1 > 22) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lv.txt, (x1 + x2) / 2, (y1 + y2) / 2 + 4);
      ctx.textAlign = 'start';
    }

    if (this.tool === 'del' && this.hoverOb === oi) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x1 - 2, y1 - 2, x2 - x1 + 4, y2 - y1 + 4);
    }
  };

  LeftGame.prototype.drawDragPreview = function (px, pz, ppu, cx, cy, w, h) {
    var ctx = this.ctx;
    var d = this.drag;
    var gx1, gy1, gx2, gy2;
    if (this.tool === 'wall') {
      var T = 12;
      var dx = d.x1 - d.x0, dz = d.z1 - d.z0;
      if (Math.abs(dx) >= Math.abs(dz)) {
        gx1 = Math.min(d.x0, d.x1) - T; gx2 = Math.max(d.x0, d.x1) + T;
        gy1 = d.z0 - T; gy2 = d.z0 + T;
      } else {
        gx1 = d.x0 - T; gx2 = d.x0 + T;
        gy1 = Math.min(d.z0, d.z1) - T; gy2 = Math.max(d.z0, d.z1) + T;
      }
    } else {
      var x1 = Math.min(d.x0, d.x1), x2 = Math.max(d.x0, d.x1);
      var z1 = Math.min(d.z0, d.z1), z2 = Math.max(d.z0, d.z1);
      if (x2 - x1 < 40) { var cxm = (x1 + x2) / 2; x1 = cxm - 20; x2 = cxm + 20; }
      if (z2 - z1 < 40) { var czm = (z1 + z2) / 2; z1 = czm - 20; z2 = czm + 20; }
      gx1 = x1; gx2 = x2; gy1 = z1; gy2 = z2;
    }
    var sx1 = cx + (gx1 - px) * ppu, sx2 = cx + (gx2 - px) * ppu;
    var sy1 = cy - (gy1 - pz) * ppu, sy2 = cy - (gy2 - pz) * ppu;
    var lv = OB_LEVELS[this.hLevel];
    ctx.fillStyle = lv.color;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
    ctx.globalAlpha = 1;
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = lv.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
    ctx.setLineDash([]);
  };

  /* ============ 3D 第一人称训练视图 ============ */
  LeftGame.prototype.camVec = function (px, py, pz) {
    return { x: px, y: EYE + py, z: pz };
  };
  LeftGame.prototype.focal = function () {
    var fovDeg = clamp(this.fov, 60, 110);
    return (this.h / 2) / Math.tan(fovDeg * DEG / 2);
  };

  LeftGame.prototype.render3D = function (alpha, now) {
    var ctx = this.ctx, w = this.w, h = this.h;
    if (!w || !h) return;

    var m = this.move;
    var px = m.prevPos.x + (m.pos.x - m.prevPos.x) * alpha;
    var pz = m.prevPos.z + (m.pos.z - m.prevPos.z) * alpha;
    var py = m.prevPos.y + (m.pos.y - m.prevPos.y) * alpha;
    var vx = m.prevVel.x + (m.vel.x - m.prevVel.x) * alpha;
    var vz = m.prevVel.z + (m.vel.z - m.prevVel.z) * alpha;

    var cam = this.camVec(px, py, pz);
    var b = basis(this.yaw, this.pitch);
    var f = this.focal();

    // 天空
    var sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0b111c');
    sky.addColorStop(0.55, '#1f2c40');
    sky.addColorStop(1, '#3a4e6b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 地面
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
    for (var gx = -BOUND; gx <= BOUND; gx += GRID) {
      var sg = clipSegZ(toCam({ x: gx, y: 0, z: -BOUND }, cam, b), toCam({ x: gx, y: 0, z: BOUND }, cam, b), NEAR);
      if (sg) {
        var p1 = project(sg[0], f, w, h), p2 = project(sg[1], f, w, h);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      }
    }
    for (var gz = -BOUND; gz <= BOUND; gz += GRID) {
      var sg2 = clipSegZ(toCam({ x: -BOUND, y: 0, z: gz }, cam, b), toCam({ x: BOUND, y: 0, z: gz }, cam, b), NEAR);
      if (sg2) {
        var q1 = project(sg2[0], f, w, h), q2 = project(sg2[1], f, w, h);
        ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y);
      }
    }
    ctx.stroke();

    // 场地边界(地面金线)
    ctx.strokeStyle = 'rgba(232,179,57,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var corners = [[-BOUND, -BOUND], [BOUND, -BOUND], [BOUND, BOUND], [-BOUND, BOUND]];
    for (var ci = 0; ci < 4; ci++) {
      var a = corners[ci], c2 = corners[(ci + 1) % 4];
      var seg = clipSegZ(toCam({ x: a[0], y: 0, z: a[1] }, cam, b), toCam({ x: c2[0], y: 0, z: c2[1] }, cam, b), NEAR);
      if (!seg) continue;
      var s1 = project(seg[0], f, w, h), s2 = project(seg[1], f, w, h);
      ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
    }
    ctx.stroke();

    // 障碍物 3D 面(按距离排序)
    this.drawObstacles3D(cam, b, f, w, h);

    // 目标圆环(地面圆 + 光柱)
    if (this.mode === 'train') this.drawRing3D(cam, b, f, w, h, now);

    // 速度矢量(3D 地面箭头)
    var spd = Math.hypot(vx, vz);
    if (this.sets.vector && spd > 2) {
      var a0 = { x: px, y: 0.2, z: pz };
      var a1 = { x: px + vx / spd * (spd / this.weaponSpeed) * 130, y: 0.2, z: pz + vz / spd * (spd / this.weaponSpeed) * 130 };
      var ca0 = toCam(a0, cam, b), ca1 = toCam(a1, cam, b);
      var seg = clipSegZ(ca0, ca1, NEAR);
      if (seg) {
        var ta = project(seg[0], f, w, h), tb = project(seg[1], f, w, h);
        ctx.strokeStyle = spd > this.weaponSpeed * 0.85 ? 'rgba(226,89,78,0.8)'
          : spd > this.weaponSpeed * 0.4 ? 'rgba(232,179,57,0.8)' : 'rgba(138,233,154,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ta.x, ta.y); ctx.lineTo(tb.x, tb.y); ctx.stroke();
        var va = Math.atan2(tb.y - ta.y, tb.x - ta.x);
        ctx.save();
        ctx.translate(tb.x, tb.y); ctx.rotate(va);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, 5); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    // 准星(锁定时)
    if (this.locked) {
      var gap = 5, len = 7;
      ctx.strokeStyle = 'rgba(127,216,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w / 2 - gap - len, h / 2); ctx.lineTo(w / 2 - gap, h / 2);
      ctx.moveTo(w / 2 + gap, h / 2); ctx.lineTo(w / 2 + gap + len, h / 2);
      ctx.moveTo(w / 2, h / 2 - gap - len); ctx.lineTo(w / 2, h / 2 - gap);
      ctx.moveTo(w / 2, h / 2 + gap); ctx.lineTo(w / 2, h / 2 + gap + len);
      ctx.stroke();
    }

    // 目标屏幕外指示
    if (this.mode === 'train') {
      var tc = toCam({ x: this.target.x, y: 0, z: this.target.z }, cam, b);
      var tscr = tc.z > NEAR ? project(tc, f, w, h) : null;
      var off = !tscr || tscr.x < 34 || tscr.x > w - 34 || tscr.y < 34 || tscr.y > h - 34;
      if (off) {
        var dirAng = tscr ? Math.atan2(tscr.y - h / 2, tscr.x - w / 2) : Math.atan2(-tc.y, tc.x);
        var ar = Math.min(w, h) * 0.34;
        var ax = w / 2 + Math.cos(dirAng) * ar, ay = h / 2 + Math.sin(dirAng) * ar;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(dirAng);
        ctx.fillStyle = this.phase === 'running' ? '#8ae99a' : '#e8b339';
        ctx.beginPath();
        ctx.moveTo(14, 0); ctx.lineTo(-8, 9); ctx.lineTo(-8, -9);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(232,179,57,0.85)';
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(dist2D(px, pz, this.target.x, this.target.z)) + ' u',
          w / 2 + Math.cos(dirAng) * (ar + 26), h / 2 + Math.sin(dirAng) * (ar + 26));
        ctx.textAlign = 'start';
      }
    }

    this.updateHudCommon(px, py, vx, vz);
  };

  LeftGame.prototype.drawRing3D = function (cam, b, f, w, h, now) {
    var ctx = this.ctx;
    var segs = 40;
    var r = this.ringR;
    var tx = this.target.x, tz = this.target.z;
    var running = this.phase === 'running';
    var col = running ? '138,233,154' : '232,179,57';
    var pulse = 1 + 0.05 * Math.sin(now * 5);

    var ground = [], top = [];
    for (var i = 0; i < segs; i++) {
      var a = (i / segs) * TAU;
      var cxs = tx + Math.cos(a) * r * pulse, czs = tz + Math.sin(a) * r * pulse;
      ground.push(toCam({ x: cxs, y: 0, z: czs }, cam, b));
      top.push(toCam({ x: cxs, y: BEAM_H, z: czs }, cam, b));
    }

    // 地面圆(填充+描边)
    var gp = clipPolyZ(ground, NEAR);
    if (gp.length >= 3) {
      ctx.beginPath();
      for (var gi = 0; gi < gp.length; gi++) {
        var gs = project(gp[gi], f, w, h);
        if (gi === 0) ctx.moveTo(gs.x, gs.y); else ctx.lineTo(gs.x, gs.y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(' + col + ',0.09)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(' + col + ',0.9)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 光柱竖线
    ctx.strokeStyle = 'rgba(' + col + ',0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var bi = 0; bi < segs; bi += 2) {
      var seg = clipSegZ(ground[bi], top[bi], NEAR);
      if (!seg) continue;
      var s1 = project(seg[0], f, w, h), s2 = project(seg[1], f, w, h);
      ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
    }
    ctx.stroke();

    // 顶部圈
    var tp = clipPolyZ(top, NEAR);
    if (tp.length >= 3) {
      ctx.beginPath();
      for (var ti = 0; ti < tp.length; ti++) {
        var ts = project(tp[ti], f, w, h);
        if (ti === 0) ctx.moveTo(ts.x, ts.y); else ctx.lineTo(ts.x, ts.y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(' + col + ',0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  LeftGame.prototype.drawObstacles3D = function (cam, b, f, w, h) {
    var ctx = this.ctx;
    var faces = [];

    for (var i = 0; i < this.obstacles.length; i++) {
      var ob = this.obstacles[i];
      var lv = OB_LEVELS[ob.lv] || OB_LEVELS[0];
      var x1 = ob.x1, x2 = ob.x2, z1 = ob.z1, z2 = ob.z2, y2 = ob.h;
      var cpts = [
        { x: x1, y: 0, z: z1 }, { x: x2, y: 0, z: z1 }, { x: x2, y: 0, z: z2 }, { x: x1, y: 0, z: z2 },
        { x: x1, y: y2, z: z1 }, { x: x2, y: y2, z: z1 }, { x: x2, y: y2, z: z2 }, { x: x1, y: y2, z: z2 }
      ];
      var defs = [
        { n: [0, 0, -1], idx: [0, 1, 5, 4], col: lv.dark },
        { n: [1, 0, 0],  idx: [1, 2, 6, 5], col: lv.dark },
        { n: [0, 0, 1],  idx: [2, 3, 7, 6], col: lv.dark },
        { n: [-1, 0, 0], idx: [3, 0, 4, 7], col: lv.dark },
        { n: [0, 1, 0],  idx: [4, 5, 6, 7], col: lv.color }
      ];
      for (var di = 0; di < defs.length; di++) {
        var def = defs[di];
        var mid = { x: 0, y: 0, z: 0 };
        for (var k = 0; k < 4; k++) {
          var cp = cpts[def.idx[k]];
          mid.x += cp.x / 4; mid.y += cp.y / 4; mid.z += cp.z / 4;
        }
        // 背面剔除
        if (def.n[0] * (mid.x - cam.x) + def.n[1] * (mid.y - cam.y) + def.n[2] * (mid.z - cam.z) >= 0) continue;
        var cs = [], distSum = 0;
        for (var k2 = 0; k2 < 4; k2++) {
          var cpc = toCam(cpts[def.idx[k2]], cam, b);
          cs.push(cpc);
          distSum += cpc.z;
        }
        var clipped = clipPolyZ(cs, NEAR);
        if (clipped.length < 3) continue;
        faces.push({ d: distSum / 4, pts: clipped, col: def.col });
      }
    }

    faces.sort(function (p, q) { return q.d - p.d; });
    for (var fi = 0; fi < faces.length; fi++) {
      var face = faces[fi];
      ctx.beginPath();
      for (var pi = 0; pi < face.pts.length; pi++) {
        var sp = project(face.pts[pi], f, w, h);
        if (pi === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      }
      ctx.closePath();
      ctx.fillStyle = face.col;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };

  /* ---------- 公共 HUD ---------- */
  LeftGame.prototype.updateHudCommon = function (px, py, vx, vz) {
    var spd = Math.hypot(vx, vz);
    this.els.speedVal.textContent = Math.round(spd) + ' u/s';
    this.els.speedMps.textContent = (spd * 0.02).toFixed(1) + ' m/s';
    if (this.phase === 'running') {
      this.els.timerWrap.hidden = false;
      if (this.brakeStart != null) {
        this.els.timer.textContent = Math.round((performance.now() / 1000 - this.brakeStart) * 1000);
      } else {
        this.els.timer.textContent = '…';
      }
    } else {
      this.els.timerWrap.hidden = true;
    }
    this.updateKeys();
  };

  LeftGame.prototype.updateKeys = function () {
    var map = {
      KeyW: this.keys.w, KeyA: this.keys.a, KeyS: this.keys.s, KeyD: this.keys.d,
      Space: !this.move.grounded
    };
    var els = document.querySelectorAll('#keys .k');
    for (var i = 0; i < els.length; i++) {
      var on = map[els[i].getAttribute('data-k')];
      if (on) els[i].classList.add('on'); else els[i].classList.remove('on');
    }
  };

  S.Left = {
    init: function () { return new LeftGame(); }
  };
})();
