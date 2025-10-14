import { createStore } from 'https://esm.sh/zustand@4.4.0?module';

// 音階リスト
export const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].reverse();

// ドラムトラック→MIDIノート
export const drumTracks = {
  DRUM_BD: 'C2',
  DRUM_SD: 'E2',
  DRUM_OH: 'G3',
  DRUM_CH: 'C4'
};
// 初期ドラム音量
const initialDrumVolumes = Object.fromEntries(
  Object.keys(drumTracks).map((t) => [t, 1])
);

// Zustandストア
export const store = createStore((set, get) => ({
  patterns: Array(16).fill(null).map(() => ({
    stepsByTrack: {},
    bassFilterSteps: Array(16).fill(null).map(() => ({ on: false, value: 0.5 })),
    bassGlobalVelocity: Array(16).fill(0.8), // Global velocity for bass
    bassGlobalFilter: Array(16).fill(0.5), // Global filter for bass
    padGlobalVelocity: Array(16).fill(0.8), // Global velocity for pad
    padGlobalFilter: Array(16).fill(0.5),
    leadGlobalVelocity: Array(16).fill(0.8), // Global velocity for lead
    leadGlobalFilter: Array(16).fill(0.5) // Global filter for lead
  })),
  activePatternIndex: 0,
  copiedPatternData: null,

  isDrawing: false,
  drawingMode: null,
  playheadPosition: 0,
  drumVolumes: initialDrumVolumes,
  isPlaying: false,
  selectedDrumVelocityTrack: 'DRUM_BD',
  selectedBassNoteForVelocity: 'BASS_C1',
  bassActiveOctave: 1, // Default bass octave for note entry
  padActiveOctave: 3, // Default pad octave for note entry
  leadActiveOctave: 4, // Default lead octave for note entry

  // ベース用パラメータ
  bassParams: {
    volume:   0.25,
    envelope: 0.1,
    filterFreq: 800,
    filterQ:  1,
    filterEnv: 0.2,
    length:   '8n'
  },

  // PAD用パラメータ
  padParams: {
    volume:   0.1,
    envelope: 0.5,
    filterFreq: 500,
    length:   '4n',
    filterSpeed: '8n',
  },

  // LEAD用パラメータ
  leadParams: {
    volume:   0.25,
    envelope: 0.1,
    filterFreq: 1200,
    filterQ:  1,
    filterEnv: 0.4,
    length:   '8n'
  },

  // actions
  setDrawing:     (v, mode = null) => set({ isDrawing: v, drawingMode: mode }),
  setPlayheadPosition: (i) => set({ playheadPosition: i }),
  setDrumVolume:  (t, v)   => set((s) => ({ drumVolumes: { ...s.drumVolumes, [t]: v } })),
  setBassParam:   (k, v)   => set((s) => ({ bassParams: { ...s.bassParams, [k]: v } })),
  setPadParam:    (k, v)   => set((s) => ({ padParams: { ...s.padParams, [k]: v } })),
  setLeadParam:   (k, v)   => set((s) => ({ leadParams: { ...s.leadParams, [k]: v } })),
  togglePlay:     ()       => set((s) => ({ isPlaying: !s.isPlaying })),
  setSelectedDrumVelocityTrack: (track) => set({ selectedDrumVelocityTrack: track }),
  setSelectedBassNoteForVelocity: (track) => set({ selectedBassNoteForVelocity: track }),
  setBassActiveOctave: (octave) => set({ bassActiveOctave: octave }),
  setPadActiveOctave: (octave) => set({ padActiveOctave: octave }),
  setLeadActiveOctave: (octave) => set({ leadActiveOctave: octave }),

  // Pattern actions
  setActivePatternIndex: (index) => set({ activePatternIndex: index }),
  copyPattern: (sourceIndex) => {
    const currentPattern = get().patterns[sourceIndex];
    set({ copiedPatternData: JSON.parse(JSON.stringify(currentPattern)) });
  },
  pastePattern: (targetIndex) => {
    const copied = get().copiedPatternData;
    if (copied) {
      set((s) => {
        const newPatterns = [...s.patterns];
        newPatterns[targetIndex] = JSON.parse(JSON.stringify(copied));
        return { patterns: newPatterns };
      });
    }
  },
  clearPattern: (targetIndex) => {
    set((s) => {
      const newPatterns = [...s.patterns];
      newPatterns[targetIndex] = { 
        stepsByTrack: {},
        bassFilterSteps: Array(16).fill(null).map(() => ({ on: false, value: 0.5 })),
        bassGlobalVelocity: Array(16).fill(0.8),
        bassGlobalFilter: Array(16).fill(0.5),
        padGlobalVelocity: Array(16).fill(0.8),
        padGlobalFilter: Array(16).fill(0.5),
        leadGlobalVelocity: Array(16).fill(0.8),
        leadGlobalFilter: Array(16).fill(0.5)
      };
      return { patterns: newPatterns };
    });
  },

  setDrumStepVelocity: (track, stepIndex, velocity) =>
    set((s) => {
      const currentPattern = s.patterns[s.activePatternIndex];
      const currentTrackSteps = currentPattern.stepsByTrack[track] ?? Array(16).fill(0);
      const newTrackSteps = [...currentTrackSteps];
      newTrackSteps[stepIndex] = velocity;

      const newStepsByTrack = { ...currentPattern.stepsByTrack, [track]: newTrackSteps };
      const newCurrentPattern = { ...currentPattern, stepsByTrack: newStepsByTrack };
      
      const newPatterns = [...s.patterns];
      newPatterns[s.activePatternIndex] = newCurrentPattern;
      return { patterns: newPatterns };
    }),

  setBassStepVelocity: (stepIndex, velocity) =>
    set((s) => {
      const currentPattern = s.patterns[s.activePatternIndex];
      const newBassGlobalVelocity = [...currentPattern.bassGlobalVelocity];
      newBassGlobalVelocity[stepIndex] = velocity;

      const newCurrentPattern = { ...currentPattern, bassGlobalVelocity: newBassGlobalVelocity };
      const newPatterns = [...s.patterns];
      newPatterns[s.activePatternIndex] = newCurrentPattern;
      return { patterns: newPatterns };
    }),

  setPadStepVelocity: (stepIndex, velocity) =>
    set((s) => {
      const currentPattern = s.patterns[s.activePatternIndex];
      const newPadGlobalVelocity = [...currentPattern.padGlobalVelocity];
      newPadGlobalVelocity[stepIndex] = velocity;

      const newCurrentPattern = { ...currentPattern, padGlobalVelocity: newPadGlobalVelocity };
      const newPatterns = [...s.patterns];
      newPatterns[s.activePatternIndex] = newCurrentPattern;
      return { patterns: newPatterns };
    }),

  setLeadStepVelocity: (stepIndex, velocity) =>
    set((s) => {
      const currentPattern = s.patterns[s.activePatternIndex];
      const newLeadGlobalVelocity = [...currentPattern.leadGlobalVelocity];
      newLeadGlobalVelocity[stepIndex] = velocity;

      const newCurrentPattern = { ...currentPattern, leadGlobalVelocity: newLeadGlobalVelocity };
      const newPatterns = [...s.patterns];
      newPatterns[s.activePatternIndex] = newCurrentPattern;
      return { patterns: newPatterns };
    }),

  setBassFilterStep: (stepIndex, value) =>
    set((s) => {
      const currentPattern = s.patterns[s.activePatternIndex];
      const newBassGlobalFilter = [...currentPattern.bassGlobalFilter];
      newBassGlobalFilter[stepIndex] = value;

      const newCurrentPattern = { ...currentPattern, bassGlobalFilter: newBassGlobalFilter };
      const newPatterns = [...s.patterns];
      newPatterns[s.activePatternIndex] = newCurrentPattern;
      return { patterns: newPatterns };
    }),

  setPadFilterStep: (stepIndex, value) =>
    set((s) => {
      const currentPattern = s.patterns[s.activePatternIndex];
      const newPadGlobalFilter = [...currentPattern.padGlobalFilter];
      newPadGlobalFilter[stepIndex] = value;

      const newCurrentPattern = { ...currentPattern, padGlobalFilter: newPadGlobalFilter };
      const newPatterns = [...s.patterns];
      newPatterns[s.activePatternIndex] = newCurrentPattern;
      return { patterns: newPatterns };
    }),

  setLeadFilterStep: (stepIndex, value) =>
    set((s) => {
      const currentPattern = s.patterns[s.activePatternIndex];
      const newLeadGlobalFilter = [...currentPattern.leadGlobalFilter];
      newLeadGlobalFilter[stepIndex] = value;

      const newCurrentPattern = { ...currentPattern, leadGlobalFilter: newLeadGlobalFilter };
      const newPatterns = [...s.patterns];
      newPatterns[s.activePatternIndex] = newCurrentPattern;
      return { patterns: newPatterns };
    }),

  setStepState: (track, globalIndex, state) =>
    set((s) => {
        const currentPattern = s.patterns[s.activePatternIndex];
        let newStepsByTrack = { ...currentPattern.stepsByTrack };

        const isDrum = track.startsWith('DRUM_');
        const isPad = track.startsWith('PAD_');
        const isBass = track.startsWith('BASS_');
        const isLead = track.startsWith('LEAD_');

        // Determine length based on track type
        const length = 16; // PAD and LEAD are 64, DRUM and BASS are 16

        // Initialize currentTrackSteps based on track type
        const currentTrackSteps = newStepsByTrack[track] ?? ( // NEW initialization logic
            isDrum ? Array(length).fill(0) : // Drums are numbers
            (isBass || isPad || isLead) ? Array(length).fill(null).map(() => ({on: false, velocity: 0})) : // BASS, PAD, LEAD are objects
            Array(length).fill(false) // Default for others if any
        );
        const newTrackSteps = [...currentTrackSteps];

        let newValue; // Use newValue to avoid confusion with 'value' in monophonic handling
        if (isDrum) {
            const currentValue = newTrackSteps[globalIndex];
            newValue = (currentValue > 0) ? 0 : 0.8; // Toggle drum velocity
        } else if (isBass || isPad || isLead) { // NEW: Handle BASS, PAD, LEAD as objects
            const currentStepObj = newTrackSteps[globalIndex] ?? {on: false, velocity: 0};
            newValue = {
                on: !currentStepObj.on, // Toggle on/off
                velocity: currentStepObj.on ? 0 : (currentStepObj.velocity > 0 ? currentStepObj.velocity : 0.8) // If turning on, use existing velocity or default 0.8
            };
        } else {
            // Default boolean toggle for other types if any
            newValue = !newTrackSteps[globalIndex];
        }

        // Monophonic handling
        const isMonophonic = (isBass || isLead); // Only BASS and LEAD are monophonic
        if (isMonophonic && newValue.on) { // If a monophonic note is turned ON
            const [base, octStr] = track.split('_');
            let oct;
            if (isBass) oct = s.bassActiveOctave;
            else if (isPad) oct = s.padActiveOctave;
            else if (isLead) oct = s.leadActiveOctave;

            noteNames.forEach((n) => {
                const otherTrack = `${base}_${n}${oct}`;
                if (otherTrack !== track && newStepsByTrack[otherTrack]?.[globalIndex]?.on) { // If another note on the same step is ON
                    const otherSteps = [...newStepsByTrack[otherTrack]];
                    otherSteps[globalIndex] = {on: false, velocity: 0}; // Turn it OFF
                    newStepsByTrack[otherTrack] = otherSteps; // Update the copy
                }
            });
        }

        newTrackSteps[globalIndex] = newValue;
        newStepsByTrack[track] = newTrackSteps;

        const newCurrentPattern = { ...currentPattern, stepsByTrack: newStepsByTrack };
        const newPatterns = [...s.patterns];
        newPatterns[s.activePatternIndex] = newCurrentPattern;
        return { patterns: newPatterns };
    }),
}));