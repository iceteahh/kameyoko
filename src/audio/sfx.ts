import { clamp } from '../math';
import type { PlayerId } from '../types';

interface Channel {
  hum: GainNode;
  humFilter: BiquadFilterNode;
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  crackle: GainNode;
  roar: GainNode;
  roarFilter: BiquadFilterNode;
  sub: GainNode;
}

const VOICE_TEXT: Record<string, string> = { KA: 'kah', ME: 'meh', HA: 'hah', FIRE: 'haaaaaaa!' };

/** Fully synthesized sound effects (no audio assets needed). */
export class Sfx {
  muted = false;
  voice = true;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private channels: Channel[] = [];
  private clash!: GainNode;

  init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    for (const pan of [-0.5, 0.5]) this.channels.push(this.makeChannel(pan));

    const clashNoise = this.loopNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    this.clash = ctx.createGain();
    this.clash.gain.value = 0;
    const trem = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.35;
    lfo.connect(lfoGain).connect(trem.gain);
    lfo.start();
    clashNoise.connect(lp).connect(trem).connect(this.clash).connect(this.master);
  }

  private loopNoise() {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  private makeChannel(pan: number): Channel {
    const ctx = this.ctx!;
    const out = ctx.createStereoPanner();
    out.pan.value = pan;
    out.connect(this.master);

    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    const hum = ctx.createGain();
    hum.gain.value = 0;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'sawtooth';
    oscB.detune.value = 700;
    oscA.connect(humFilter);
    oscB.connect(humFilter);
    humFilter.connect(hum).connect(out);
    oscA.start();
    oscB.start();

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3500;
    bp.Q.value = 0.8;
    const crackle = ctx.createGain();
    crackle.gain.value = 0;
    this.loopNoise().connect(bp).connect(crackle).connect(out);

    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = 'lowpass';
    const roar = ctx.createGain();
    roar.gain.value = 0;
    this.loopNoise().connect(roarFilter).connect(roar).connect(out);
    const subOsc = ctx.createOscillator();
    subOsc.frequency.value = 48;
    const sub = ctx.createGain();
    sub.gain.value = 0;
    subOsc.connect(sub).connect(out);
    subOsc.start();

    return { hum, humFilter, oscA, oscB, crackle, roar, roarFilter, sub };
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
    if (m) speechSynthesis?.cancel();
  }

  /** Continuous per-player sound, called every frame. */
  setPlayer(i: PlayerId, s: { charging: boolean; charge: number; firing: boolean; power: number }) {
    const ctx = this.ctx;
    const ch = this.channels[i];
    if (!ctx || !ch) return;
    const now = ctx.currentTime;
    const q = clamp(s.charge, 0, 1);
    ch.oscA.frequency.setTargetAtTime(70 + 170 * q, now, 0.05);
    ch.oscB.frequency.setTargetAtTime(70 + 170 * q, now, 0.05);
    ch.humFilter.frequency.setTargetAtTime(250 + 2600 * q, now, 0.05);
    ch.hum.gain.setTargetAtTime(s.charging ? 0.03 + 0.08 * q : 0, now, 0.08);
    ch.crackle.gain.setTargetAtTime(s.charging ? 0.05 * q * q : s.firing ? 0.04 : 0, now, 0.05);
    ch.roarFilter.frequency.setTargetAtTime(700 + 1400 * s.power, now, 0.1);
    ch.roar.gain.setTargetAtTime(s.firing ? 0.22 + 0.12 * s.power : 0, now, 0.08);
    ch.sub.gain.setTargetAtTime(s.firing ? 0.3 : 0, now, 0.1);
  }

  setClash(intensity: number) {
    if (!this.ctx) return;
    this.clash.gain.setTargetAtTime(intensity * 0.5, this.ctx.currentTime, 0.1);
  }

  private oneShot(o: { dur: number; gain: number; f0: number; f1: number; type: BiquadFilterType; tone?: [number, number] }) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.f0, now);
    f.frequency.exponentialRampToValueAtTime(o.f1, now + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + o.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + o.dur + 0.05);
    if (o.tone) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(o.tone[0], now);
      osc.frequency.exponentialRampToValueAtTime(o.tone[1], now + o.dur);
      const og = ctx.createGain();
      og.gain.setValueAtTime(o.gain * 0.8, now);
      og.gain.exponentialRampToValueAtTime(0.001, now + o.dur);
      osc.connect(og).connect(this.master);
      osc.start(now);
      osc.stop(now + o.dur + 0.05);
    }
  }

  fire() {
    this.oneShot({ dur: 0.7, gain: 0.7, f0: 400, f1: 3000, type: 'bandpass', tone: [110, 40] });
  }

  clashStart() {
    this.oneShot({ dur: 1.0, gain: 0.9, f0: 2500, f1: 200, type: 'lowpass', tone: [90, 30] });
  }

  explosion() {
    this.oneShot({ dur: 2.0, gain: 1.0, f0: 4000, f1: 60, type: 'lowpass', tone: [120, 25] });
  }

  callout(key: 'KA' | 'ME' | 'HA' | 'FIRE') {
    if (this.muted || !this.voice || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(VOICE_TEXT[key]);
    u.rate = key === 'FIRE' ? 0.9 : 1.3;
    u.pitch = 0.8;
    u.volume = 1;
    speechSynthesis.speak(u);
  }
}
