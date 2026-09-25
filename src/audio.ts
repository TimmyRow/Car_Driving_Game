export class RaceAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private engine?: OscillatorNode;
  private harmonic?: OscillatorNode;
  private engineGain?: GainNode;
  private hiss?: GainNode;
  private boost?: GainNode;
  private filter?: BiquadFilterNode;
  muted = false;
  async unlock() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext());
      const master = (this.master = ctx.createGain());
      master.gain.value = 0.35;
      master.connect(ctx.destination);
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
      active ? 0.038 + speed * 0.00055 : 0,
      now,
      0.12,
    );
    this.filter?.frequency.setTargetAtTime(450 + speed * 14, now, 0.12);
    this.hiss?.gain.setTargetAtTime(
      active ? (drift ? 0.2 : speed * 0.0002) : 0,
      now,
      0.09,
    );
    this.boost?.gain.setTargetAtTime(active && nitro ? 0.42 : 0, now, 0.15);
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
  }
  impact() {
    this.tone(65, 0.18, 0.24);
  }
  crash(hard: boolean) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx,
      duration = hard ? 0.48 : 0.15,
      now = ctx.currentTime;
    const buffer = ctx.createBuffer(
      1,
      Math.ceil(ctx.sampleRate * duration),
      ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = last * 0.67 + (Math.random() * 2 - 1) * 0.33;
      data[i] = last * (1 - i / data.length);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(hard ? 0.85 : 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(gain);
    gain.connect(this.master);
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    this.tone(hard ? 48 : 90, hard ? 0.3 : 0.12, hard ? 0.22 : 0.1);
  }
}
