import { useEffect, useRef } from 'react';
import type { FingertipState } from '../hands/useHandLandmarker';
import { FluidSim } from './fluidSim';
import type {
  FishParams,
  FluidSimParams,
  GlowParams,
  SurfaceParams,
} from './params';

type Props = {
  fingertipsRef: React.MutableRefObject<FingertipState[]>;
  params: FluidSimParams;
  glowParams: GlowParams;
  surfaceParams: SurfaceParams;
  fishParams: FishParams;
};

export function FluidCanvas({
  fingertipsRef,
  params,
  glowParams,
  surfaceParams,
  fishParams,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paramsRef = useRef(params);
  const glowParamsRef = useRef(glowParams);
  const surfaceParamsRef = useRef(surfaceParams);
  const fishParamsRef = useRef(fishParams);
  paramsRef.current = params;
  glowParamsRef.current = glowParams;
  surfaceParamsRef.current = surfaceParams;
  fishParamsRef.current = fishParams;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let sim: FluidSim;
    try {
      sim = new FluidSim(
        canvas,
        paramsRef.current,
        glowParamsRef.current,
        surfaceParamsRef.current,
        fishParamsRef.current,
      );
    } catch (err) {
      console.error('[FluidSim] init failed:', err);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      sim.resize(w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    let rafId = 0;
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      sim.setParams(paramsRef.current);
      sim.setGlowParams(glowParamsRef.current);
      sim.setSurfaceParams(surfaceParamsRef.current);
      sim.setFishParams(fishParamsRef.current);
      sim.step(fingertipsRef.current);
      sim.render();
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      sim.dispose();
    };
  }, [fingertipsRef]);

  return <canvas ref={canvasRef} className="stage-canvas" />;
}
