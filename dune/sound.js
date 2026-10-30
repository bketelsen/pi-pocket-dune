// The sound of Arrakis, made with Web Audio and no sound files: a low drone and the wind, with a thump for each step
// toward a place, a drop of water for work that held, ornithopter wings, and the rumble of a passing worm. It is off
// until a person turns it on.

export class Sound {
    constructor() {
        this.ctx = null;
        this.on = false;
        this.last = Object.create(null);
    }

    enable() {
        if (!this.ctx) {
            const Context = window.AudioContext ?? window.webkitAudioContext;

            if (!Context) {
                return false;
            }

            this.ctx = new Context();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.0001;
            this.master.connect(this.ctx.destination);
            this.ambience();
        }

        this.ctx.resume();
        this.master.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.6);
        this.on = true;

        return true;
    }

    disable() {
        if (this.ctx) {
            this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.3);
        }

        this.on = false;
    }

    toggle() {
        return this.on ? (this.disable(), false) : this.enable();
    }

    dispose() {
        this.ctx?.close();
        this.ctx = null;
    }

    noiseBuffer(seconds = 2) {
        const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let index = 0; index < data.length; index++) {
            data[index] = Math.random() * 2 - 1;
        }

        return buffer;
    }

    /** The drone of the deep desert, and its wind. */
    ambience() {
        const ctx = this.ctx;
        const drone = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        drone.gain.value = 0.12;
        filter.type = "lowpass";
        filter.frequency.value = 260;
        filter.Q.value = 6;
        filter.connect(drone);
        drone.connect(this.master);

        // A low fifth, slightly detuned, breathing through a slow filter.
        for (const [freq, detune] of [
            [55, -6],
            [55, 7],
            [82.4, 3],
            [41.2, 0],
        ]) {
            const osc = ctx.createOscillator();

            osc.type = "sawtooth";
            osc.frequency.value = freq;
            osc.detune.value = detune;
            osc.connect(filter);
            osc.start();
        }

        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();

        lfo.frequency.value = 0.05;
        depth.gain.value = 140;
        lfo.connect(depth);
        depth.connect(filter.frequency);
        lfo.start();

        // The wind: noise through a moving band.
        const wind = ctx.createBufferSource();
        const band = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        const gust = ctx.createOscillator();
        const gustDepth = ctx.createGain();

        wind.buffer = this.noiseBuffer(4);
        wind.loop = true;
        band.type = "bandpass";
        band.frequency.value = 500;
        band.Q.value = 0.8;
        gain.gain.value = 0.05;
        gust.frequency.value = 0.11;
        gustDepth.gain.value = 300;
        gust.connect(gustDepth);
        gustDepth.connect(band.frequency);
        wind.connect(band);
        band.connect(gain);
        gain.connect(this.master);
        wind.start();
        gust.start();
        this.wind = gain;
    }

    /** One effect, at most so often for each kind. */
    play(kind) {
        if (!this.on || !this.ctx) {
            return;
        }

        const now = this.ctx.currentTime;
        const gap =
            {
                step: 0.12,
                ok: 0.08,
                fail: 0.2,
                spice: 0.3,
                thopter: 0.4,
                worm: 2,
                heighliner: 2,
                built: 0.5,
                storm: 1,
                calm: 1,
            }[kind] ?? 0.1;

        if (now - (this.last[kind] ?? -9) < gap) {
            return;
        }

        this.last[kind] = now;

        switch (kind) {
            case "step":
                this.thump(70, 0.18, 0.12);
                break;
            case "ok":
                this.drop();
                break;
            case "fail":
                this.tone(110, 0.25, "square", 0.06, 0.35, 104);
                break;
            case "spice":
                this.tone(880 + Math.random() * 300, 0.03, "sine", 0.04, 0.4);
                break;
            case "thopter":
                this.flutter();
                break;
            case "worm":
                this.rumble(4, 0.4);
                break;
            case "heighliner":
                this.swell();
                break;
            case "built":
                [261.6, 329.6, 392].forEach((freq, index) =>
                    this.tone(freq, 0.06, "triangle", 0.05 + index * 0.08, 0.8),
                );
                break;
            case "storm":
                this.wind?.gain.setTargetAtTime(0.22, now, 1.5);
                this.rumble(3, 0.2);
                break;
            case "calm":
                this.wind?.gain.setTargetAtTime(0.05, now, 2);
                break;
            default:
                break;
        }
    }

    tone(freq, gain, type, delay, length, glideTo) {
        const ctx = this.ctx;
        const at = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, at);
        glideTo && osc.frequency.exponentialRampToValueAtTime(glideTo, at + length);
        amp.gain.setValueAtTime(0.0001, at);
        amp.gain.exponentialRampToValueAtTime(gain, at + 0.01);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
        osc.connect(amp);
        amp.connect(this.master);
        osc.start(at);
        osc.stop(at + length + 0.05);
    }

    thump(freq, gain, length) {
        const ctx = this.ctx;
        const at = ctx.currentTime;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();

        osc.frequency.setValueAtTime(freq * 2, at);
        osc.frequency.exponentialRampToValueAtTime(freq, at + length);
        amp.gain.setValueAtTime(gain, at);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
        osc.connect(amp);
        amp.connect(this.master);
        osc.start(at);
        osc.stop(at + length + 0.02);
    }

    /** A drop of water: a bright pluck that falls. */
    drop() {
        const freq = 1200 + Math.random() * 500;

        this.tone(freq, 0.06, "sine", 0, 0.18, freq * 0.55);
    }

    flutter() {
        const ctx = this.ctx;
        const at = ctx.currentTime;
        const source = ctx.createBufferSource();
        const band = ctx.createBiquadFilter();
        const amp = ctx.createGain();
        const beat = ctx.createOscillator();
        const beatDepth = ctx.createGain();

        source.buffer = this.noiseBuffer(1);
        band.type = "bandpass";
        band.frequency.value = 900;
        amp.gain.value = 0;
        beat.frequency.value = 28;
        beatDepth.gain.value = 0.05;
        beat.connect(beatDepth);
        beatDepth.connect(amp.gain);
        source.connect(band);
        band.connect(amp);
        amp.connect(this.master);
        source.start(at);
        beat.start(at);
        source.stop(at + 0.7);
        beat.stop(at + 0.7);
    }

    rumble(seconds, gain) {
        const ctx = this.ctx;
        const at = ctx.currentTime;
        const source = ctx.createBufferSource();
        const low = ctx.createBiquadFilter();
        const amp = ctx.createGain();

        source.buffer = this.noiseBuffer(seconds);
        low.type = "lowpass";
        low.frequency.setValueAtTime(60, at);
        low.frequency.linearRampToValueAtTime(140, at + seconds / 2);
        low.frequency.linearRampToValueAtTime(50, at + seconds);
        amp.gain.setValueAtTime(0.0001, at);
        amp.gain.exponentialRampToValueAtTime(gain, at + seconds / 3);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
        source.connect(low);
        low.connect(amp);
        amp.connect(this.master);
        source.start(at);
    }

    /** A heighliner leaves: a great chord swells, then space folds. */
    swell() {
        [65.4, 98, 130.8, 196].forEach((freq) => this.tone(freq, 0.05, "sawtooth", 0, 3.2));
        this.tone(1568, 0.04, "sine", 2.9, 0.6, 3136);
    }
}
