/* 合成音效（WebAudio，无外部资源） */
(function () {
  'use strict';
  var ctx = null, master = null, enabled = true;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function noiseBuf(dur) {
    var n = Math.floor(ctx.sampleRate * dur);
    var b = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function env(g, t, peak, dur) {
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  }
  function play(buf, filter, g, t, dur) {
    var src = ctx.createBufferSource();
    src.buffer = buf; src.start(t); src.stop(t + dur + 0.02);
    if (filter) src.connect(filter).connect(g); else src.connect(g);
    g.connect(master);
  }

  function shot() {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime;
    // 低频"枪声"主体
    var f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(2800, t);
    f.frequency.exponentialRampToValueAtTime(260, t + 0.11);
    var g = ctx.createGain(); env(g, t, 0.85, 0.12);
    play(noiseBuf(0.13), f, g, t, 0.12);
    // 高频"裂响"
    var f2 = ctx.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = 1900;
    var g2 = ctx.createGain(); env(g2, t, 0.6, 0.03);
    play(noiseBuf(0.035), f2, g2, t, 0.03);
    // 低频冲击
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    var g3 = ctx.createGain(); env(g3, t, 0.5, 0.1);
    o.connect(g3); g3.connect(master); o.start(t); o.stop(t + 0.11);
  }

  function hit() {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(); o.type = 'triangle';
    var base = 620 + Math.random() * 120;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.7, t + 0.07);
    var g = ctx.createGain(); env(g, t, 0.55, 0.09);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.1);
  }

  function miss() {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 320; f.Q.value = 1.2;
    var g = ctx.createGain(); env(g, t, 0.34, 0.09);
    play(noiseBuf(0.1), f, g, t, 0.09);
  }

  function pop() {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(640, t + 0.05);
    var g = ctx.createGain(); env(g, t, 0.4, 0.06);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.07);
  }

  function ui() {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 940;
    var g = ctx.createGain(); env(g, t, 0.12, 0.03);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.04);
  }

  window.CSX.SFX = {
    ensure: ensure,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    shot: shot, hit: hit, miss: miss, pop: pop, ui: ui
  };
})();
