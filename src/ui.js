import { install } from 'https://esm.sh/@twind/core@1';
import presetAutoprefix from 'https://esm.sh/@twind/preset-autoprefix@1';
import presetTailwind from 'https://esm.sh/@twind/preset-tailwind@1';
import { html, render, useState, useEffect, useRef, useCallback }
  from 'https://unpkg.com/htm/preact/standalone.module.js?module';

import { store, noteNames, savableStateKeys } from './state.js';
import './audio.js';

// Install Twind before rendering
install({
  presets: [presetAutoprefix(), presetTailwind()],
  theme: {
    extend: {
      gridTemplateColumns: {
        '16': 'repeat(16, minmax(0, 1fr))',
        '64': 'repeat(64, minmax(0, 1fr))',
      }
    }
  }
});

// --- Zustand Custom Hook ---
// Zustandストアのスライスを購読するためのカスタムフック
const useStoreState = (selector, equalityFn) => {
  const [state, setState] = useState(() => selector(store.getState()));

  useEffect(() => {
    const unsubscribe = store.subscribe((newState, prevState) => {
      const newSlice = selector(newState);
      const oldSlice = selector(prevState);
      
      const changed = equalityFn ? !equalityFn(newSlice, oldSlice) : newSlice !== oldSlice;
      
      if (changed) {
        setState(newSlice);
      }
    });
    setState(selector(store.getState()));
    return unsubscribe;
  }, [selector, equalityFn]);

  return state;
};


// --- UI コンポーネント ---

// 横長スライダー
const ControlSlider = ({ label, value, min=0, max=1, step=0.01, onInput, displayValue }) => html`
  <div class="grid grid-cols-[5rem,1fr,3rem] items-center gap-2">
    <label class="text-sm truncate">${label}</label>
    <input
      type="range"
      min=${min} max=${max} step=${step}
      value=${value}
      onInput=${onInput}
      class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
    />
    <span class="text-sm text-right">
      ${displayValue 
        ? displayValue 
        : (typeof value === 'number' 
          ? (Number.isInteger(value) ? value : value.toFixed(2))
          : value)}
    </span>
  </div>
`;

// 楽器パラメータ用の縦型コンパクトスライダー
const VolumeSlider = ({ label, value, onInput, min=0, max=1, step=0.01 }) => html`
  <div class="flex flex-col items-start w-full gap-1">
    <div class="flex justify-between w-full">
      <label class="text-xs text-gray-400 truncate">${label}</label>
      <span class="text-xs text-gray-400">${value.toFixed(2)}</span>
    </div>
    <input
      type="range"
      min=${min} max=${max} step=${step}
      value=${value}
      onInput=${onInput}
      class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
    />
  </div>
`;

const Step = ({ on, isCurrent, index }) => {
  const baseClasses = "cursor-pointer h-5 rounded w-full";
  const onClass = on ? "bg-indigo-400" : "bg-gray-700";
  const currentClass = isCurrent ? "ring-2 ring-offset-2 ring-offset-gray-900 ring-yellow-400" : "";
  const measureMarkerClass = (index % 4 === 0) ? "border-l-2 border-gray-500" : ""; // Add a left border for measure markers

  return html`
    <div
      class="${baseClasses} ${onClass} ${currentClass} ${measureMarkerClass}"
    ></div>
  `;
};

