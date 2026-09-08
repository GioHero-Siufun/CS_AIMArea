/* Source 引擎式移动物理（CS2 同款算法）
 *
 * 每个物理步（地面）:
 *   1) 摩擦   drop = max(stopspeed, speed) * friction * dt   —— 与 CS:GO/CS2 一致的摩擦模型
 *   2) 加速   add  = sv_accelerate * wishspeed * dt（且不超过 wishspeed - 当前投影速度）
 * 空中: 空中加速(airaccelerate) + 重力。
 * 反向急停的物理本质: 按住与速度相反的方向键时, 加速项和摩擦项同时作用,
 * 减速远超单纯松开按键的摩擦衰减 —— 这就是 CS 里"反向键刹车"的手感来源。
 */
(function () {
  'use strict';
  var S = window.CSX;

  function Movement(cfg) {
    this.setConst(cfg || S.CS2);
    this.reset(0, 0);
  }
  Movement.prototype.setConst = function (c) {
    this.maxSpeed  = c.maxSpeed  != null ? c.maxSpeed  : 250;
    this.accel     = c.accel     != null ? c.accel     : 5.5;
    this.friction  = c.friction  != null ? c.friction  : 5.2;
    this.stopSpeed = c.stopSpeed != null ? c.stopSpeed : 80;
    this.airAccel  = c.airAccel  != null ? c.airAccel  : 12;
    this.gravity   = c.gravity   != null ? c.gravity   : 800;
    this.jumpVel   = c.jumpVel   != null ? c.jumpVel   : 301.99;
  };
  Movement.prototype.reset = function (x, z) {
    this.pos = { x: x, y: 0, z: z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.prevPos = { x: x, y: 0, z: z };
    this.prevVel = { x: 0, y: 0, z: 0 };
    this.grounded = true;
    this.prevGrounded = true;
  };
  Movement.prototype.speed = function () {
    return Math.hypot(this.vel.x, this.vel.z);
  };
  Movement.prototype._friction = function (dt) {
    var sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 0.1) { this.vel.x = 0; this.vel.z = 0; return; }
    var control = Math.max(this.stopSpeed, sp);
    var drop = control * this.friction * dt;
    var ns = Math.max(sp - drop, 0);
    var k = ns / sp;
    this.vel.x *= k; this.vel.z *= k;
  };
  Movement.prototype._accelerate = function (dt, wx, wz) {
    var wish = this.maxSpeed;
    var cur = this.vel.x * wx + this.vel.z * wz;
    var add = wish - cur;
    if (add <= 0) return;
    var a = Math.min(this.accel * wish * dt, add);
    this.vel.x += wx * a; this.vel.z += wz * a;
  };
  Movement.prototype._airAccelerate = function (dt, wx, wz) {
    var wish = this.maxSpeed;
    var cur = this.vel.x * wx + this.vel.z * wz;
    var add = wish - cur;
    if (add <= 0) return;
    var a = Math.min(this.airAccel * wish * dt, add);
    this.vel.x += wx * a; this.vel.z += wz * a;
  };
  /* input: { wx, wz } 期望移动方向(世界系, 模块化之后应已归一化), jump: 本帧起跳
   * world(可选): 地形钩子
   *   world.resolve(pos, vel, y, axis): 水平碰撞（axis 为刚完成的积分轴 'x'|'z'）
   *   world.groundY(x, z): 脚下地面高度（可站上障碍物顶）
   * 无 world 时为平地（y=0），供瞄准训练使用。 */
  Movement.STEP_UP = 18;     // CS:GO/CS2 步高（无需跳跃即可跨上的最大高度）
  Movement.STEP_DOWN = 18;   // 可直接走下的小台阶
  Movement.prototype.step = function (dt, input, world) {
    this.prevPos = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    this.prevVel = { x: this.vel.x, y: this.vel.y, z: this.vel.z };
    this.prevGrounded = this.grounded;

    var wx = input.wx || 0, wz = input.wz || 0;
    var len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }

    if (this.grounded && input.jump) {
      this.vel.y = this.jumpVel;
      this.grounded = false;
    }

    if (this.grounded) {
      this._friction(dt);
      if (wx !== 0 || wz !== 0) this._accelerate(dt, wx, wz);
    } else {
      if (wx !== 0 || wz !== 0) this._airAccelerate(dt, wx, wz);
      this.vel.y -= this.gravity * dt;
    }

    if (world && world.resolve) {
      // 轴分离积分 + 碰撞（防止隧道穿透, 可沿墙滑行）
      this.pos.x += this.vel.x * dt;
      world.resolve(this.pos, this.vel, this.pos.y, 'x');
      this.pos.z += this.vel.z * dt;
      world.resolve(this.pos, this.vel, this.pos.y, 'z');
    } else {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
    }

    this.pos.y += this.vel.y * dt;
    var gy = (world && world.groundY) ? world.groundY(this.pos.x, this.pos.z) : 0;

    if (this.grounded) {
      var dy = gy - this.pos.y;
      if (dy > 0.0001) {
        if (dy <= Movement.STEP_UP) { this.pos.y = gy; this.vel.y = 0; } /* 顺势踏上矮台 */
        /* dy > STEP_UP 时理论上已被 resolve 挡住, 不处理 */
      } else if (dy < -0.0001) {
        if (-dy <= Movement.STEP_DOWN) { this.pos.y = gy; this.vel.y = 0; } /* 走下小台阶 */
        else { this.grounded = false; } /* 走出高台边缘 → 落下 */
      }
    } else if (this.pos.y <= gy && this.vel.y <= 0) {
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
    }
  };
  Movement.prototype.lerp = function (alpha) {
    var p = this.prevPos, q = this.pos;
    return {
      x: p.x + (q.x - p.x) * alpha,
      y: p.y + (q.y - p.y) * alpha,
      z: p.z + (q.z - p.z) * alpha
    };
  };
  Movement.prototype.lerpVel = function (alpha) {
    var p = this.prevVel, q = this.vel;
    return {
      x: p.x + (q.x - p.x) * alpha,
      y: p.y + (q.y - p.y) * alpha,
      z: p.z + (q.z - p.z) * alpha
    };
  };

  /* 数值模拟: 从指定速度出发, 理想反向急停的停止耗时 (ms)
   * "理想点按": 按住反向键直到速度降到 8 u/s 就松开（再按会反向加速）。 */
  Movement.simStopFrom = function (cfg, speed) {
    var m = new Movement(cfg);
    m.vel.x = Math.max(0, Math.min(speed, m.maxSpeed));
    m.vel.z = 0;
    var t = 0, dt = S.TICK;
    while (t < 4) {
      var opp = m.speed() > 8;
      m.step(dt, { wx: opp ? -1 : 0, wz: 0, jump: false });
      t += dt;
      if (m.speed() < 0.6) break;
    }
    return t * 1000;
  };
  /* 数值模拟: 满速滑行时「松开刹车」与「反向急停」的停止耗时 (ms) */
  Movement.simStopTimes = function (cfg) {
    function simRelease() {
      var m = new Movement(cfg);
      m.vel.x = m.maxSpeed; m.vel.z = 0;
      var t = 0, dt = S.TICK;
      while (t < 4) {
        m.step(dt, { wx: 0, wz: 0, jump: false });
        t += dt;
        if (m.speed() < 0.6) break;
      }
      return t * 1000;
    }
    return { brake: simRelease(), strafe: Movement.simStopFrom(cfg, cfg.maxSpeed) };
  };

  S.Movement = Movement;
})();
