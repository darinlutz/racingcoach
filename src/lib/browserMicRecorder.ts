// The Live Racing page's Hold to Talk (src/components/LiveDriverMessage.tsx): records the microphone while the button
// is held and makes the recording a 16 kHz 16-bit mono WAV, the same as the collector's Driver Radio recordings, so
// the server turns it into text the same way and the collector plays it with no codec (Windows' SoundPlayer only
// plays PCM WAVs). Browsers record in their own format (WebM/Opus, or MP4 in Safari), which the page decodes and
// resamples itself. Browser only.

const SAMPLE_RATE = 16_000;
// As the collector's: longer is cut off, and shorter is a slip of the thumb
export const MAX_TALK_MS = 30_000;
export const MIN_TALK_MS = 400;

export class MicBlockedError extends Error {}

export class BrowserMicRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  static supported(): boolean {
    return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  // Opens the microphone (the browser asks the first time) and starts recording; MicBlockedError when it's refused
  async start(): Promise<void> {
    this.cancel();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      throw error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
        ? new MicBlockedError(error.message)
        : error;
    }
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.startedAt = performance.now();
  }

  // Stops recording and closes the microphone: the recording as a WAV, or null when it was too short
  async stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      this.release();
      return null;
    }
    const heldMs = performance.now() - this.startedAt;
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.stop();
    await stopped;
    const type = recorder.mimeType;
    this.release();
    if (heldMs < MIN_TALK_MS || this.chunks.length === 0) return null;
    return toWav(new Blob(this.chunks, { type }));
  }

  // Throws the recording away
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}

// The browser's recording decoded, mixed to mono, resampled to 16 kHz and written as a PCM WAV
async function toWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await recording.arrayBuffer());
  } finally {
    void context.close();
  }
  const seconds = Math.min(decoded.duration, MAX_TALK_MS / 1000);
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * SAMPLE_RATE)), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
