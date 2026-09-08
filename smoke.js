/* 物理冒烟测试 (node smoke.js): 验证移动模型符合 CS2 数值预期 */
'use strict';
global.window = global;
require('./js/config.js');
require('./js/physics.js');

var CSX = global.CSX;
var M = CSX.Movement;

function run(keys, seconds) {
  var m = new M(CSX.CS2);
  m.vel.x = m.maxSpeed; // 满速出发
  var t = 0, dt = CSX.TICK, peak = 0, steps = Math.ceil(seconds / dt);
  for (var i = 0; i < steps; i++) {
    m.step(dt, keys);
    t += dt;
    var sp = m.speed();
    if (sp > peak) peak = sp;
    if (sp < 0.6) break;
  }
  return { t: t * 1000, peak: peak, pos: m.pos, vel: m.vel };
}

// 1) 直线加速: 从静止起跑, 应渐进到 250 u/s 附近
(function () {
  var m = new M(CSX.CS2);
  var t = 0;
  for (var i = 0; i < Math.ceil(3 / CSX.TICK); i++) { m.step(CSX.TICK, { wx: 1, wz: 0, jump: false }); t += CSX.TICK; }
  console.log('1) 直线 3s 末速 =', m.speed().toFixed(1), 'u/s (预期≈250), 位移 =', m.pos.x.toFixed(0), 'u');
})();

// 2) 松开刹车 vs 反向急停 (250→0, 急停为"降到 8 u/s 即松开"的理想点按)
function timed(oppose) {
  var m = new M(CSX.CS2);
  m.vel.x = 250;
  var t = 0;
  for (var i = 0; i < Math.ceil(3 / CSX.TICK); i++) {
    m.step(CSX.TICK, { wx: (oppose && m.speed() > 8) ? -1 : 0, wz: 0, jump: false });
    t += CSX.TICK;
    if (m.speed() < 0.6) break;
  }
  return t * 1000;
}
console.log('2) 松开刹车停止 =', timed(false).toFixed(1), 'ms | 反向急停 =', timed(true).toFixed(1), 'ms (需明显更短)');

// 3) 斜向 45° (W+D) 满速应与直线一致 (CS 方向归一化)
(function () {
  var m = new M(CSX.CS2);
  for (var i = 0; i < Math.ceil(3 / CSX.TICK); i++) m.step(CSX.TICK, { wx: 1, wz: 1, jump: false });
  console.log('3) 斜向 3s 末速 =', m.speed().toFixed(1), '(预期≈250)');
})();

// 4) 跳跃: 起跳竖直速度与滞空高度
(function () {
  var m = new M(CSX.CS2);
  m.step(CSX.TICK, { wx: 0, wz: 0, jump: true });
  var vy0 = m.vel.y, t = 0, hmax = 0;
  for (var i = 0; i < Math.ceil(2 / CSX.TICK) && !m.grounded; i++) { m.step(CSX.TICK, { wx: 0, wz: 0, jump: false }); t += CSX.TICK; hmax = Math.max(hmax, m.pos.y); }
  console.log('4) 起跳速度 =', vy0.toFixed(1), '| 最高点 =', hmax.toFixed(1), 'u | 滞空 ≈', t.toFixed(3), 's (预期≈302 / 57 / 0.75)');
})();

// 5) 反向急停位移: 250→0 期间滑行距离 (cs 急停常用指标)
(function () {
  var m = new M(CSX.CS2);
  m.vel.x = 250;
  var x0 = 0;
  for (var i = 0; i < Math.ceil(3 / CSX.TICK); i++) {
    m.step(CSX.TICK, { wx: (m.speed() > 8) ? -1 : 0, wz: 0, jump: false });
    if (m.speed() < 0.6) break;
  }
  console.log('5) 反向急停滑行距离 =', Math.abs(m.pos.x - x0).toFixed(1), 'u (预期≈12~20)');
})();

// 6) simStopTimes 与侧栏显示一致
var s = M.simStopTimes(CSX.CS2);
console.log('6) simStopTimes(brake, strafe) =', s.brake.toFixed(0), 'ms /', s.strafe.toFixed(0), 'ms');

