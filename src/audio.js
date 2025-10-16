import { store, drumTracks } from './state.js';

// --- Tone.js セットアップ ---

// ドラムサンプラー
const drumSampler = new Tone.Sampler({
  urls: { C2:'kick.wav', E2:'snare.wav', G3:'openhat.wav', C4:'hihat.wav' },
  baseUrl: 'https://raw.githubusercontent.com/U808U/UoGB/master/'
}).toDestination();

// ベース用 MonoSynth
const bassSynth = new Tone.MonoSynth({
  oscillator: { type: 'square' },
  envelope:   { attack: store.getState().bassParams.envelope, decay:0.2, sustain:0.5, release:1 },
  filter:     { type:'lowpass', rolloff:-12, Q:1, frequency: 10000 },
  filterEnvelope: { attack: store.getState().bassParams.filterEnv, baseFrequency: store.getState().bassParams.filterFreq, octaves:2, release:2 }
}).toDestination();
bassSynth.volume.value = Tone.gainToDb(store.getState().bassParams.volume);

// PAD用 PolySynth (AutoFilterに変更)
const padFilter = new Tone.AutoFilter({
  frequency: store.getState().padParams.filterSpeed,
  baseFrequency: store.getState().padParams.filterFreq,
  octaves: 4
}).toDestination();
padFilter.start(); // AutoFilterを開始

const padSynth = new Tone.PolySynth(Tone.Synth, {
  maxPolyphony: 4,
  oscillator: { type: 'sawtooth' },
  envelope:   { attack: store.getState().padParams.envelope, decay:0.2, sustain:0.5, release:3 }
}).connect(padFilter);
padSynth.volume.value = Tone.gainToDb(store.getState().padParams.volume);


// LEAD用 MonoSynth
const leadSynth = new Tone.MonoSynth({
  oscillator: { type: 'sawtooth' },
  envelope:   { attack: store.getState().leadParams.envelope, decay:0.2, sustain:0.5, release:1 },
  filter:     { type:'lowpass', rolloff:-12, Q:1, frequency: 10000 },
  filterEnvelope: { attack: store.getState().leadParams.filterEnv, baseFrequency: store.getState().leadParams.filterFreq, octaves: 4, release: 2 }
}).toDestination();
leadSynth.volume.value = Tone.gainToDb(store.getState().leadParams.volume);


// bassParams変更時にシンセへ反映
store.subscribe(
  (s) => {
    const p = s.bassParams;
    bassSynth.volume.value           = Tone.gainToDb(p.volume);
    bassSynth.envelope.attack         = p.envelope;
    bassSynth.filterEnvelope.baseFrequency = p.filterFreq;
    bassSynth.filter.Q.value          = p.filterQ;
    bassSynth.filterEnvelope.attack   = p.filterEnv;
  },
  (s) => s.bassParams
);

// leadParams変更時にシンseへ反映
store.subscribe(
  (s) => {
    const p = s.leadParams;
    leadSynth.volume.value = Tone.gainToDb(p.volume);
    leadSynth.envelope.attack = p.envelope;
    leadSynth.filterEnvelope.baseFrequency = p.filterFreq;
    leadSynth.filter.Q.value = p.filterQ;
    leadSynth.filterEnvelope.attack = p.filterEnv;
  },
  (s) => s.leadParams
);

// padParams変更時にシンセへ反映
store.subscribe(
  (s) => {
    const p = s.padParams;
    padSynth.volume.value = Tone.gainToDb(p.volume);
    padFilter.baseFrequency = p.filterFreq;
    padFilter.frequency.value = p.filterSpeed;
    padSynth.set({ envelope: { attack: p.envelope } });
  },
  (s) => s.padParams
);

const stepsToTime = (steps) => {
  if (steps <= 0) return '32n';
  const time = 16 / steps;
  return `${time}n`;
};