const StepGrid = ({ track }) => {
    const gridRef = useRef(null);
    const lastToggledStep = useRef(null);
    const [steps, setSteps] = useState([]); // Initialize empty
    const [currentStep, setCurrentStep] = useState(-1);

    useEffect(() => {
        const updateSteps = () => {
            const s = store.getState();
            setSteps(s.patterns[s.activePatternIndex].stepsByTrack[track] ?? []);
        };

        const unsubPatterns = store.subscribe((s, p) => {
            const instrument = track.split('_')[0].toLowerCase();
            const currentPattern = s.patterns[s.activePatternIndex];
            const prevPattern = p.patterns[p.activePatternIndex];

            let changed = false;
            if (s.activePatternIndex !== p.activePatternIndex) {
                changed = true;
            } else if (currentPattern && prevPattern) {
                if (currentPattern.stepsByTrack[track] !== prevPattern.stepsByTrack[track]) {
                    changed = true;
                }
                if (!track.startsWith('DRUM_')) {
                    const lengthProp = `${instrument}GlobalLength`;
                    if (currentPattern[lengthProp] !== prevPattern[lengthProp]) {
                        changed = true;
                    }
                }
            }

            if (changed) {
                updateSteps();
            }
        });

        const unsubPlayhead = store.subscribe((s, p) => {
            if (s.isPlaying !== p.isPlaying || s.playheadPosition !== p.playheadPosition) {
                if (!s.isPlaying) {
                    setCurrentStep(-1);
                    return;
                }
                // All tracks now use a 16-step UI grid, so the logic is the same.
                setCurrentStep(s.playheadPosition % 16);
            }
        });

        updateSteps(); // Initial call

        return () => {
            unsubPatterns();
            unsubPlayhead();
        };
    }, [track]); // Removed bassVisiblePage from dependencies

    const getStepIndexFromEvent = (e) => {
        if (!gridRef.current) return -1;
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const stepWidth = rect.width / 16;
        return Math.floor(x / stepWidth);
    };

    const handlePointerDown = (e) => {
        const index = getStepIndexFromEvent(e);
        if (index === -1) return;

        const isDrum = track.startsWith('DRUM_');
        const currentStepValue = steps[index] ?? 0;
        const mode = (isDrum ? currentStepValue > 0 : currentStepValue) ? 'erase' : 'draw';
        store.getState().setDrawing(true, mode);
        
        store.getState().setStepState(track, index);
        lastToggledStep.current = index;

        // If it's a BASS track, set it as the selected bass note for velocity editing
        if (track.startsWith('BASS_')) {
            store.getState().setSelectedBassNoteForVelocity(track);
        }

        const handlePointerMove = (moveEvent) => {
            const moveIndex = getStepIndexFromEvent(moveEvent);
            if (moveIndex !== -1 && moveIndex !== lastToggledStep.current) {
                store.getState().setStepState(track, moveIndex, store.getState().drawingMode);
                lastToggledStep.current = moveIndex;
            }
        };

        const handlePointerUp = () => {
            store.getState().setDrawing(false);
            lastToggledStep.current = null;
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    const timeToSteps = (time) => {
        if (typeof time !== 'string') return 1;
        const match = time.match(/^(\d+)([ntm])$/);
        if (!match) return 1;
        const [_, valStr, unit] = match;
        const val = parseInt(valStr, 10);
        if (unit === 'n') {
            return 16 / val;
        }
        return 1;
    };

    const renderedSteps = [];
    for (let i = 0; i < 16; ) {
        const isDrum = track.startsWith('DRUM_');
        const stepState = steps[i] ?? 0;
        const on = isDrum ? stepState > 0 : (stepState && stepState.on);

        if (on) {
            let lengthInSteps = 1;
            if (!isDrum) {
                const instrument = track.split('_')[0].toLowerCase();
                const s = store.getState();
                const lengthValue = s.patterns[s.activePatternIndex][`${instrument}GlobalLength`][i];
                lengthInSteps = Math.round(lengthValue * 16);
                lengthInSteps = Math.max(1, lengthInSteps);
                lengthInSteps = Math.min(lengthInSteps, 16 - i);
            }
            
            const isCurrent = i <= currentStep && currentStep < i + lengthInSteps;

            renderedSteps.push(html`
                <div style=${{ gridColumn: `span ${lengthInSteps}` }} key=${i}>
                    <${Step} on=${on} isCurrent=${isCurrent} index=${i} />
                </div>
            `);
            i += lengthInSteps;
        } else {
            renderedSteps.push(html`<${Step} key=${i} on=${false} isCurrent=${currentStep === i} index=${i} />`);
            i++;
        }
    }

    return html`
        <div
            ref=${gridRef}
            class="grid grid-cols-16 gap-0.5 touch-none"
            onPointerDown=${handlePointerDown}
        >
            ${renderedSteps}
        </div>
    `;
};

const VelocityBar = ({ velocity }) => {
    return html`
        <div class="relative w-full h-20 bg-gray-700 rounded cursor-pointer">
            <div
                class="absolute bottom-0 left-0 w-full bg-indigo-400 rounded"
                style=${{ height: `${velocity * 100}%`, pointerEvents: 'none' }}
            ></div>
        </div>
    `;
};

const LengthBar = ({ length }) => {
    return html`
        <div class="relative w-full h-20 bg-gray-700 rounded cursor-pointer">
            <div
                class="absolute bottom-0 left-0 w-full bg-purple-400 rounded"
                style=${{ height: `${length * 100}%`, pointerEvents: 'none' }}
            ></div>
        </div>
    `;
};

const VelocityGrid = ({ track }) => {
    const gridRef = useRef(null);
    const [velocities, setVelocities] = useState([]); // Initialize empty

    useEffect(() => {
        const updateVelocities = () => {
            const s = store.getState();
            if (track === 'BASS_GLOBAL_VELOCITY') {
              setVelocities(s.patterns[s.activePatternIndex].bassGlobalVelocity ?? Array(16).fill(0.8));
            } else if (track === 'PAD_GLOBAL_VELOCITY') {
              setVelocities(s.patterns[s.activePatternIndex].padGlobalVelocity ?? Array(16).fill(0.8));
            } else if (track === 'LEAD_GLOBAL_VELOCITY') {
              setVelocities(s.patterns[s.activePatternIndex].leadGlobalVelocity ?? Array(16).fill(0.8));
            } else if (track.startsWith('DRUM_')) {
              setVelocities(s.patterns[s.activePatternIndex].stepsByTrack[track] ?? Array(16).fill(0));
            } else {
              setVelocities(s.patterns[s.activePatternIndex].stepsByTrack[track]?.map(step => step.velocity) ?? Array(16).fill(0));
            }
        };
        const unsub = store.subscribe((s, p) => {
            if (track === 'BASS_GLOBAL_VELOCITY') {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.bassGlobalVelocity !== p.patterns[p.activePatternIndex]?.bassGlobalVelocity) {
                  updateVelocities();
              }
            } else if (track === 'PAD_GLOBAL_VELOCITY') {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.padGlobalVelocity !== p.patterns[p.activePatternIndex]?.padGlobalVelocity) {
                  updateVelocities();
              }
            } else if (track === 'LEAD_GLOBAL_VELOCITY') {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.leadGlobalVelocity !== p.patterns[p.activePatternIndex]?.leadGlobalVelocity) {
                  updateVelocities();
              }
            } else if (track.startsWith('DRUM_')) {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.stepsByTrack[track] !== p.patterns[p.activePatternIndex]?.stepsByTrack[track]) {
                  updateVelocities();
              }
            } else { // Individual note velocities (not currently used for bass/pad/lead)
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.stepsByTrack[track] !== p.patterns[p.activePatternIndex]?.stepsByTrack[track]) {
                  updateVelocities();
              }
            }
        });
        updateVelocities(); // Initial call
        return unsub;
    }, [track]);

    const updateVelocityFromEvent = (e) => {
        if (!gridRef.current) return;
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;

        const stepWidth = rect.width / 16;
        const index = Math.min(15, Math.max(0, Math.floor(x / stepWidth))); // Clamp index to 0-15
        const velocity = Math.max(0, Math.min(1, 1 - y / rect.height));

        if (velocities[index] !== velocity) {
            if (track === 'BASS_GLOBAL_VELOCITY') {
              store.getState().setBassStepVelocity(index, velocity);
            } else if (track === 'PAD_GLOBAL_VELOCITY') {
              store.getState().setPadStepVelocity(index, velocity);
            } else if (track === 'LEAD_GLOBAL_VELOCITY') {
              store.getState().setLeadStepVelocity(index, velocity);
            } else {
              store.getState().setDrumStepVelocity(track, index, velocity);
            }
        }
    };

    const handlePointerDown = (e) => {
        store.getState().setDrawing(true);
        updateVelocityFromEvent(e);

        const handlePointerMove = (moveEvent) => {
            updateVelocityFromEvent(moveEvent);
        };

        const handlePointerUp = () => {
            store.getState().setDrawing(false);
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    return html`
        <div
            ref=${gridRef}
            class="grid grid-cols-16 gap-0.5 touch-none"
            onPointerDown=${handlePointerDown}
        >
            ${velocities.map((vel, i) => html`<${VelocityBar} key=${i} velocity=${vel} />`)}
        </div>
    `;
};

const LengthGrid = ({ track }) => {
    const gridRef = useRef(null);
    const [lengths, setLengths] = useState([]); // Initialize empty

    useEffect(() => {
        const updateLengths = () => {
            const s = store.getState();
            if (track === 'BASS_GLOBAL_LENGTH') {
              setLengths(s.patterns[s.activePatternIndex].bassGlobalLength ?? Array(16).fill(0.125));
            } else if (track === 'PAD_GLOBAL_LENGTH') {
              setLengths(s.patterns[s.activePatternIndex].padGlobalLength ?? Array(16).fill(0.25));
            } else if (track === 'LEAD_GLOBAL_LENGTH') {
              setLengths(s.patterns[s.activePatternIndex].leadGlobalLength ?? Array(16).fill(0.125));
            }
        };
        const unsub = store.subscribe((s, p) => {
            if (track === 'BASS_GLOBAL_LENGTH') {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.bassGlobalLength !== p.patterns[p.activePatternIndex]?.bassGlobalLength) {
                  updateLengths();
              }
            } else if (track === 'PAD_GLOBAL_LENGTH') {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.padGlobalLength !== p.patterns[p.activePatternIndex]?.padGlobalLength) {
                  updateLengths();
              }
            } else if (track === 'LEAD_GLOBAL_LENGTH') {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.leadGlobalLength !== p.patterns[p.activePatternIndex]?.leadGlobalLength) {
                  updateLengths();
              }
            }
        });
        updateLengths(); // Initial call
        return unsub;
    }, [track]);

    const lengthSteps = [1/16, 2/16, 4/16, 8/16, 16/16]; // 16th, 8th, 4th, half, whole

    const handlePointerDown = (e) => {
        if (!gridRef.current) return;
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const stepWidth = rect.width / 16;
        const index = Math.min(15, Math.max(0, Math.floor(x / stepWidth)));

        const currentLength = lengths[index];
        // Find the next length in the cycle
        const currentIndex = lengthSteps.findIndex(l => Math.abs(l - currentLength) < 0.001);
        const nextLength = currentIndex > -1 && currentIndex < lengthSteps.length - 1
            ? lengthSteps[currentIndex + 1]
            : lengthSteps[0];

        if (track === 'BASS_GLOBAL_LENGTH') {
          store.getState().setBassStepLength(index, nextLength);
        } else if (track === 'PAD_GLOBAL_LENGTH') {
          store.getState().setPadStepLength(index, nextLength);
        } else if (track === 'LEAD_GLOBAL_LENGTH') {
          store.getState().setLeadStepLength(index, nextLength);
        }
    };

    return html`
        <div
            ref=${gridRef}
            class="grid grid-cols-16 gap-0.5 touch-none"
            onPointerDown=${handlePointerDown}
        >
            ${lengths.map((len, i) => html`<${LengthBar} key=${i} length=${len} />`)}
        </div>
    `;
};