// ===== 障碍物地形测试 =====
var R = 16, STEP = M.STEP_UP;
function makeWorld(obs) {
  return {
    resolve: function (pos, vel, y, axis) {
      for (var i = 0; i < obs.length; i++) {
        var ob = obs[i];
        if (ob.h <= y + STEP) continue;
        if (pos.x > ob.x1 - R && pos.x < ob.x2 + R && pos.z > ob.z1 - R && pos.z < ob.z2 + R) {
          if (axis === 'x') { if (vel.x > 0) pos.x = ob.x1 - R; else if (vel.x < 0) pos.x = ob.x2 + R; vel.x = 0; }
          else { if (vel.z > 0) pos.z = ob.z1 - R; else if (vel.z < 0) pos.z = ob.z2 + R; vel.z = 0; }
        }
      }
    },
    groundY: function (x, z) {
      var g = 0, m = R * 0.6;
      for (var i = 0; i < obs.length; i++) {
        var ob = obs[i];
        if (x > ob.x1 - m && x < ob.x2 + m && z > ob.z1 - m && z < ob.z2 + m) g = Math.max(g, ob.h);
      }
      return g;
    }
  };
}

// 7) 96u 高墙: 正面全速撞击应被挡住 (法向速度归零)
(function () {
  var wall = [{ x1: 150, x2: 158, z1: -300, z2: 300, h: 96 }];
  var m = new M(CSX.CS2); m.reset(0, 0); m.vel.x = 250;
  var t = 0;
  for (var i = 0; i < 200; i++) { m.step(CSX.TICK, { wx: 1, wz: 0, jump: false }, makeWorld(wall)); t += CSX.TICK; }
  console.log('7) 96u 墙阻挡: x =', m.pos.x.toFixed(1), '(预期=134=150-16), 速度 =', m.vel.x.toFixed(1), '(预期 0)');
})();

// 8) 14u 矮台: 无需跳跃直接跨上 (auto step), 走过之后回到地面
(function () {
  var box = [{ x1: 100, x2: 220, z1: -30, z2: 30, h: 14 }];
  var m = new M(CSX.CS2); m.reset(0, 0);
  var t = 0, onTop = false, maxY = 0;
  for (var i = 0; i < Math.ceil(4 / CSX.TICK); i++) {
    m.step(CSX.TICK, { wx: 1, wz: 0, jump: false }, makeWorld(box)); t += CSX.TICK;
    maxY = Math.max(maxY, m.pos.y);
    if (m.pos.y > 10) onTop = true;
    if (m.pos.x > 260) break;
  }
  console.log('8) 14u 矮台: 最高点 y =', maxY.toFixed(1), ", 上过台面 =", onTop, ', 最终 y =', m.pos.y.toFixed(1), 'x =', m.pos.x.toFixed(0), '(预期跨过后回到 0)');
})();

// 9) 40u 高台: 无法直接跨上, 但可以跳上去
(function () {
  var box = [{ x1: 150, x2: 250, z1: -30, z2: 30, h: 40 }];
  function run(withJump) {
    var m = new M(CSX.CS2); m.reset(0, 0);
    var landed = false, maxY = 0;
    var jumped = false;
    for (var i = 0; i < Math.ceil(4 / CSX.TICK); i++) {
      var jump = false;
      if (withJump && !jumped && m.pos.x > 60 && m.pos.x < 95) { jump = true; jumped = true; }
      m.step(CSX.TICK, { wx: 1, wz: 0, jump: jump }, makeWorld(box));
      maxY = Math.max(maxY, m.pos.y);
      if (m.pos.y === 40) landed = true;
      if (m.pos.x > 300) break;
    }
    return { landed: landed, maxY: maxY, x: m.pos.x, y: m.pos.y };
  }
  var walk = run(false), jump = run(true);
  console.log('9) 40u 高台: 不跳 x 止步于', walk.x.toFixed(1), '(预期 134=150-16); 起跳后可以登顶 =', jump.landed, ', 落点 x =', jump.x.toFixed(0), ', y =', jump.y.toFixed(0));
})();

// 10) 效率指标: 不同入速下的理论最优急停
(function () {
  var v120 = M.simStopFrom(CSX.CS2, 120), v250 = M.simStopFrom(CSX.CS2, 250), v200 = M.simStopFrom(CSX.CS2, 200);
  console.log('10) 理论最优急停: 120u/s →', v120.toFixed(0), 'ms | 200u/s →', v200.toFixed(0), 'ms | 250u/s →', v250.toFixed(0), 'ms');
})();
