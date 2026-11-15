/* AquaSort audio engine — Web Audio API, zero dependencies.
   Procedural BGM sequencer + one-shot SFX. Everything routes through
   musicGain / sfxGain into a master gain so mute is one assignment. */
(function (global) {
  'use strict';

  var NOTES = {
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00,
    R: 0
  };

  var ctx = null;
  var master = null;
  var musicBus = null;
  var sfxBus = null;
  var currentBgm = null;
  var bgmName = null;
  var unlocked = false;

  var settings = {
    music: 0.35,
    sfx: 0.65,
    musicOn: true,
    sfxOn: true
  };

  function init() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = settings.musicOn ? settings.music : 0;
    musicBus.connect(master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfxOn ? settings.sfx : 0;
    sfxBus.connect(master);
    return ctx;
  }

  /* Browsers block audio until a gesture; call this from any click handler. */
  function unlock() {
    if (!ctx) init();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
    return true;
  }

  function applyGains() {
    if (!ctx) return;
    var t = ctx.currentTime;
    if (musicBus) {
      musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.setTargetAtTime(settings.musicOn ? settings.music : 0, t, 0.02);
    }
    if (sfxBus) {
      sfxBus.gain.cancelScheduledValues(t);
      sfxBus.gain.setTargetAtTime(settings.sfxOn ? settings.sfx : 0, t, 0.02);
    }
  }

  function setMusic(v) { settings.music = Math.max(0, Math.min(1, v)); applyGains(); }
  function setSfx(v) { settings.sfx = Math.max(0, Math.min(1, v)); applyGains(); }
  function setMusicOn(on) { settings.musicOn = !!on; applyGains(); }
  function setSfxOn(on) { settings.sfxOn = !!on; applyGains(); }

  function getSettings() {
    return {
      music: settings.music, sfx: settings.sfx,
      musicOn: settings.musicOn, sfxOn: settings.sfxOn
    };
  }

  function loadSettings(s) {
    if (!s) return;
    if (typeof s.music === 'number') settings.music = Math.max(0, Math.min(1, s.music));
    if (typeof s.sfx === 'number') settings.sfx = Math.max(0, Math.min(1, s.sfx));
    if (typeof s.musicOn === 'boolean') settings.musicOn = s.musicOn;
    if (typeof s.sfxOn === 'boolean') settings.sfxOn = s.sfxOn;
    applyGains();
  }

  /* ---------------- one-shot synthesis ---------------- */

  function tone(freq, type, dur, gain, lpf, when, glideTo) {
    if (!unlock()) return;
    var t0 = when != null ? when : ctx.currentTime;
    var osc, g, f;
    try {
      osc = ctx.createOscillator();
      g = ctx.createGain();
      f = ctx.createBiquadFilter();
    } catch (e) { return; }

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    f.type = 'lowpass';
    f.frequency.setValueAtTime(lpf || 4000, t0);

    osc.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, gain, lpf, hpf, when) {
    if (!unlock()) return;
    var t0 = when != null ? when : ctx.currentTime;
    var n = Math.floor(ctx.sampleRate * dur);
    if (n <= 0 || n > ctx.sampleRate * 3) return;
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    var src = ctx.createBufferSource();
    src.buffer = buf;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(lpf || 4000, t0);

    var last = src.connect(lp);
    if (hpf) {
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(hpf, t0);
      lp.connect(hp);
      last = hp;
    }
    last.connect(g);
    g.connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur);
  }

  /* ---------------- SFX presets ---------------- */

  var SFX = {
    /* picking a tube: soft pip */
    select: function () { tone(880, 'sine', 0.07, 0.14, 6000); },

    /* water landing in a tube */
    pour: function () {
      tone(340, 'sine', 0.16, 0.16, 2400, null, 190);
      noise(0.13, 0.07, 2600, 700);
    },

    /* illegal move */
    invalid: function () {
      tone(150, 'square', 0.1, 0.13, 900, null, 110);
      tone(112, 'square', 0.12, 0.09, 700);
    },

    /* undo */
    undo: function () { tone(520, 'triangle', 0.11, 0.14, 3000, null, 720); },

    /* hint granted */
    hint: function () {
      if (!unlock()) return;
      var t = ctx.currentTime;
      tone(1046, 'sine', 0.09, 0.12, 7000, t);
      tone(1318, 'sine', 0.11, 0.10, 7000, t + 0.07);
    },

    /* a tube is completed */
    tubeDone: function () {
      if (!unlock()) return;
      var t = ctx.currentTime;
      tone(784, 'triangle', 0.10, 0.13, 5000, t);
      tone(1046, 'triangle', 0.12, 0.11, 5000, t + 0.06);
    },

    /* level won: rising arpeggio */
    win: function () {
      var seq = [523.25, 659.25, 783.99, 1046.5];
      if (!unlock()) return;
      var t = ctx.currentTime;
      for (var i = 0; i < seq.length; i++) tone(seq[i], 'triangle', 0.26, 0.15, 6000, t + i * 0.085);
      tone(1318.5, 'sine', 0.55, 0.09, 8000, t + 0.34);
    },

    /* spent gems */
    coin: function () {
      if (!unlock()) return;
      var t = ctx.currentTime;
      tone(988, 'square', 0.07, 0.10, 5000, t);
      tone(1319, 'square', 0.10, 0.09, 5000, t + 0.05);
    },

    /* generic UI tap */
    click: function () { tone(660, 'sine', 0.05, 0.1, 6000); },

    /* error / not enough gems */
    error: function () { tone(220, 'sawtooth', 0.16, 0.1, 1200, null, 160); }
  };

  function play(name) {
    if (!settings.sfxOn || settings.sfx <= 0) return;
    var fn = SFX[name];
    if (!fn) return;
    try { fn(); } catch (e) { /* audio must never break gameplay */ }
  }

  /* ---------------- BGM sequencer ---------------- */

  function parsePattern(str, type, gain, lpf) {
    return str.split(' ').map(function (n) {
      if (n === 'R' || n === '~' || !NOTES[n]) return { freq: 0 };
      return { freq: NOTES[n], type: type, gain: gain, lpf: lpf };
    });
  }

  function sequencer(layers, bpm, stepsPerBeat) {
    if (!unlock()) return { stop: function () {} };
    var stepDur = 60 / bpm / (stepsPerBeat || 2);
    var nextTime = ctx.currentTime + 0.06;
    var step = 0;
    var stopped = false;
    var timer = null;

    function schedule() {
      if (stopped) return;
      while (nextTime < ctx.currentTime + 0.12) {
        for (var li = 0; li < layers.length; li++) {
          var layer = layers[li];
          var note = layer[step % layer.length];
          if (note && note.freq > 0) {
            /* gentle random dropout keeps the loop from feeling mechanical */
            if (Math.random() < 0.06) continue;
            var osc = ctx.createOscillator();
            var g = ctx.createGain();
            var f = ctx.createBiquadFilter();
            osc.type = note.type || 'triangle';
            osc.frequency.setValueAtTime(note.freq, nextTime);
            var dur = note.duration || stepDur * 1.6;
            g.gain.setValueAtTime(0.0001, nextTime);
            g.gain.exponentialRampToValueAtTime(note.gain || 0.12, nextTime + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, nextTime + dur);
            f.type = 'lowpass';
            f.frequency.setValueAtTime(note.lpf || 2200, nextTime);
            osc.connect(f); f.connect(g); g.connect(musicBus);
            osc.start(nextTime);
            osc.stop(nextTime + dur + 0.02);
          }
        }
        step++;
        nextTime += stepDur;
      }
      timer = setTimeout(schedule, 25);
    }

    schedule();
    return {
      stop: function () {
        stopped = true;
        if (timer) clearTimeout(timer);
      }
    };
  }

  /* Calm, watery, loop-safe: 16-step melody, 12-step bass so they realign
     only after LCM(16,12)=48 steps (~44s at 130bpm). */
  var PATTERNS = {
    menu: {
      bpm: 92,
      stepsPerBeat: 2,
      layers: function () {
        return [
          parsePattern('C4 R E4 G4 R A4 G4 R E4 R D4 E4 C4 R R R', 'triangle', 0.075, 1800),
          parsePattern('C3 R G3 R A3 R F3 R', 'sine', 0.085, 600),
          parsePattern('C5 R R G5 R R E5 R R A5 R R G5 R R R', 'sine', 0.022, 4000)
        ];
      }
    },
    game: {
      bpm: 116,
      stepsPerBeat: 2,
      layers: function () {
        return [
          parsePattern('D4 F4 A4 F4 D4 C4 D4 R F4 A4 C5 A4 F4 D4 R R', 'triangle', 0.07, 2000),
          parsePattern('D3 R D3 R A3 R A3 R C3 R C3 R D3 R R R', 'sine', 0.08, 520),
          parsePattern('D5 R A5 R R F5 R R D5 R A5 R R E5 R R', 'sine', 0.02, 4500)
        ];
      }
    }
  };

  function playMusic(name) {
    if (bgmName === name && currentBgm) return;
    stopMusic();
    if (!settings.musicOn || settings.music <= 0) { bgmName = name; return; }
    var p = PATTERNS[name];
    if (!p) return;
    bgmName = name;
    try { currentBgm = sequencer(p.layers(), p.bpm, p.stepsPerBeat); } catch (e) { currentBgm = null; }
  }

  function stopMusic() {
    if (currentBgm) {
      try { currentBgm.stop(); } catch (e) {}
      currentBgm = null;
    }
  }

  function suspendMusic() { stopMusic(); }
  function resumeMusic() {
    if (bgmName) {
      var n = bgmName;
      bgmName = null;
      playMusic(n);
    }
  }

  global.AQAudio = {
    init: init,
    unlock: unlock,
    play: play,
    playMusic: playMusic,
    stopMusic: stopMusic,
    suspendMusic: suspendMusic,
    resumeMusic: resumeMusic,
    setMusic: setMusic,
    setSfx: setSfx,
    setMusicOn: setMusicOn,
    setSfxOn: setSfxOn,
    getSettings: getSettings,
    loadSettings: loadSettings
  };
})(window);
