import { useEffect, useRef, useState } from 'react';
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { OneEuroFilter } from './oneEuro';

export type HandFilterParams = {
  minCutoff: number;
  beta: number;
  dCutoff: number;
};

export const DEFAULT_HAND_FILTER_PARAMS: HandFilterParams = {
  minCutoff: 0.4,
  beta: 0.186,
  dCutoff: 1.2,
};

// If a new sample is farther than this (normalized units) from the last,
// reset the filter rather than glide — handles detection dropouts cleanly.
const REACQUIRE_JUMP = 0.15;

// Fingertip landmark indices in MediaPipe's 21-point hand model.
// 4 = thumb tip, 8 = index, 12 = middle, 16 = ring, 20 = pinky.
const FINGERTIP_INDICES = [4, 8, 12, 16, 20];

export type FingertipState = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  tPrev: number;
};

export type HandStatus =
  | 'idle'
  | 'loading-model'
  | 'loading-camera'
  | 'ready'
  | 'error';

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

type PerFinger = {
  xFilter: OneEuroFilter;
  yFilter: OneEuroFilter;
  state: FingertipState;
  lastRawX: number | null;
  lastRawY: number | null;
};

export function useHandLandmarker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  params: HandFilterParams = DEFAULT_HAND_FILTER_PARAMS,
  enabled: boolean = true,
) {
  // Live array of currently-tracked fingertips. Entries are added as
  // fingers appear and removed when they leave the frame.
  const fingertipsRef = useRef<FingertipState[]>([]);
  // Persistent per-finger filters keyed by stable finger id.
  const filterMapRef = useRef<Map<string, PerFinger>>(new Map());
  const [status, setStatus] = useState<HandStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Keep all active filters' params synced to the panel.
  useEffect(() => {
    for (const f of filterMapRef.current.values()) {
      f.xFilter.minCutoff = params.minCutoff;
      f.xFilter.beta = params.beta;
      f.xFilter.dCutoff = params.dCutoff;
      f.yFilter.minCutoff = params.minCutoff;
      f.yFilter.beta = params.beta;
      f.yFilter.dCutoff = params.dCutoff;
    }
  }, [params.minCutoff, params.beta, params.dCutoff]);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      fingertipsRef.current = [];
      filterMapRef.current.clear();
      return;
    }
    let cancelled = false;
    let landmarker: HandLandmarker | null = null;
    let stream: MediaStream | null = null;
    let rafId = 0;

    const getOrCreateFinger = (id: string, now: number): PerFinger => {
      const existing = filterMapRef.current.get(id);
      if (existing) return existing;
      const pf: PerFinger = {
        xFilter: new OneEuroFilter(params.minCutoff, params.beta, params.dCutoff),
        yFilter: new OneEuroFilter(params.minCutoff, params.beta, params.dCutoff),
        state: {
          id,
          x: 0.5,
          y: 0.5,
          vx: 0,
          vy: 0,
          prevX: 0.5,
          prevY: 0.5,
          tPrev: now,
        },
        lastRawX: null,
        lastRawY: null,
      };
      filterMapRef.current.set(id, pf);
      return pf;
    };

    const start = async () => {
      try {
        setStatus('loading-model');
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        });
        if (cancelled) return;

        setStatus('loading-camera');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) throw new Error('video element missing');
        video.srcObject = stream;
        await video.play();

        setStatus('ready');

        const tick = () => {
          rafId = requestAnimationFrame(tick);
          const v = videoRef.current;
          const lm = landmarker;
          if (!v || !lm || v.readyState < 2) return;
          const now = performance.now();
          let result: HandLandmarkerResult | null = null;
          try {
            result = lm.detectForVideo(v, now);
          } catch {
            return;
          }
          const hands = result?.landmarks ?? [];
          const seen = new Set<string>();
          const active: FingertipState[] = [];

          for (let h = 0; h < hands.length; h++) {
            const hand = hands[h];
            for (const tipIdx of FINGERTIP_INDICES) {
              const tip = hand[tipIdx];
              if (!tip) continue;
              const id = `h${h}t${tipIdx}`;
              seen.add(id);
              const pf = getOrCreateFinger(id, now);

              // MediaPipe x/y ∈ [0,1], y at top. Mirror x for selfie.
              const rawX = 1 - tip.x;
              const rawY = tip.y;

              if (
                pf.lastRawX == null ||
                pf.lastRawY == null ||
                Math.hypot(rawX - pf.lastRawX, rawY - pf.lastRawY) >
                  REACQUIRE_JUMP
              ) {
                pf.xFilter.reset();
                pf.yFilter.reset();
              }
              pf.lastRawX = rawX;
              pf.lastRawY = rawY;

              const x = pf.xFilter.filter(rawX, now);
              const y = pf.yFilter.filter(rawY, now);
              const s = pf.state;
              const dt = s.tPrev > 0 ? (now - s.tPrev) / 1000 : 1 / 60;
              s.prevX = s.x;
              s.prevY = s.y;
              s.vx = (x - s.x) / Math.max(dt, 1e-3);
              s.vy = (y - s.y) / Math.max(dt, 1e-3);
              s.x = x;
              s.y = y;
              s.tPrev = now;
              active.push(s);
            }
          }

          // Evict state for fingers that left the frame this update.
          for (const id of filterMapRef.current.keys()) {
            if (!seen.has(id)) filterMapRef.current.delete(id);
          }
          fingertipsRef.current = active;
        };
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    };

    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (landmarker) landmarker.close();
      filterMapRef.current.clear();
      fingertipsRef.current = [];
    };
  }, [videoRef, enabled, params.minCutoff, params.beta, params.dCutoff]);

  return { fingertipsRef, status, errorMessage };
}
