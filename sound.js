/* Daily Drift: the sound. Everything is synthesised live with Web Audio: no recordings.
   Slow detuned pads with a little tape wobble, a soft bass, sparse glassy bells through a
   long dark reverb, a breath of air, and the touch voices. Works with an AudioContext or,
   for testing, an OfflineAudioContext.
   Kept light on purpose: phones must render every sample in real time, and a graph that is
   too heavy leaves gaps that sound like crackle. One shared tape wobble (a gently moving
   delay) replaces per-oscillator pitch drift, each note uses as few oscillators as it can,
   and finished notes are released promptly. */
(function (root) {
  'use strict';
  const C = root.Core || (typeof require !== 'undefined' ? require('./core.js') : null);

  function satCurve(k) {
    const n = 2048, c = new Float32Array(n), t = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / t; }
    return c;
  }

  // A long, dark hall: decaying noise whose brightness falls away as it fades. One channel, so the
  // phone convolves once; the engine spreads it into stereo afterwards.
  function makeIR(ctx, secs) {
    const rate = ctx.sampleRate, len = Math.floor(rate * secs), pre = Math.floor(rate * 0.024);
    const buf = ctx.createBuffer(1, len, rate);
    for (let ch = 0; ch < 1; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0, s = ch ? 0x2545f491 : 0x9e3779b9;
      for (let i = pre; i < len; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const x = s / 2147483648 - 1, t = (i - pre) / rate;
        const a = 0.05 + 0.8 * Math.exp(-t / 1.2);
        y += a * (x - y);
        d[i] = y * Math.sqrt((2 - a) / a) * Math.exp((-6.9 * t) / secs);
      }
      for (let i = pre; i < pre + 200; i++) d[i] *= (i - pre) / 200;
    }
    return buf;
  }

  // Seamlessly looping pink noise for the air underneath.
  function makeNoise(ctx, secs) {
    const rate = ctx.sampleRate, len = Math.floor(rate * secs), fade = Math.floor(rate * 0.5);
    const raw = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, s = 0x1b873593;
    for (let i = 0; i < raw.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const w = s / 2147483648 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      raw[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    }
    const buf = ctx.createBuffer(1, len, rate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = raw[i];
    for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = raw[i] * k + raw[len + i] * (1 - k); }
    return buf;
  }

  function createEngine(ctx, opts) {
    opts = opts || {};
    const now = () => ctx.currentTime;
    const gain = (v, to) => { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const panner = (v, to) => { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, v)); if (to) p.connect(to); return p; };

    /* master: gentle low cut, a darker top like worn tape, soft saturation, light glue */
    const out = gain(0, opts.destination || ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 2.5; comp.attack.value = 0.02; comp.release.value = 0.4;
    comp.connect(out);
    const shaper = ctx.createWaveShaper(); shaper.curve = satCurve(1.25); shaper.oversample = 'none'; shaper.connect(comp);
    const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 5000; shelf.gain.value = -5; shelf.connect(shaper);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32; hp.Q.value = 0.5; hp.connect(shelf);
    const sum = gain(0.9, hp);

    let musicLevel = opts.music == null ? 0.7 : opts.music;
    let touchLevel = opts.touch == null ? 0.8 : opts.touch;
    const music = gain(0, sum);
    const touch = gain(touchLevel, sum);

    const verb = ctx.createConvolver(); verb.buffer = makeIR(ctx, 4.6);
    const verbIn = gain(1, verb); verbIn.channelCount = 1; verbIn.channelCountMode = 'explicit'; verbIn.channelInterpretation = 'speakers';
    // Mono hall into stereo: the right side hears it a moment later and a little darker.
    const wide = ctx.createChannelMerger(2), late = ctx.createDelay(0.1), dark = ctx.createBiquadFilter();
    late.delayTime.value = 0.019; dark.type = 'lowpass'; dark.frequency.value = 3200;
    verb.connect(wide, 0, 0); verb.connect(late); late.connect(dark); dark.connect(wide, 0, 1);
    wide.connect(gain(1.1, sum));
    const musicWet = gain(0, verbIn);
    const touchWet = gain(touchLevel, verbIn);

    /* tape wobble: the whole music bus passes through a short delay whose length drifts slowly,
       which bends the pitch of everything together, like a worn tape. */
    const wowIn = gain(1), wow = ctx.createDelay(0.05);
    wow.delayTime.value = 0.012;
    const lfoA = osc('sine', 0.23), lfoB = osc('sine', 0.071);
    const depA = gain(0.0022), depB = gain(0.0045);   // about ±6 and ±3 cents
    lfoA.connect(depA); lfoB.connect(depB); depA.connect(wow.delayTime); depB.connect(wow.delayTime);
    lfoA.start(); lfoB.start();
    wowIn.connect(wow); wow.connect(music); wow.connect(gain(0.6, musicWet));
    const pads = gain(1, wowIn);
    const bells = gain(1, wowIn); bells.connect(gain(0.25, musicWet));
    const delay = ctx.createDelay(4); delay.delayTime.value = 1;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2400;
    const fb = gain(0.36, delay);
    bells.connect(delay); delay.connect(dlp); dlp.connect(fb);
    dlp.connect(gain(0.3, wowIn)); dlp.connect(gain(0.15, musicWet));
    const touchBus = gain(1, touch); touchBus.connect(gain(0.75, touchWet));


    /* air */
    const airSrc = ctx.createBufferSource(); airSrc.buffer = makeNoise(ctx, 6); airSrc.loop = true;
    const airBp = ctx.createBiquadFilter(); airBp.type = 'bandpass'; airBp.frequency.value = 1400; airBp.Q.value = 0.45;
    const airG = gain(0.05, music); airSrc.connect(airBp); airBp.connect(airG);
    const airLfo = osc('sine', 0.045), airDepth = gain(0.025);
    airLfo.connect(airDepth); airDepth.connect(airG.gain); airLfo.start(); airSrc.start();

    let P = null, running = false, chordIdx = 0, nextChord = 0, prevVoicing = null, chordGain = null;
    const queue = [];

    function padVoice(midi, t0, dur, pan, peak, dest) {
      const f = C.mtof(midi), end = t0 + dur + 7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 3.4);
      g.gain.setValueAtTime(peak, t0 + dur);
      g.gain.setTargetAtTime(0, t0 + dur, 1.7);
      g.gain.setValueAtTime(peak * 0.02, end - 0.3); g.gain.linearRampToValueAtTime(0, end - 0.05);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.55;
      const cut = (420 + 1250 * P.bright) * (midi > 66 ? 0.8 : 1);
      lp.frequency.setValueAtTime(240, t0);
      lp.frequency.exponentialRampToValueAtTime(cut, t0 + 4.5);
      lp.frequency.exponentialRampToValueAtTime(cut * 0.62, t0 + dur + 4);
      lp.connect(g); g.connect(panner(pan, dest));
      [['sawtooth', -7, 0.6], ['triangle', 6, 0.95]].forEach(([type, det, lvl]) => {
        const o = osc(type, f); o.detune.value = det + (Math.random() * 4 - 2);
        o.connect(gain(lvl, lp)); o.start(t0); o.stop(end);
      });
    }

    function bassVoice(midi, t0, dur, dest) {
      const f = C.mtof(midi), end = t0 + dur + 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.17, t0 + 4); g.gain.setValueAtTime(0.17, t0 + dur); g.gain.setTargetAtTime(0, t0 + dur, 1.5);
      g.gain.setValueAtTime(0.004, end - 0.3); g.gain.linearRampToValueAtTime(0, end - 0.05);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(g); g.connect(dest);
      const a = osc('triangle', f);
      a.connect(lp); a.start(t0); a.stop(end);
    }

    // Electric-piano glass: FM at 1:1 whose brightness fades quickly, leaving a pure tone.
    function bell(midi, t, vel, pan, dest) {
      const f = C.mtof(midi), end = t + 4.5;
      const car = osc('sine', f), m1 = osc('sine', f);
      const i1 = ctx.createGain(); i1.gain.setValueAtTime(f * 1.7 * vel, t); i1.gain.setTargetAtTime(f * 0.04, t, 0.24);
      m1.connect(i1); i1.connect(car.frequency);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.11 * vel, t + 0.005); amp.gain.setTargetAtTime(0, t + 0.005, 0.85);
      amp.gain.setValueAtTime(0.0005, end - 0.2); amp.gain.linearRampToValueAtTime(0, end - 0.05);
      car.connect(amp); amp.connect(panner(pan, dest));
      [car, m1].forEach((o) => { o.start(t); o.stop(end); });
    }

    // The touch voice: rounder glass. Fast drawing can ask for many notes, so only a handful ring at once.
    const ringing = [];
    function glass(midi, t, vel, pan) {
      while (ringing.length && ringing[0] < t) ringing.shift();
      if (ringing.length >= 8) return;
      const f = C.mtof(midi), end = t + 3.2;
      ringing.push(end); ringing.sort((a, b) => a - b);
      const car = osc('sine', f), m = osc('sine', f * 2);
      const mi = ctx.createGain(); mi.gain.setValueAtTime(f * 0.9 * vel, t); mi.gain.setTargetAtTime(0, t, 0.11);
      m.connect(mi); mi.connect(car.frequency);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.16 * vel, t + 0.008); amp.gain.setTargetAtTime(0, t + 0.008, 0.62);
      amp.gain.setValueAtTime(0.001, end - 0.2); amp.gain.linearRampToValueAtTime(0, end - 0.05);
      car.connect(amp); amp.connect(panner(pan, touchBus));
      [car, m].forEach((o) => { o.start(t); o.stop(end); });
    }

    function startChord(i, t) {
      const ch = C.chordAt(P, i);
      const v = C.voiceLead(prevVoicing, ch.pcs);
      prevVoicing = v;
      const dur = P.beat * P.chordBeats;
      const cg = gain(1, pads); chordGain = cg;
      const peak = 0.085 / Math.sqrt(v.length);
      v.forEach((m, k) => padVoice(m, t, dur, (k / Math.max(1, v.length - 1) - 0.5) * 0.7, peak, cg));
      bassVoice(ch.bass, t, dur, cg);
      const cycle = Math.floor(i / P.chords.length);
      const r = C.rng(C.hash(P.seed * 3 + i));
      const thin = 0.25 + 0.22 * Math.sin(cycle * 1.3 + P.seed % 7);
      C.motif(P, i).forEach((n) => {
        if (i === 0 && n.beat < 2) return;
        if (r() < thin && n.beat > 0) return;
        const lift = cycle % 4 === 3 && n.degree <= 4 && r() < 0.3 ? 5 : 0;
        queue.push({ t: t + (n.beat + 1) * P.beat + (r() - 0.5) * 0.03, midi: C.scaleMidi(P, n.degree + lift, 60), vel: n.vel, pan: (r() - 0.5) * 0.9 });
      });
      queue.sort((a, b) => a.t - b.t);
    }

    const E = {
      ctx,
      get running() { return running; },
      get piece() { return P; },
      start(p, t) {
        t = t == null ? now() : t;
        if (p) P = p;
        running = true; chordIdx = 0; queue.length = 0; prevVoicing = null;
        nextChord = t + 0.15;
        delay.delayTime.setValueAtTime(P.beat * 0.75, t);
        music.gain.cancelScheduledValues(t); music.gain.setValueAtTime(music.gain.value, t); music.gain.setTargetAtTime(musicLevel, t, 1.2);
        musicWet.gain.cancelScheduledValues(t); musicWet.gain.setValueAtTime(musicWet.gain.value, t); musicWet.gain.setTargetAtTime(musicLevel, t, 1.2);
        out.gain.setTargetAtTime(1, t, 0.05);
      },
      // Move to another day's piece: the current chord melts away while the new one rises.
      setPiece(p, t) {
        t = t == null ? now() : t;
        P = p;
        if (!running) return;
        if (chordGain) { chordGain.gain.setTargetAtTime(0, t, 0.9); }
        queue.length = 0; prevVoicing = null; chordIdx = 0;
        nextChord = t + 0.35;
        delay.delayTime.setTargetAtTime(P.beat * 0.75, t, 0.4);
        bell(C.scaleMidi(P, 0, 60), t + 0.05, 0.5, 0, touchBus);
      },
      scheduleUntil(T) {
        if (!running || !P) return;
        while (nextChord <= T) { startChord(chordIdx, nextChord); nextChord += P.beat * P.chordBeats; chordIdx++; }
        while (queue.length && queue[0].t <= T) {
          const e = queue.shift();
          if (e.t >= now() - 0.05) bell(e.midi, Math.max(e.t, now()), e.vel, e.pan, bells);
        }
      },
      setLevels(m, tl) {
        const t = now();
        if (m != null) { musicLevel = m; if (running) { music.gain.setTargetAtTime(m, t, 0.08); musicWet.gain.setTargetAtTime(m, t, 0.08); } }
        if (tl != null) { touchLevel = tl; touch.gain.setTargetAtTime(tl, t, 0.08); touchWet.gain.setTargetAtTime(tl, t, 0.08); }
      },
      setMuted(on) { out.gain.setTargetAtTime(on ? 0 : 1, now(), on ? 0.12 : 0.3); },
      // While a voice speaks, the music steps back and then returns slowly.
      duck(on) {
        if (!running) return;
        const t = now(), v = on ? musicLevel * 0.4 : musicLevel;
        music.gain.cancelScheduledValues(t); music.gain.setTargetAtTime(v, t, on ? 0.12 : 0.6);
        musicWet.gain.cancelScheduledValues(t); musicWet.gain.setTargetAtTime(v, t, on ? 0.12 : 0.6);
      },
      pluck(midi, pan, vel, t) { glass(midi, t == null ? now() : t, vel == null ? 0.9 : vel, pan || 0); },
      chime() {
        const t = now();
        glass(C.scaleMidi(P, 6, 60), t, 0.55, -0.15);
        glass(C.scaleMidi(P, 8, 60), t + 0.12, 0.5, 0.15);
      },
      voices: new Map(),
      voiceStart(id, midi, pan) {
        const t = now(), f = C.mtof(midi);
        const a = osc('triangle', f), b = osc('sine', f * 2.003);
        const vib = osc('sine', 4.4), vibG = gain(4); vib.connect(vibG); vibG.connect(a.detune); vibG.connect(b.detune);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.6;
        const g = gain(0); const p = panner(pan, touchBus);
        a.connect(lp); b.connect(gain(0.22, lp)); lp.connect(g); g.connect(p);
        [a, b, vib].forEach((o) => o.start(t));
        this.voices.set(id, { a, b, vib, g, p, lp });
      },
      voiceSwell(id, level) {
        const v = this.voices.get(id); if (!v) return;
        v.g.gain.setTargetAtTime(0.06 * (level == null ? 1 : level), now(), 0.22);
      },
      voiceMove(id, midi, pan) {
        const v = this.voices.get(id); if (!v) return;
        const t = now(), f = C.mtof(midi);
        v.a.frequency.setTargetAtTime(f, t, 0.045); v.b.frequency.setTargetAtTime(f * 2.003, t, 0.045);
        v.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.08);
      },
      voiceEnd(id) {
        const v = this.voices.get(id); if (!v) return;
        const t = now();
        if (v.g.gain.cancelAndHoldAtTime) v.g.gain.cancelAndHoldAtTime(t); else { v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); }
        v.g.gain.setTargetAtTime(0, t, 0.38);
        [v.a, v.b, v.vib].forEach((o) => o.stop(t + 3));
        this.voices.delete(id);
      },
      stopAll() { for (const id of [...this.voices.keys()]) this.voiceEnd(id); },
    };
    return E;
  }

  const Sound = { createEngine, makeIR, makeNoise };
  if (typeof module !== 'undefined' && module.exports) module.exports = Sound; else root.Sound = Sound;
})(typeof self !== 'undefined' ? self : this);
