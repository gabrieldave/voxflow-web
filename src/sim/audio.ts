/**
 * Input meter for the simulator.
 *  - "take": a pre-recorded demo voice decoded with Web Audio and analysed silently
 *    (VoxFlow mutes your Mac while you dictate, so the demo stays quiet too).
 *  - "mic": the visitor's microphone, opt-in. Only levels are read; nothing is stored.
 * Level normalisation mirrors AudioAndSpeechEngine: (dBFS + 50) / 50, clamped 0…1.
 */
export type Source = "take" | "mic";

export class InputMeter {
  private ctx?: AudioContext;
  private analyser?: AnalyserNode;
  private sink?: GainNode;
  private buf = new Float32Array(1024);
  private node?: AudioBufferSourceNode | MediaStreamAudioSourceNode;
  private stream?: MediaStream;
  private decoded = new Map<string, AudioBuffer>();
  peak = 0;

  private ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.2;
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0; // silent: analysis only
      this.analyser.connect(this.sink).connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  async preload(urls: string[]) {
    const ctx = this.ensure();
    await Promise.all(
      urls.map(async (u) => {
        if (this.decoded.has(u)) return;
        try {
          const res = await fetch(u);
          const ab = await res.arrayBuffer();
          this.decoded.set(u, await ctx.decodeAudioData(ab));
        } catch {
          /* ignore: the meter falls back to a flat line */
        }
      })
    );
  }

  async startTake(url: string) {
    const ctx = this.ensure();
    this.stopNode();
    this.peak = 0;
    let buffer = this.decoded.get(url);
    if (!buffer) {
      await this.preload([url]);
      buffer = this.decoded.get(url);
    }
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.analyser!);
    src.start();
    this.node = src;
  }

  /** Opens the mic once and keeps it while the visitor stays in mic mode. */
  async openMic(): Promise<boolean> {
    if (this.stream) return true;
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      return true;
    } catch {
      return false;
    }
  }

  startMic() {
    const ctx = this.ensure();
    this.stopNode();
    this.peak = 0;
    if (!this.stream) return;
    const src = ctx.createMediaStreamSource(this.stream);
    src.connect(this.analyser!);
    this.node = src;
  }

  closeMic() {
    this.stopNode();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }

  stop() {
    this.stopNode();
  }

  private stopNode() {
    if (!this.node) return;
    try {
      if (this.node instanceof AudioBufferSourceNode) this.node.stop();
      this.node.disconnect();
    } catch {
      /* already stopped */
    }
    this.node = undefined;
  }

  /** 0…1, same mapping as AVAudioRecorder averagePower in the app. */
  level(): number {
    if (!this.analyser || !this.node) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    let pk = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const s = this.buf[i];
      sum += s * s;
      const a = Math.abs(s);
      if (a > pk) pk = a;
    }
    if (pk > this.peak) this.peak = pk;
    const rms = Math.sqrt(sum / this.buf.length);
    const db = 20 * Math.log10(rms + 1e-9);
    return Math.max(0, Math.min(1, (db + 50) / 50));
  }
}