const FilterGrid = ({ track }) => {
    const gridRef = useRef(null);
    const [filterValues, setFilterValues] = useState([]); // Initialize empty

    useEffect(() => {
        const updateFilterValues = () => {
            const s = store.getState();
            if (track === 'BASS_GLOBAL_FILTER') {
              setFilterValues(s.patterns[s.activePatternIndex].bassGlobalFilter ?? Array(16).fill(0.5));
            } else if (track === 'PAD_GLOBAL_FILTER') {
              setFilterValues(s.patterns[s.activePatternIndex].padGlobalFilter ?? Array(16).fill(0.5));
            } else if (track === 'LEAD_GLOBAL_FILTER') {
              setFilterValues(s.patterns[s.activePatternIndex].leadGlobalFilter ?? Array(16).fill(0.5));
            } else {
              setFilterValues(s.patterns[s.activePatternIndex].bassGlobalFilter ?? Array(16).fill(0.5));
            }
        };
        const unsub = store.subscribe((s, p) => {
            if (track === 'BASS_GLOBAL_FILTER') {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.bassGlobalFilter !== p.patterns[p.activePatternIndex]?.bassGlobalFilter) {
                  updateFilterValues();
              }
            } else if (track === 'PAD_GLOBAL_FILTER') {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.padGlobalFilter !== p.patterns[p.activePatternIndex]?.padGlobalFilter) {
                  updateFilterValues();
              }
            } else if (track === 'LEAD_GLOBAL_FILTER') {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.leadGlobalFilter !== p.patterns[p.activePatternIndex]?.leadGlobalFilter) {
                  updateFilterValues();
              }
            } else {
              if (s.activePatternIndex !== p.activePatternIndex || 
                  s.patterns[s.activePatternIndex]?.bassGlobalFilter !== p.patterns[p.activePatternIndex]?.bassGlobalFilter) {
                  updateFilterValues();
              }
            }
        });
        updateFilterValues(); // Initial call
        return unsub;
    }, [track]);

    const updateFilterValueFromEvent = (e) => {
        if (!gridRef.current) return;
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;

        const stepWidth = rect.width / 16;
        const index = Math.min(15, Math.max(0, Math.floor(x / stepWidth))); // Clamp index to 0-15
        const value = Math.max(0, Math.min(1, 1 - y / rect.height)); // Normalized value 0-1

        if (filterValues[index] !== value) {
            if (track === 'BASS_GLOBAL_FILTER') {
              store.getState().setBassFilterStep(index, value);
            } else if (track === 'PAD_GLOBAL_FILTER') {
              store.getState().setPadFilterStep(index, value);
            } else if (track === 'LEAD_GLOBAL_FILTER') {
              store.getState().setLeadFilterStep(index, value);
            } else {
              store.getState().setBassFilterStep(index, value);
            }
        }
    };

    const handlePointerDown = (e) => {
        store.getState().setDrawing(true);
        updateFilterValueFromEvent(e);

        const handlePointerMove = (moveEvent) => {
            updateFilterValueFromEvent(moveEvent);
        };

        const handlePointerUp = () => {
            store.getState().setDrawing(false);
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    return html`
        <div
            ref=${gridRef}
            class="grid grid-cols-16 gap-0.5 touch-none"
            onPointerDown=${handlePointerDown}
        >
            ${filterValues.map((val, i) => html`<${VelocityBar} key=${i} velocity=${val} />`)}
        </div>
    `;
};

const BassVelocityEditor = ({ minOct, maxOct, paramConfig, params, paramSetter }) => {
  const [activeMode, setActiveMode] = useState('Vel'); // 'Vel', 'Mix', 'Filter', or 'Len'

  return html`
    <div class="py-1 px-2">
      <div class="flex items-center gap-1 mb-2">
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Vel" active=${activeMode === 'Vel'} onClick=${() => setActiveMode('Vel')} />
        </div>
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Len" active=${activeMode === 'Len'} onClick=${() => setActiveMode('Len')} />
        </div>
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Filter" active=${activeMode === 'Filter'} onClick=${() => setActiveMode('Filter')} />
        </div>
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Mix" active=${activeMode === 'Mix'} onClick=${() => setActiveMode('Mix')} />
        </div>
      </div>

      ${activeMode === 'Vel' && html`
        <${VelocityGrid} track="BASS_GLOBAL_VELOCITY" />
      `}

      ${activeMode === 'Len' && html`
        <${LengthGrid} track="BASS_GLOBAL_LENGTH" />
      `}

      ${activeMode === 'Mix' && html`
        <${InstrumentPanel} 
            paramConfig=${paramConfig} 
            params=${params} 
            paramSetter=${paramSetter} 
        />
      `}

      ${activeMode === 'Filter' && html`
        <${FilterGrid} track="BASS_GLOBAL_FILTER" />
      `}
    </div>
  `;
};

const PadVelocityEditor = ({ minOct, maxOct, paramConfig, params, paramSetter }) => {
  const [activeMode, setActiveMode] = useState('Vel'); // 'Vel', 'Mix', 'Filter', or 'Len'

  return html`
    <div class="py-1 px-2">
      <div class="flex items-center gap-1 mb-2">
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Vel" active=${activeMode === 'Vel'} onClick=${() => setActiveMode('Vel')} />
        </div>
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Len" active=${activeMode === 'Len'} onClick=${() => setActiveMode('Len')} />
        </div>
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Filter" active=${activeMode === 'Filter'} onClick=${() => setActiveMode('Filter')} />
        </div>
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Mix" active=${activeMode === 'Mix'} onClick=${() => setActiveMode('Mix')} />
        </div>
      </div>

      ${activeMode === 'Vel' && html`
        <${VelocityGrid} track="PAD_GLOBAL_VELOCITY" />
      `}

      ${activeMode === 'Len' && html`
        <${LengthGrid} track="PAD_GLOBAL_LENGTH" />
      `}

      ${activeMode === 'Mix' && html`
        <${InstrumentPanel} 
            paramConfig=${paramConfig} 
            params=${params} 
            paramSetter=${paramSetter} 
        />
      `}

      ${activeMode === 'Filter' && html`
        <${FilterGrid} track="PAD_GLOBAL_FILTER" />
      `}
    </div>
  `;
};

const LeadVelocityEditor = ({ minOct, maxOct, paramConfig, params, paramSetter }) => {
  const [activeMode, setActiveMode] = useState('Vel'); // 'Vel', 'Mix', 'Filter', or 'Len'

  return html`
    <div class="py-1 px-2">
      <div class="flex items-center gap-1 mb-2">
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Vel" active=${activeMode === 'Vel'} onClick=${() => setActiveMode('Vel')} />
        </div>
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Len" active=${activeMode === 'Len'} onClick=${() => setActiveMode('Len')} />
        </div>
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Filter" active=${activeMode === 'Filter'} onClick=${() => setActiveMode('Filter')} />
        </div>
        <div class="grid grid-cols-1 gap-1">
          <${TabButton} label="Mix" active=${activeMode === 'Mix'} onClick=${() => setActiveMode('Mix')} />
        </div>
      </div>

      ${activeMode === 'Vel' && html`
        <${VelocityGrid} track="LEAD_GLOBAL_VELOCITY" />
      `}

      ${activeMode === 'Len' && html`
        <${LengthGrid} track="LEAD_GLOBAL_LENGTH" />
      `}

      ${activeMode === 'Mix' && html`
        <${InstrumentPanel} 
            paramConfig=${paramConfig} 
            params=${params} 
            paramSetter=${paramSetter} 
        />
      `}

      ${activeMode === 'Filter' && html`
        <${FilterGrid} track="LEAD_GLOBAL_FILTER" />
      `}
    </div>
  `;
};

const ChromaticGrid = ({ base, oct, setOct, min, max }) => {
  const bassActiveOctave = useStoreState(s => s.bassActiveOctave);
  const padActiveOctave = useStoreState(s => s.padActiveOctave);
  const leadActiveOctave = useStoreState(s => s.leadActiveOctave);

  const getActiveOctave = () => {
    if (base === 'BASS') return bassActiveOctave;
    if (base === 'PAD') return padActiveOctave;
    if (base === 'LEAD') return leadActiveOctave;
    return oct;
  };

  return html`
    <div class="p-2 pt-0">
      ${(base !== 'BASS' && base !== 'PAD' && base !== 'LEAD') && html`
        <${ControlSlider}
          label="Octave"
          value=${oct}
          min=${min}
          max=${max}
          step=${1}
          onInput=${(e) => setOct(e.target.valueAsNumber)}
          displayValue=${oct}
        />
      `}
      <div class="flex flex-col gap-0.5 mt-2">
        ${noteNames.map((n) =>
          html`<${StepGrid} track=${`${base}_${n}${getActiveOctave()}`} />`
        )}
      </div>
    </div>
  `;
};

const TabButton = ({ label, active, onClick }) => html`
  <button
    class="py-1 px-2 text-xs rounded-lg w-full ${active ? 'bg-indigo-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}"
    onClick=${onClick}
  >${label}</button>
`;

const BassMinimap = () => {
    const activePatternIndex = useStoreState(s => s.activePatternIndex);
    const stepsByTrack = useStoreState(s => s.patterns[s.activePatternIndex]?.stepsByTrack ?? {});
    const playheadPosition = useStoreState(s => s.playheadPosition);
    const isPlaying = useStoreState(s => s.isPlaying);

    const summary = Array(64).fill(false);
    Object.keys(stepsByTrack).forEach(track => {
        if (track.startsWith('BASS_')) {
            stepsByTrack[track].forEach((step, i) => {
                if (step) summary[i] = true;
            });
        }
    });

    return html`
        <div class="px-2 pt-2">
            <div class="grid grid-cols-64 gap-px relative">
                ${summary.map(on => html`<div class="h-2 ${on ? 'bg-indigo-400' : 'bg-gray-700'}"></div>`)}
                ${isPlaying && html`
                    <div class="absolute top-0 h-2 w-px bg-yellow-300" style=${{ left: `${(playheadPosition / 64) * 100}%` }}></div>
                `}
            </div>
        </div>
    `;
}

const PageButtons = () => {
    const bassVisiblePage = useStoreState(s => s.bassVisiblePage);
    const playheadPosition = useStoreState(s => s.playheadPosition);
    const isPlaying = useStoreState(s => s.isPlaying);
    
    const setPage = store.getState().setBassVisiblePage;
    const playingPage = Math.floor(playheadPosition / 16);

    return html`
        <div class="grid grid-cols-4 gap-1 p-2">
            ${[0,1,2,3].map(i => {
                const isVisible = i === bassVisiblePage;
                const isPlayingPage = i === playingPage && isPlaying;
                const bg = isVisible ? 'bg-indigo-600' : 'bg-gray-700';
                const ring = isPlayingPage ? 'ring-2 ring-yellow-400' : '';
                return html`
                    <button onClick=${() => setPage(i)} class="py-1 px-2 text-xs rounded-md ${bg} ${ring} hover:bg-gray-600">
                        ${i + 1}
                    </button>
                `;
            })}
        </div>
    `;
}

const InstrumentPanel = ({ paramConfig, params, paramSetter }) => html`
        <div class="grid grid-cols-3 gap-x-4 gap-y-3 p-2">
            ${paramConfig.map(p => {
                const { label, key, type, options, ...opts } = p;
                let value, onInput;

                if (type === 'select') {
                    value = options.indexOf(params[key]);
                    onInput = (e) => paramSetter(key, options[e.target.valueAsNumber]);
                } else {
                    value = params?.[key];
                    onInput = (e) => paramSetter(key, e.target.valueAsNumber);
                }

                return html`
                    <${VolumeSlider}
                        label=${label}
                        value=${value}
                        min=${opts.min} max=${opts.max} step=${opts.step}
                        onInput=${onInput}
                    />
                `;
            })}
        </div>
    `;

const tabsConfig = [
  { key:'DRUM', label:'DRUM', type:'step', tracks:['DRUM_BD','DRUM_SD','DRUM_OH','DRUM_CH'], sliders:['BD','SD','OH','CH'] },
  {
    key:'BASS', label:'BASS', type:'chromatic', base:'BASS', min:1, max:2, init:1,
    paramSetter: store.getState().setBassParam,
    paramSelector: (s) => s.bassParams,
    paramConfig: [
      { label: 'Volume', key: 'volume', min: 0, max: 1, step: 0.01 },
      { label: 'Envelope', key: 'envelope', min: 0, max: 1, step: 0.01 },
      { label: 'Filter', key: 'filterFreq', min: 40, max: 2000, step: 1 },
      { label: 'Filter Q', key: 'filterQ', min: 0.1, max: 10, step: 0.1 },
      { label: 'Filter Env', key: 'filterEnv', min: 0, max: 1, step: 0.01 },
      { label: 'Length', key: 'length', type: 'select', options: ['32n', '16n', '8n', '4n', '2n', '1n'], min: 0, max: 5, step: 1 },
    ]
  },
  {
    key:'PAD',  label:'PAD',  type:'chromatic', base:'PAD',  min:3, max:5, init:3,
    paramSetter: store.getState().setPadParam,
    paramSelector: (s) => s.padParams,
    paramConfig: [
        { label: 'Volume', key: 'volume', min: 0, max: 1, step: 0.01 },
        { label: 'Envelope', key: 'envelope', min: 0, max: 1, step: 0.01 },
        { label: 'Filter', key: 'filterFreq', min: 40, max: 2000, step: 1 },
        { label: 'Length', key: 'length', type: 'select', options: ['32n', '16n', '8n', '4n', '2n', '1n'], min: 0, max: 5, step: 1 },
        { label: 'Filter Speed', key: 'filterSpeed', type: 'select', options: ['8n', '4n', '2n', '1m', '2m', '4m', '8m'], min: 0, max: 6, step: 1 },
    ]
  },
  {
    key:'LEAD', label:'LEAD', type:'chromatic', base:'LEAD', min:4, max:6, init:4,
    paramSetter: store.getState().setLeadParam,
    paramSelector: (s) => s.leadParams,
    paramConfig: [
        { label: 'Volume', key: 'volume', min: 0, max: 1, step: 0.01 },
        { label: 'Envelope', key: 'envelope', min: 0, max: 1, step: 0.01 },
        { label: 'Filter', key: 'filterFreq', min: 40, max: 2000, step: 1 },
        { label: 'Filter Q', key: 'filterQ', min: 0.1, max: 10, step: 0.1 },
        { label: 'Filter Env', key: 'filterEnv', min: 0, max: 1, step: 0.01 },
        { label: 'Length', key: 'length', type: 'select', options: ['32n', '16n', '8n', '4n', '2n', '1n'], min: 0, max: 5, step: 1 },
    ]
  },
  { key:'MIX',  label:'MIX',  type:'mix', sliders:['DRUM Volume','BASS Volume','PAD Volume','LEAD Volume'] },
];

const TrackTab = ({ cfg }) => {
  const [oct, setOct] = useState(cfg.init ?? cfg.min ?? 1);
  const params = useStoreState(s => s[`${cfg.key.toLowerCase()}Params`] ?? {});
  const bassActiveOctave = useStoreState(s => s.bassActiveOctave);
  const padActiveOctave = useStoreState(s => s.padActiveOctave);
  const leadActiveOctave = useStoreState(s => s.leadActiveOctave);

  if (cfg.type === 'step') { // DRUM
    const drumVolumes = useStoreState(s => s.drumVolumes);
    const selectedTrack = useStoreState(s => s.selectedDrumVelocityTrack);

    const drumTabButtons = [...cfg.sliders, 'Mix'];
    const drumTabTracks = [...cfg.tracks, 'MIX'];

    return html`
      <div class="p-2 flex flex-col gap-1">
        <div class="flex flex-col gap-0.5 mt-2">
          ${cfg.tracks.map((t) => html`<${StepGrid} track=${t} />`)}
        </div>
        
        <div class="mt-4 border-t border-gray-700 pt-2">
            <div class="grid grid-cols-5 gap-1 mb-2">
                ${drumTabButtons.map((label, i) => html`
                    <${TabButton} 
                        label=${label} 
                        active=${drumTabTracks[i] === selectedTrack} 
                        onClick=${() => store.getState().setSelectedDrumVelocityTrack(drumTabTracks[i])} 
                    />
                `)}
            </div>

            ${selectedTrack !== 'MIX' && html`
                <${VelocityGrid} track=${selectedTrack} />
            `}

            ${selectedTrack === 'MIX' && html`
                <div class="grid grid-cols-4 gap-x-4 gap-y-2 pt-2">
                  ${cfg.tracks.map((t,i) => html`
                    <${VolumeSlider}
                      label=${cfg.sliders[i]} 
                      value=${drumVolumes[t]}
                      max=${1.5}
                      onInput=${(e) => store.getState().setDrumVolume(t, e.target.valueAsNumber)}
                    />
                  `)}
                </div>
            `}
        </div>
      </div>
    `;
  }

  if (cfg.type === 'chromatic') { // BASS, PAD, LEAD
    if (cfg.key === 'BASS') {
      return html`
        <div>
          <div class="border-t border-gray-700" />
          <${ChromaticGrid} base=${cfg.base} min=${cfg.min} max=${cfg.max} />
          <div class="border-t border-gray-700" />
          <div class="flex items-center gap-1 mb-1 justify-center">
            <span class="text-sm text-gray-300">Oct ${bassActiveOctave}</span>
            <button 
              class="py-1 px-2 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300"
              onClick=${() => store.getState().setBassActiveOctave(Math.max(cfg.min, bassActiveOctave - 1))}
            >≪</button>
            <button 
              class="py-1 px-2 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300"
              onClick=${() => store.getState().setBassActiveOctave(Math.min(cfg.max, bassActiveOctave + 1))}
            >≫</button>
          </div>
          <${BassVelocityEditor} minOct=${cfg.min} maxOct=${cfg.max} paramConfig=${cfg.paramConfig} params=${params} paramSetter=${cfg.paramSetter} />
        </div>
      `;
    } else if (cfg.key === 'PAD') {
      return html`
        <div>
          <div class="border-t border-gray-700" />
          <${ChromaticGrid} base=${cfg.base} min=${cfg.min} max=${cfg.max} />
          <div class="border-t border-gray-700" />
          <div class="flex items-center gap-1 mb-1 justify-center">
            <span class="text-sm text-gray-300">Oct ${padActiveOctave}</span>
            <button 
              class="py-1 px-2 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300"
              onClick=${() => store.getState().setPadActiveOctave(Math.max(cfg.min, padActiveOctave - 1))}
            >≪</button>
            <button 
              class="py-1 px-2 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300"
              onClick=${() => store.getState().setPadActiveOctave(Math.min(cfg.max, padActiveOctave + 1))}
            >≫</button>
          </div>
          <${PadVelocityEditor} minOct=${cfg.min} maxOct=${cfg.max} paramConfig=${cfg.paramConfig} params=${params} paramSetter=${cfg.paramSetter} />
        </div>
      `;
    } else { // LEAD
      return html`
        <div>
          <div class="border-t border-gray-700" />
          <${ChromaticGrid} base=${cfg.base} min=${cfg.min} max=${cfg.max} />
          <div class="border-t border-gray-700" />
          <div class="flex items-center gap-1 mb-1 justify-center">
            <span class="text-sm text-gray-300">Oct ${leadActiveOctave}</span>
            <button 
              class="py-1 px-2 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300"
              onClick=${() => store.getState().setLeadActiveOctave(Math.max(cfg.min, leadActiveOctave - 1))}
            >≪</button>
            <button 
              class="py-1 px-2 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300"
              onClick=${() => store.getState().setLeadActiveOctave(Math.min(cfg.max, leadActiveOctave + 1))}
            >≫</button>
          </div>
          <${LeadVelocityEditor} minOct=${cfg.min} maxOct=${cfg.max} paramConfig=${cfg.paramConfig} params=${params} paramSetter=${cfg.paramSetter} />
        </div>
      `;
    }
  }

  if (cfg.key === 'MIX') {
    return html`<div class="p-4 text-center">Mixer controls coming soon...</div>`
  }

  return html`<div></div>`; // Fallback for unknown types
};

const PatternSelector = () => {
    const activePatternIndex = useStoreState(s => s.activePatternIndex);
    const copiedPatternData = useStoreState(s => s.copiedPatternData);
    const [contextMenu, setContextMenu] = useState(null);
    const [patternPage, setPatternPage] = useState(0);

    const handlePatternClick = (index) => {
        store.getState().setActivePatternIndex(index);
        setContextMenu(null);
    };

    const handleLongPress = (e, index) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, patternIndex: index });
    };

    const handleCopy = () => {
        if (contextMenu) {
            store.getState().copyPattern(contextMenu.patternIndex);
            setContextMenu(null);
        }
    };

    const handlePaste = () => {
        if (contextMenu && copiedPatternData) {
            store.getState().pastePattern(contextMenu.patternIndex);
            setContextMenu(null);
        }
    };

    const handleClear = () => {
        if (contextMenu) {
            store.getState().clearPattern(contextMenu.patternIndex);
            setContextMenu(null);
        }
    };

    useEffect(() => {
        const handleClickOutside = () => setContextMenu(null);
        if (contextMenu) {
            window.addEventListener('click', handleClickOutside);
        }
        return () => window.removeEventListener('click', handleClickOutside);
    }, [contextMenu]);

    const totalPatterns = 16;
    const patternsPerPage = 4;
    const totalPages = Math.ceil(totalPatterns / patternsPerPage);

    const startPatternIndex = patternPage * patternsPerPage;
    const endPatternIndex = Math.min(startPatternIndex + patternsPerPage, totalPatterns);

    const handlePrevPage = () => setPatternPage(prev => Math.max(0, prev - 1));
    const handleNextPage = () => setPatternPage(prev => Math.min(totalPages - 1, prev + 1));

    return html`
        <div class="mt-1 bg-gray-800 rounded-lg p-2">
            <div class="flex items-center justify-center gap-1">
                <button
                    class="py-1 px-4 w-8 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 ${patternPage === 0 ? 'opacity-50 cursor-not-allowed' : ''}"
                    onClick=${handlePrevPage}
                    disabled=${patternPage === 0}
                >
                    «
                </button>
                <div class="grid grid-cols-4 gap-1 flex-grow">
                    ${Array(totalPatterns).fill(0).slice(startPatternIndex, endPatternIndex).map((_, i) => {
                        const patternIndex = startPatternIndex + i;
                        return html`
                            <button
                                class="py-1 px-2 text-xs rounded-lg ${activePatternIndex === patternIndex ? 'bg-indigo-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}"
                                onClick=${() => handlePatternClick(patternIndex)}
                                onContextMenu=${(e) => handleLongPress(e, patternIndex)}
                                onTouchStart=${(e) => {
                                    e.persist();
                                    this.longPressTimer = setTimeout(() => handleLongPress(e, patternIndex), 500);
                                }}
                                onTouchEnd=${() => clearTimeout(this.longPressTimer)}
                                onTouchCancel=${() => clearTimeout(this.longPressTimer)}
                            >
                                ${patternIndex + 1}
                            </button>
                        `;
                    })}
                </div>
                <button
                    class="py-1 px-4 w-8 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 ${patternPage === totalPages - 1 ? 'opacity-50 cursor-not-allowed' : ''}"
                    onClick=${handleNextPage}
                    disabled=${patternPage === totalPages - 1}
                >
                    »
                </button>
            </div>

            ${contextMenu && html`
                <div
                    class="absolute bg-gray-700 rounded-lg shadow-lg p-1 z-10"
                    style=${{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
                    onClick=${(e) => e.stopPropagation()}
                >
                    <button class="block w-full text-left px-2 py-1 text-sm hover:bg-gray-600 rounded" onClick=${handleCopy}>Copy</button>
                    <button class="block w-full text-left px-2 py-1 text-sm hover:bg-gray-600 rounded ${copiedPatternData ? '' : 'opacity-50 cursor-not-allowed'}" onClick=${handlePaste} disabled=${!copiedPatternData}>Paste</button>
                    <button class="block w-full text-left px-2 py-1 text-sm hover:bg-gray-600 rounded" onClick=${handleClear}>Clear</button>
                </div>
            `}
        </div>
    `;
};

const SettingsModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const swingSubdivision = useStoreState(s => s.swingSubdivision);
  const { setSwingSubdivision, loadState } = store.getState();
  const fileInputRef = useRef(null);

  const handleSave = () => {
    const state = store.getState();
    const dataToSave = {};
    savableStateKeys.forEach(key => {
      dataToSave[key] = state[key];
    });

    const dataStr = JSON.stringify(dataToSave, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `groovebox-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!window.confirm('現在のセッションを上書きします。よろしいですか？')) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const savedState = JSON.parse(event.target.result);
        loadState(savedState);
        onClose(); // Close modal on successful load
      } catch (err) {
        console.error("Error loading or parsing file:", err);
        alert("ファイルの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file);
  };

  return html`
    <div class="fixed inset-0 bg-black bg-opacity-50 z-40 flex items-center justify-center" onClick=${onClose}>
      <div class="bg-gray-800 rounded-lg shadow-xl p-4 w-full max-w-md m-4" onClick=${e => e.stopPropagation()}>
        <h2 class="text-xl font-bold mb-4">設定</h2>
        
        <div class="mb-6">
          <h3 class="text-lg font-semibold mb-2">スイング</h3>
          <div class="flex gap-2">
            <${TabButton} label="8th" active=${swingSubdivision === '8n'} onClick=${() => setSwingSubdivision('8n')} />
            <${TabButton} label="16th" active=${swingSubdivision === '16n'} onClick=${() => setSwingSubdivision('16n')} />
          </div>
        </div>

        <div class="mb-4">
          <h3 class="text-lg font-semibold mb-2">セッション</h3>
          <div class="flex gap-2">
            <button class="py-2 px-4 text-sm rounded-lg w-full bg-green-600 hover:bg-green-500" onClick=${handleSave}>セーブ</button>
            <button class="py-2 px-4 text-sm rounded-lg w-full bg-blue-600 hover:bg-blue-500" onClick=${handleLoadClick}>ロード</button>
            <input type="file" accept=".json,application/json" style=${{ display: 'none' }} ref=${fileInputRef} onChange=${handleFileSelected} />
          </div>
        </div>

        <div class="text-right">
          <button class="py-2 px-4 text-sm rounded-lg bg-gray-600 hover:bg-gray-500" onClick=${onClose}>閉じる</button>
        </div>
      </div>
    </div>
  `;
};

const App = () => {
  const [active, setActive] = useState('DRUM');
  const [masterVol, setMasterVol] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  const isPlaying = useStoreState(s => s.isPlaying);
  const bpm = useStoreState(s => s.bpm);
  const swing = useStoreState(s => s.swing);
  const { setBpm, setSwing } = store.getState();

  useEffect(() => { Tone.Destination.volume.rampTo(masterVol, 0.1) }, [masterVol]);

  const togglePlayback = async () => {
    if (Tone.context.state !== 'running') {
      await Tone.start();
    }
    if (!isPlaying) {
      Tone.Transport.start();
    } else {
      Tone.Transport.stop();
      store.getState().setPlayheadPosition(0); // 停止時に再生ヘッドをリセット
    }
    store.getState().togglePlay();
  };

  return html`
    <main class="p-1 max-w-3xl mx-auto font-sans">
      <${SettingsModal} isOpen=${showSettings} onClose=${() => setShowSettings(false)} />
      <div class="bg-gray-800 rounded-lg">
        <header class="flex items-center gap-2 py-0.5 px-1">
          <button onClick=${togglePlayback} class="w-8 h-8 text-xl rounded-lg flex-shrink-0 flex items-center justify-center ${isPlaying ? 'bg-red-500' : 'bg-green-500'} hover:bg-opacity-80 transition-colors">
            ${isPlaying ? '■' : '▶'}
          </button>
          
          <div class="flex items-center gap-1 bg-gray-900 rounded-md p-1">
            <label class="text-xs text-gray-400">BPM</label>
            <input type="number" min="40" max="300" value=${bpm} onInput=${(e) => setBpm(e.target.valueAsNumber)} class="bg-transparent text-white w-12 text-center" />
          </div>

          <div class="flex items-center gap-1 flex-grow">
            <label class="text-xs text-gray-400">Vol</label>
            <input type="range" min="-40" max="0" step="1" value=${masterVol} onInput=${(e) => setMasterVol(e.target.valueAsNumber)} class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
          </div>
          
          <div class="flex items-center gap-1 flex-grow">
            <label class="text-xs text-gray-400">Swi</label>
            <input type="range" min="0" max="0.8" step="0.01" value=${swing} onInput=${(e) => setSwing(e.target.valueAsNumber)} class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
          </div>

          <button onClick=${() => setShowSettings(true)} class="text-gray-400 hover:text-white flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </header>
        <nav class="grid grid-cols-5 gap-1 mt-1 p-1">
          ${tabsConfig.map(c => html`
            <${TabButton} label=${c.label} active=${active===c.key} onClick=${() => setActive(c.key)} />
          `)}
        </nav>
      </div>
      <div class="mt-1 bg-gray-800 rounded-lg">
        <${TrackTab} cfg=${tabsConfig.find(c => c.key===active)} />
      </div>
      <${PatternSelector} />
    </main>
  `;
};

render(html`<${App} />`, document.body);
