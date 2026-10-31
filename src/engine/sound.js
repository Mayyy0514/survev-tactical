class TacticalSoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastImpactAt = 0;
  }

  init() {
    if (this.ctx || typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      this.ctx = new AudioCtx();
    }
  }

  ensureContext() {
    if (this.muted) return false;
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return Boolean(this.ctx);
  }

  playShot(category = 'ar') {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const presets = {
        pistol: { freq: 340, endFreq: 85, dur: 0.08, vol: 0.12, type: 'triangle' },
        smg: { freq: 390, endFreq: 95, dur: 0.065, vol: 0.1, type: 'sawtooth' },
        shotgun: { freq: 165, endFreq: 42, dur: 0.17, vol: 0.2, type: 'sawtooth' },
        ar: { freq: 270, endFreq: 68, dur: 0.1, vol: 0.14, type: 'sawtooth' },
        lmg: { freq: 230, endFreq: 58, dur: 0.11, vol: 0.15, type: 'sawtooth' },
        sniper: { freq: 145, endFreq: 32, dur: 0.26, vol: 0.24, type: 'sawtooth' },
      };
      const p = presets[category] || presets.ar;

      osc.type = p.type;
      osc.frequency.setValueAtTime(p.freq, now);
      osc.frequency.exponentialRampToValueAtTime(p.endFreq, now + p.dur);

      gain.gain.setValueAtTime(p.vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + p.dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + p.dur);
    } catch {
      // Ignore audio errors
    }
  }

  playImpact(material = 'concrete') {
    if (!this.ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastImpactAt < 32) return;
    this.lastImpactAt = nowMs;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      if (material === 'metal') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(920, now);
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.055);
        gain.gain.setValueAtTime(0.08, now);
      } else {
        osc.type = 'square';
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(75, now + 0.045);
        gain.gain.setValueAtTime(0.07, now);
      }
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.058);
    } catch {}
  }

  playExplosion() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const bufferSize = this.ctx.sampleRate * 0.45;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.12));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(340, now);
      filter.frequency.exponentialRampToValueAtTime(55, now + 0.45);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(now);
    } catch {}
  }

  playPickup() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {}
  }

  playWaveAlert() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.linearRampToValueAtTime(360, now + 0.35);
      osc.frequency.linearRampToValueAtTime(160, now + 0.7);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.75);
    } catch {}
  }
}

export const soundEngine = new TacticalSoundEngine();
