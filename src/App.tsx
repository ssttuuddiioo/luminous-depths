import { useRef, useState } from 'react';
import {
  DEFAULT_HAND_FILTER_PARAMS,
  type HandFilterParams,
  useHandLandmarker,
} from './hands/useHandLandmarker';
import { useMouseInput } from './hands/useMouseInput';
import { FluidCanvas } from './sim/FluidCanvas';
import {
  DEFAULT_FISH_PARAMS,
  DEFAULT_FLUID_SIM_PARAMS,
  DEFAULT_GLOW_PARAMS,
  DEFAULT_SURFACE_PARAMS,
  FISH_SCHEMA,
  FLUID_SIM_SCHEMA,
  GLOW_SCHEMA,
  SURFACE_SCHEMA,
  type FishParams,
  type FluidSimParams,
  type GlowParams,
  type SurfaceParams,
} from './sim/params';
import { TuningPanel, type SliderSchema } from './ui/TuningPanel';
import './App.css';

const HAND_FILTER_SCHEMA: SliderSchema<keyof HandFilterParams>[] = [
  { key: 'minCutoff', label: 'minCutoff', min: 0.1, max: 5.0, step: 0.05 },
  { key: 'beta', label: 'beta', min: 0, max: 0.2, step: 0.002 },
  { key: 'dCutoff', label: 'dCutoff', min: 0.1, max: 3.0, step: 0.1 },
];

type InputMode = 'mouse' | 'hand';

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('mouse');
  const [handFilter, setHandFilter] = useState<HandFilterParams>(
    DEFAULT_HAND_FILTER_PARAMS,
  );
  const [fluidParams, setFluidParams] = useState<FluidSimParams>(
    DEFAULT_FLUID_SIM_PARAMS,
  );
  const [glowParams, setGlowParams] = useState<GlowParams>(DEFAULT_GLOW_PARAMS);
  const [surfaceParams, setSurfaceParams] = useState<SurfaceParams>(
    DEFAULT_SURFACE_PARAMS,
  );
  const [fishParams, setFishParams] = useState<FishParams>(DEFAULT_FISH_PARAMS);

  const hand = useHandLandmarker(videoRef, handFilter, inputMode === 'hand');
  const mouse = useMouseInput(inputMode === 'mouse');
  const activeRef =
    inputMode === 'hand' ? hand.fingertipsRef : mouse.fingertipsRef;

  return (
    <>
      <video ref={videoRef} playsInline muted className="hidden-video" />
      <FluidCanvas
        fingertipsRef={activeRef}
        params={fluidParams}
        glowParams={glowParams}
        surfaceParams={surfaceParams}
        fishParams={fishParams}
      />
      <div className="panels">
        {inputMode === 'hand' && (
          <TuningPanel
            title="hand filter"
            params={handFilter}
            schema={HAND_FILTER_SCHEMA}
            onChange={setHandFilter}
          />
        )}
        <TuningPanel
          title="fluid sim"
          params={fluidParams}
          schema={FLUID_SIM_SCHEMA}
          onChange={setFluidParams}
        />
        <TuningPanel
          title="glow"
          params={glowParams}
          schema={GLOW_SCHEMA}
          onChange={setGlowParams}
        />
        <TuningPanel
          title="surface"
          params={surfaceParams}
          schema={SURFACE_SCHEMA}
          onChange={setSurfaceParams}
        />
        <TuningPanel
          title="fish"
          params={fishParams}
          schema={FISH_SCHEMA}
          onChange={setFishParams}
        />
      </div>
      <div className="mode-toggle">
        <button
          className={inputMode === 'mouse' ? 'active' : ''}
          onClick={() => setInputMode('mouse')}
        >
          mouse
        </button>
        <button
          className={inputMode === 'hand' ? 'active' : ''}
          onClick={() => setInputMode('hand')}
        >
          hand
        </button>
      </div>
      <div className="status">
        {inputMode === 'mouse' && 'click + drag'}
        {inputMode === 'hand' && hand.status === 'loading-model' && 'loading model…'}
        {inputMode === 'hand' && hand.status === 'loading-camera' && 'requesting camera…'}
        {inputMode === 'hand' && hand.status === 'ready' && 'tracking'}
        {inputMode === 'hand' && hand.status === 'error' && `error: ${hand.errorMessage}`}
      </div>
    </>
  );
}
