export class RaceAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private engine?: OscillatorNode;
  private harmonic?: OscillatorNode;
  private engineGain?: GainNode;
  private hiss?: GainNode;
  private boost?: GainNode;
  private filter?: BiquadFilterNode;
  private heavyCrash?: AudioBuffer;
  private lightCrash?: AudioBuffer;
  private lastCrash = -Infinity;
  private duckUntil = 0;
  muted = false;
  async unlock() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext());
      const master = (this.master = ctx.createGain());
      master.gain.value = this.muted ? 0 : 0.35;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -9;
      limiter.knee.value = 5;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.2;
      master.connect(limiter);
      limiter.connect(ctx.destination);
      this.heavyCrash = this.makeCrashBuffer(ctx, true);
      this.lightCrash = this.makeCrashBuffer(ctx, false);
      const filter = (this.filter = ctx.createBiquadFilter());
      filter.type = "lowpass";
      filter.frequency.value = 650;
      filter.Q.value = 1.2;
      filter.connect(master);
      const gain = (this.engineGain = ctx.createGain());
      gain.gain.value = 0;
      gain.connect(filter);
      const engine = (this.engine = ctx.createOscillator());
      engine.type = "sawtooth";
      engine.frequency.value = 45;
      engine.connect(gain);
      engine.start();
      const harmonic = (this.harmonic = ctx.createOscillator());
      harmonic.type = "triangle";
      harmonic.frequency.value = 90;
      harmonic.connect(gain);
      harmonic.start();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + Math.random() * 0.16 - 0.08) / 1.02;
        data[i] = last * 3;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const hiss = (this.hiss = ctx.createGain());
      hiss.gain.value = 0;
      source.connect(hiss);
      hiss.connect(master);
      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 900;
      const boost = (this.boost = ctx.createGain());
      boost.gain.value = 0;
      source.connect(high);
      high.connect(boost);
      boost.connect(master);
      source.start();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }
  setMuted(value: boolean) {
    this.muted = value;
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(
        value ? 0 : 0.35,
        this.ctx.currentTime,
        0.08,
      );
  }
  update(speed: number, drift: boolean, nitro: boolean, active: boolean) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const gear = Math.min(5, Math.floor(speed / 17)),
      rpm = 46 + speed * 3.0 - gear * 29;
    this.engine?.frequency.setTargetAtTime(rpm, now, 0.11);
    this.harmonic?.frequency.setTargetAtTime(rpm * 2.01, now, 0.11);
    this.engineGain?.gain.setTargetAtTime(
      active
        ? (0.038 + speed * 0.00055) * (now < this.duckUntil ? 0.32 : 1)
        : 0,
      now,
      0.12,
    );
    this.filter?.frequency.setTargetAtTime(450 + speed * 14, now, 0.12);
    this.hiss?.gain.setTargetAtTime(
      active ? (drift ? 0.2 : speed * 0.0002) : 0,
      now,
      0.09,
    );
    this.boost?.gain.setTargetAtTime(
      active && nitro ? (now < this.duckUntil ? 0.12 : 0.42) : 0,
      now,
      0.15,
    );
  }
  tone(frequency: number, duration = 0.12, volume = 0.1) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const tone = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    tone.type = "sine";
    tone.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    tone.connect(gain);
    gain.connect(this.master);
    tone.start();
    tone.stop(now + duration);
    tone.onended = () => {
      tone.disconnect();
      gain.disconnect();
    };
  }
  impact() {
    this.tone(65, 0.18, 0.24);
  }
  crash(hard: boolean) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx,
      now = ctx.currentTime;
    if (now - this.lastCrash < (hard ? 0.065 : 0.11)) return;
    this.lastCrash = now;
    if (hard) this.duckUntil = now + 0.4;
    const source = ctx.createBufferSource();
    source.buffer = hard ? this.heavyCrash! : this.lightCrash!;
    const duration = source.buffer.duration;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(hard ? 0.76 : 0.31, now);
    source.connect(gain);
    gain.connect(this.master);
    source.start();
    source.stop(now + duration);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    this.impactDrop(
      hard ? 142 : 108,
      hard ? 31 : 48,
      hard ? 0.65 : 0.18,
      hard ? 0.7 : 0.22,
      0,
    );
    if (hard) {
      this.impactDrop(63, 27, 0.62, 0.29, 0.13);
      this.impactDrop(49, 30, 0.38, 0.12, 0.34);
    }
  }

  /** Cached original crunch: a sharp contact, tearing metal, then smaller aftershocks. */
  private makeCrashBuffer(ctx: AudioContext, hard: boolean) {
    const duration = hard ? 1.18 : 0.25;
    const buffer = ctx.createBuffer(
      1,
      Math.ceil(ctx.sampleRate * duration),
      ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate,
        white = Math.random() * 2 - 1;
      low = low * 0.78 + white * 0.22;
      const initial = Math.exp(-t / (hard ? 0.08 : 0.037));
      const tear = hard
        ? Math.exp(-t / 0.33) *
          (0.2 +
            0.8 * Math.pow(Math.abs(Math.sin(t * 61) * Math.sin(t * 97)), 0.7))
        : 0;
      const after = hard
        ? 0.38 * Math.exp(-(((t - 0.14) / 0.052) ** 2)) +
          0.21 * Math.exp(-(((t - 0.33) / 0.079) ** 2))
        : 0;
      const metal = hard
        ? (Math.sin(t * 2 * Math.PI * 317) * 0.17 +
            Math.sin(t * 2 * Math.PI * 523) * 0.09 +
            Math.sin(t * 2 * Math.PI * 859) * 0.045) *
          Math.exp(-t / 0.2)
        : 0;
      const body = low * (initial * 2.8 + after * 2.0);
      const scrape = (white - low) * (initial * 0.34 + tear * 0.43);
      const tail = Math.min(1, (duration - t) / 0.07);
      data[i] = Math.tanh((body + scrape + metal) * 1.12) * 0.84 * tail;
    }
    return buffer;
  }

  private impactDrop(
    from: number,
    to: number,
    duration: number,
    volume: number,
    delay: number,
  ) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx,
      now = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      to,
      now + duration * 0.55,
    );
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
