type Mode = 'title' | 'playing' | 'paused' | 'replay' | 'score'

export class AudioEngine {
  muted = false
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private musicFilter: BiquadFilterNode | null = null
  private engineGain: GainNode | null = null
  private windGain: GainNode | null = null
  private rainGain: GainNode | null = null
  private sirenGain: GainNode | null = null
  private engA: OscillatorNode | null = null
  private engB: OscillatorNode | null = null
  private sirenA: OscillatorNode | null = null
  private sirenB: OscillatorNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private nextTime = 0
  private step = 0
  private started = false
  private readonly bpm = 104

  constructor(muted: boolean) {
    this.muted = muted
  }

  unlock(): void {
    const ctx = this.ensure()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    this.applyMute()
    return this.muted
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyMute()
  }

  update(speed: number, mode: Mode, tunnel: boolean, rain: boolean, police: boolean, ludi: boolean, gas: boolean): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.engineGain || !this.engA || !this.engB || !this.musicFilter || !this.windGain || !this.rainGain || !this.sirenGain || !this.sirenA || !this.sirenB || !this.musicGain) return
    const t = ctx.currentTime
    const moving = mode === 'playing' || mode === 'title'
    const f = 38 + speed * 0.9 + (gas ? 12 : 0) + (ludi ? 20 : 0)
    this.engA.frequency.setTargetAtTime(f, t, 0.05)
    this.engB.frequency.setTargetAtTime(f * 0.5, t, 0.08)
    const eg = moving ? 0.018 + Math.min(0.07, speed * 0.00075) : mode === 'replay' ? 0.01 : 0
    this.engineGain.gain.setTargetAtTime(eg, t, 0.06)
    const cutoff = tunnel ? 280 : 700 + speed * 16 + (ludi ? 1600 : 0)
    this.musicFilter.frequency.setTargetAtTime(cutoff, t, 0.15)
    const music = mode === 'paused' ? 0.05 : mode === 'replay' || mode === 'score' ? 0.045 : 0.11
    this.musicGain.gain.setTargetAtTime(music, t, 0.1)
    this.windGain.gain.setTargetAtTime(moving ? Math.min(0.05, Math.max(0, speed - 18) * 0.0006) : 0, t, 0.1)
    this.rainGain.gain.setTargetAtTime(rain && moving ? 0.11 : 0, t, 0.2)
    this.sirenGain.gain.setTargetAtTime(police && mode === 'playing' ? 0.04 : 0, t, 0.08)
    this.sirenA.frequency.setTargetAtTime(640 + Math.sin(t * 9) * 80, t, 0.04)
    this.sirenB.frequency.setTargetAtTime(490 + Math.sin(t * 9 + Math.PI) * 60, t, 0.04)
    this.schedule(t)
  }

  jump(): void {
    this.blip(520, 740, 0.16, 'triangle', 0.16)
    this.noiseHit(0.12, 0.14, 900, 'bandpass')
  }

  land(hard: boolean): void {
    this.toneDrop(hard ? 160 : 110, 40, hard ? 0.28 : 0.16, hard ? 0.22 : 0.1)
    this.noiseHit(hard ? 0.22 : 0.12, hard ? 0.2 : 0.1, 180, 'lowpass')
  }

  whoosh(): void {
    this.noiseSweep(0.22, 0.12, 400, 2200)
  }

  coin(): void {
    this.blip(880, 1320, 0.08, 'sine', 0.07)
  }

  pickup(): void {
    this.blip(660, 990, 0.1, 'triangle', 0.1)
    this.blip(990, 1480, 0.14, 'sine', 0.06)
  }

  shield(): void {
    this.blip(420, 880, 0.22, 'sine', 0.1)
  }

  roll(): void {
    this.noiseSweep(0.28, 0.1, 300, 1600)
  }

  crash(): void {
    this.toneDrop(220, 35, 0.7, 0.25)
    this.noiseHit(0.55, 0.35, 240, 'lowpass')
  }

  rocket(): void {
    this.toneDrop(70, 32, 1.4, 0.18)
    this.noiseHit(1.1, 0.16, 160, 'lowpass')
  }

  thunder(): void {
    this.noiseHit(0.7, 0.22, 140, 'lowpass')
  }

  ludicrous(): void {
    const ctx = this.ensure()
    if (!ctx || !this.sfxGain) return
    const notes = [440, 554, 659, 880]
    const t0 = ctx.currentTime
    for (let i = 0; i < notes.length; i++) this.toneAt(t0 + i * 0.06, notes[i]!, 0.18, 'sawtooth', 0.05, 2400, this.sfxGain)
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const ctx = new Ctor()
    this.ctx = ctx
    this.build(ctx)
    return ctx
  }

  private build(ctx: AudioContext): void {
    const master = ctx.createGain()
    master.gain.value = this.muted ? 0 : 0.9
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.knee.value = 8
    comp.ratio.value = 3.5
    comp.attack.value = 0.004
    comp.release.value = 0.18
    master.connect(comp)
    comp.connect(ctx.destination)
    this.master = master

    const musicFilter = ctx.createBiquadFilter()
    musicFilter.type = 'lowpass'
    musicFilter.frequency.value = 1800
    const musicGain = ctx.createGain()
    musicGain.gain.value = 0.11
    musicFilter.connect(musicGain)
    musicGain.connect(master)
    this.musicFilter = musicFilter
    this.musicGain = musicGain

    const sfxGain = ctx.createGain()
    sfxGain.gain.value = 0.8
    sfxGain.connect(master)
    this.sfxGain = sfxGain

    const len = ctx.sampleRate * 2
    const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuf = noiseBuf

    const engineGain = ctx.createGain()
    engineGain.gain.value = 0
    const eFilter = ctx.createBiquadFilter()
    eFilter.type = 'lowpass'
    eFilter.frequency.value = 420
    const engA = ctx.createOscillator()
    engA.type = 'sawtooth'
    engA.frequency.value = 60
    const engB = ctx.createOscillator()
    engB.type = 'square'
    engB.frequency.value = 30
    const gB = ctx.createGain()
    gB.gain.value = 0.45
    engA.connect(eFilter)
    engB.connect(gB)
    gB.connect(eFilter)
    eFilter.connect(engineGain)
    engineGain.connect(master)
    engA.start()
    engB.start()
    this.engineGain = engineGain
    this.engA = engA
    this.engB = engB

    const windGain = ctx.createGain()
    windGain.gain.value = 0
    const wind = ctx.createBufferSource()
    wind.buffer = noiseBuf
    wind.loop = true
    const windF = ctx.createBiquadFilter()
    windF.type = 'highpass'
    windF.frequency.value = 700
    wind.connect(windF)
    windF.connect(windGain)
    windGain.connect(master)
    wind.start()
    this.windGain = windGain

    const rainGain = ctx.createGain()
    rainGain.gain.value = 0
    const rain = ctx.createBufferSource()
    rain.buffer = noiseBuf
    rain.loop = true
    const rainF = ctx.createBiquadFilter()
    rainF.type = 'bandpass'
    rainF.frequency.value = 1400
    rainF.Q.value = 0.6
    rain.connect(rainF)
    rainF.connect(rainGain)
    rainGain.connect(master)
    rain.start()
    this.rainGain = rainGain

    const sirenGain = ctx.createGain()
    sirenGain.gain.value = 0
    const sirenA = ctx.createOscillator()
    sirenA.type = 'sawtooth'
    const sirenB = ctx.createOscillator()
    sirenB.type = 'square'
    const sg = ctx.createGain()
    sg.gain.value = 0.4
    sirenA.connect(sirenGain)
    sirenB.connect(sg)
    sg.connect(sirenGain)
    sirenGain.connect(master)
    sirenA.start()
    sirenB.start()
    this.sirenGain = sirenGain
    this.sirenA = sirenA
    this.sirenB = sirenB
    this.started = false
  }

  private applyMute(): void {
    if (!this.master || !this.ctx) return
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.03)
  }

  private schedule(now: number): void {
    if (!this.started) {
      this.nextTime = now + 0.05
      this.started = true
    }
    if (this.nextTime < now - 0.2) this.nextTime = now
    const sp = 60 / this.bpm / 4
    let guard = 0
    while (this.nextTime < now + 0.12 && guard++ < 8) {
      this.playStep(this.step % 64, this.nextTime)
      this.step++
      this.nextTime += sp
    }
  }

  private playStep(step: number, time: number): void {
    if (!this.musicFilter) return
    const chord = Math.floor(step / 16) % 4
    const roots = [55, 43.65, 65.41, 49]
    const chords = [
      [220, 261.63, 329.63],
      [174.61, 220, 261.63],
      [261.63, 329.63, 392],
      [196, 246.94, 293.66],
    ]
    const dest = this.musicFilter
    if (step % 4 === 0) {
      this.toneAt(time, 140, 0.09, 'sine', 0.16, 200, dest)
      this.noiseAt(time, 0.06, 0.18, 160, 'lowpass', dest)
    }
    if (step % 8 === 4) this.noiseAt(time, 0.08, 0.1, 1800, 'bandpass', dest)
    if (step % 2 === 0) this.noiseAt(time, 0.03, step % 4 === 2 ? 0.035 : 0.02, 7000, 'highpass', dest)
    const bassHits = [0, 3, 7, 10, 12]
    if (bassHits.includes(step % 16)) this.toneAt(time, roots[chord]!, 0.18, 'sawtooth', 0.07, 240, dest)
    const arpPat = [0, 1, 2, 1, 2, 0, 1, 2]
    const tone = chords[chord]![arpPat[step % 8]!]!
    this.toneAt(time, tone * 2, 0.12, 'square', 0.028, 2200, dest)
    if (step % 2 === 0) {
      const lead = [0, 2, 4, 2, 3, 2, 4, 7, 4, 3, 2, 0, 2, 4, -1, 0]
      const deg = lead[(Math.floor(step / 2)) % 16]!
      if (deg >= 0) {
        const pent = [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66]
        this.toneAt(time, pent[deg] ?? 440, 0.18, 'triangle', 0.03, 2800, dest)
      }
    }
  }

  private blip(from: number, to: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ensure()
    if (!ctx || !this.sfxGain) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(from, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g)
    g.connect(this.sfxGain)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private toneDrop(from: number, to: number, dur: number, gain: number): void {
    this.blip(from, to, dur, 'sawtooth', gain)
  }

  private toneAt(time: number, freq: number, dur: number, type: OscillatorType, gain: number, filterFreq: number, dest: AudioNode): void {
    const ctx = this.ctx
    if (!ctx) return
    const o = ctx.createOscillator()
    const f = ctx.createBiquadFilter()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(Math.max(30, freq), time)
    f.type = 'lowpass'
    f.frequency.setValueAtTime(filterFreq, time)
    g.gain.setValueAtTime(0.0001, time)
    g.gain.exponentialRampToValueAtTime(gain, time + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    o.connect(f)
    f.connect(g)
    g.connect(dest)
    o.start(time)
    o.stop(time + dur + 0.03)
  }

  private noiseHit(dur: number, gain: number, freq: number, type: BiquadFilterType): void {
    const ctx = this.ensure()
    if (!ctx || !this.sfxGain) return
    this.noiseAt(ctx.currentTime, dur, gain, freq, type, this.sfxGain)
  }

  private noiseSweep(dur: number, gain: number, from: number, to: number): void {
    const ctx = this.ensure()
    if (!ctx || !this.sfxGain || !this.noiseBuf) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 0.8
    f.frequency.setValueAtTime(from, t)
    f.frequency.exponentialRampToValueAtTime(to, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f)
    f.connect(g)
    g.connect(this.sfxGain)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  private noiseAt(time: number, dur: number, gain: number, freq: number, type: BiquadFilterType, dest: AudioNode): void {
    const ctx = this.ctx
    if (!ctx || !this.noiseBuf) return
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, time)
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, time)
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    src.connect(f)
    f.connect(g)
    g.connect(dest)
    src.start(time)
    src.stop(time + dur + 0.02)
  }
}