// Transportループ：16nごとにステップ算出・UI更新・音発火
const stepTicks = Tone.Time('16n').toTicks();
Tone.Transport.scheduleRepeat((time) => {
  const step = Math.floor(Tone.Transport.ticks / stepTicks) % 64; // 4小節(64ステップ)でループ

  Tone.Draw.schedule(() => {
    store.getState().setPlayheadPosition(step);
  }, time);

  const state = store.getState();
  const currentPatternStepsByTrack = state.patterns[state.activePatternIndex].stepsByTrack;
  const sixteenthStep = step % 16; // 1小節(16ステップ)用のループカウンター

  // ドラム発火 (1小節ループ)
  Object.entries(drumTracks).forEach(([track, note]) => {
    const velocity = currentPatternStepsByTrack[track]?.[sixteenthStep] ?? 0;
    if (velocity > 0) {
      drumSampler.triggerAttack(note, time, velocity * state.drumVolumes[track]);
    }
  });

  // Bass, Pad, Leadの発火処理 (ループを1つに統合)
  Object.entries(currentPatternStepsByTrack).forEach(([track, seq]) => {
    // BASS
    if (track.startsWith('BASS_')) {
      const stepObj = seq[sixteenthStep];
      if (stepObj && stepObj.on) {
        const note = track.split('_')[1];
        const globalVelocity = state.patterns[state.activePatternIndex].bassGlobalVelocity[sixteenthStep] ?? 0.8;
        const filterValue = state.patterns[state.activePatternIndex].bassGlobalFilter[sixteenthStep] ?? 0.5;
        const lengthValue = state.patterns[state.activePatternIndex].bassGlobalLength[sixteenthStep] ?? 0.125;
        const lengthInSteps = Math.round(lengthValue * 16);
        const noteLength = stepsToTime(lengthInSteps);
        const minFilterFreq = 40;
        const maxFilterFreq = 10000;
        const nonLinearFilterValue = Math.pow(filterValue, 4);
        const mappedFilterFreq = minFilterFreq + (nonLinearFilterValue * (maxFilterFreq - minFilterFreq));
        
        bassSynth.filterEnvelope.baseFrequency = mappedFilterFreq;
        bassSynth.triggerAttackRelease(note, noteLength, time, globalVelocity);
      }
    }
    // PAD
    else if (track.startsWith('PAD_')) {
      const stepObj = seq[sixteenthStep];
      if (stepObj && stepObj.on) {
        const note = track.split('_')[1];
        const lengthValue = state.patterns[state.activePatternIndex].padGlobalLength[sixteenthStep] ?? 0.25;
        const lengthInSteps = Math.round(lengthValue * 16);
        const noteLength = stepsToTime(lengthInSteps);
        padSynth.triggerAttackRelease(note, noteLength, time, stepObj.velocity);
      }
    }
    // LEAD
    else if (track.startsWith('LEAD_')) {
      const stepObj = seq[sixteenthStep];
      if (stepObj && stepObj.on) {
        const note = track.split('_')[1];
        const globalVelocity = state.patterns[state.activePatternIndex].leadGlobalVelocity[sixteenthStep] ?? 0.8;
        const filterValue = state.patterns[state.activePatternIndex].leadGlobalFilter[sixteenthStep] ?? 0.5;
        const lengthValue = state.patterns[state.activePatternIndex].leadGlobalLength[sixteenthStep] ?? 0.125;
        const lengthInSteps = Math.round(lengthValue * 16);
        const noteLength = stepsToTime(lengthInSteps);
        const minFilterFreq = 40;
        const maxFilterFreq = 10000;
        const nonLinearFilterValue = Math.pow(filterValue, 4);
        const mappedFilterFreq = minFilterFreq + (nonLinearFilterValue * (maxFilterFreq - minFilterFreq));

        leadSynth.filterEnvelope.baseFrequency = mappedFilterFreq;
        leadSynth.triggerAttackRelease(note, noteLength, time, globalVelocity);
      }
    }
  });
}, '16n');
