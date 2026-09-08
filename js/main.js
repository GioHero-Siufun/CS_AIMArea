/* 应用启动: 标签切换 / 顶栏控件 / 全局按键防误触 */
(function () {
  'use strict';
  var S = window.CSX;

  function $(id) { return document.getElementById(id); }

  function boot() {
    var left = null, aim = null;

    /* ---- 武器（决定移速） ---- */
    var sel = $('g-weapon'), cw = $('g-customWrap'), cs = $('g-customSpeed'), cv = $('g-customVal');
    S.WEAPONS.forEach(function (w) {
      var o = document.createElement('option');
      o.value = w.id;
      o.textContent = w.name + (w.speed != null ? ' · ' + w.speed + ' u/s' : '');
      sel.appendChild(o);
    });
    sel.value = S.settings.weapon;
    cs.value = String(S.settings.customSpeed);
    cv.textContent = String(S.settings.customSpeed);
    cw.hidden = sel.value !== 'custom';

    function applyWeapon() {
      var sp = S.weaponSpeed();
      if (left) left.setWeapon(sp);
      if (aim) aim.setWeapon(sp);
    }
    sel.addEventListener('change', function () {
      sel.blur();
      S.settings.weapon = sel.value;
      S.saveSettings();
      cw.hidden = sel.value !== 'custom';
      applyWeapon();
    });
    cs.addEventListener('input', function () {
      S.settings.customSpeed = +cs.value;
      cv.textContent = cs.value;
      S.saveSettings();
      applyWeapon();
    });

    /* ---- 音效 ---- */
    var snd = $('g-sound');
    snd.checked = !!S.settings.sound;
    S.SFX.enabled = snd.checked;
    snd.addEventListener('change', function () {
      S.settings.sound = snd.checked;
      S.SFX.enabled = snd.checked;
      S.saveSettings();
    });

    /* ---- 启动两个训练器 ---- */
    left = S.Left.init();
    aim = S.Aim.init();
    applyWeapon();

    /* ---- 标签切换 ---- */
    var tabs = document.querySelectorAll('.tab');
    function activate(name) {
      if (name !== 'left' && name !== 'aim') name = 'left';
      S.settings.tab = name;
      S.saveSettings();
      if (document.pointerLockElement) document.exitPointerLock(); // 切换模块时释放鼠标锁定
      $('tab-left-sec').classList.toggle('hidden', name !== 'left');
      $('tab-aim-sec').classList.toggle('hidden', name !== 'aim');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
      }
      if (name === 'left') {
        if (left) { left.resize(); left.onTabEnter(); }
      } else {
        if (aim) { aim.resize(); aim.updateOverlays(); }
      }
    }
    for (var i = 0; i < tabs.length; i++) {
      (function (t) {
        t.addEventListener('click', function () {
          t.blur();
          activate(t.getAttribute('data-tab'));
          S.SFX.ui();
        });
      })(tabs[i]);
    }
    activate(S.settings.tab === 'aim' ? 'aim' : 'left');

    /* ---- 全局按键防误触（空格翻页 / 焦点控件干扰） ---- */
    window.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (e.code === 'Space') e.preventDefault();
    });

    /* ---- 首次交互解锁音频 ---- */
    function firstTouch() {
      S.SFX.ensure();
      window.removeEventListener('mousedown', firstTouch);
      window.removeEventListener('keydown', firstTouch);
    }
    window.addEventListener('mousedown', firstTouch);
    window.addEventListener('keydown', firstTouch);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
