import type { SliderSchema } from '../ui/TuningPanel';

export type FluidSimParams = {
  simResolution: number;
  splatRadius: number;
  splatForce: number;
  velocityDissipation: number;
  pressureIterations: number;
  colliderRadius: number;
  colliderSoftness: number;
  fingerVelSmoothing: number;
};

export const DEFAULT_FLUID_SIM_PARAMS: FluidSimParams = {
  simResolution: 1024,
  splatRadius: 0.002,
  splatForce: 3000,
  velocityDissipation: 0.924,
  pressureIterations: 21,
  colliderRadius: 0.053,
  colliderSoftness: 0.009,
  fingerVelSmoothing: 0.95,
};

export const FLUID_SIM_SCHEMA: SliderSchema<keyof FluidSimParams>[] = [
  { key: 'simResolution', label: 'sim res', min: 128, max: 2048, step: 128 },
  { key: 'splatRadius', label: 'splat r', min: 0.001, max: 0.08, step: 0.001 },
  { key: 'splatForce', label: 'splat F', min: 50, max: 3000, step: 10 },
  {
    key: 'velocityDissipation',
    label: 'dissip.',
    min: 0.9,
    max: 1.0,
    step: 0.001,
  },
  {
    key: 'pressureIterations',
    label: 'jacobi N',
    min: 1,
    max: 60,
    step: 1,
  },
  {
    key: 'colliderRadius',
    label: 'coll. r',
    min: 0.005,
    max: 0.15,
    step: 0.001,
  },
  {
    key: 'colliderSoftness',
    label: 'coll. soft',
    min: 0.0,
    max: 0.08,
    step: 0.001,
  },
  {
    key: 'fingerVelSmoothing',
    label: 'vel smooth',
    min: 0.05,
    max: 1.0,
    step: 0.01,
  },
];

export type GlowParams = {
  sourceStrength: number;
  decay: number;
  brightness: number;
};

export const DEFAULT_GLOW_PARAMS: GlowParams = {
  sourceStrength: 0.001,
  decay: 0.93,
  brightness: 1.0,
};

export const GLOW_SCHEMA: SliderSchema<keyof GlowParams>[] = [
  {
    key: 'sourceStrength',
    label: 'source',
    min: 0.0,
    max: 0.01,
    step: 0.00005,
  },
  { key: 'decay', label: 'decay', min: 0.8, max: 0.99, step: 0.005 },
  {
    key: 'brightness',
    label: 'brightness',
    min: 0.1,
    max: 5.0,
    step: 0.05,
  },
];

export type SurfaceParams = {
  waveAmplitude: number;
  waveSpeed: number;
  waveScale: number;
  disturbStrength: number;
  sunPosX: number;
  sunPosY: number;
  sunRadius: number;
  sunBrightness: number;
  fresnelExp: number;
  warpGain: number;
  warpDecay: number;
};

export const DEFAULT_SURFACE_PARAMS: SurfaceParams = {
  waveAmplitude: 0.304,
  waveSpeed: 0.5,
  waveScale: 4.5,
  disturbStrength: 56.0,
  sunPosX: -0.86,
  sunPosY: 0.3,
  sunRadius: 0.29,
  sunBrightness: 5.0,
  fresnelExp: 4.0,
  warpGain: 0.05,
  warpDecay: 0.878,
};

export type FishParams = {
  count: number;
  neighborRadius: number;
  separationRadius: number;
  alignWeight: number;
  cohesionWeight: number;
  separationWeight: number;
  repulsionRadius: number;
  repulsionStrength: number;
  maxSpeed: number;
  damping: number;
  depthDrift: number;
  fishSize: number;
  glowBase: number;
  glowSpeedScale: number;
  trailDecay: number;
  composite: number;
};

export const DEFAULT_FISH_PARAMS: FishParams = {
  count: 150,
  neighborRadius: 0.08,
  separationRadius: 0.02,
  alignWeight: 0.6,
  cohesionWeight: 0.4,
  separationWeight: 2.0,
  repulsionRadius: 0.15,
  repulsionStrength: 4.0,
  maxSpeed: 0.35,
  damping: 0.99,
  depthDrift: 0.3,
  fishSize: 14.0,
  glowBase: 0.3,
  glowSpeedScale: 8.0,
  trailDecay: 0.9,
  composite: 1.0,
};

export const FISH_SCHEMA: SliderSchema<keyof FishParams>[] = [
  { key: 'count', label: 'count', min: 20, max: 500, step: 10 },
  {
    key: 'neighborRadius',
    label: 'nbr r',
    min: 0.01,
    max: 0.3,
    step: 0.005,
  },
  {
    key: 'separationRadius',
    label: 'sep r',
    min: 0.005,
    max: 0.1,
    step: 0.002,
  },
  { key: 'alignWeight', label: 'align', min: 0, max: 3, step: 0.05 },
  { key: 'cohesionWeight', label: 'cohere', min: 0, max: 3, step: 0.05 },
  { key: 'separationWeight', label: 'separate', min: 0, max: 5, step: 0.05 },
  {
    key: 'repulsionRadius',
    label: 'repel r',
    min: 0.02,
    max: 0.4,
    step: 0.005,
  },
  {
    key: 'repulsionStrength',
    label: 'repel F',
    min: 0,
    max: 15,
    step: 0.1,
  },
  { key: 'maxSpeed', label: 'max spd', min: 0.05, max: 1.5, step: 0.01 },
  { key: 'damping', label: 'damping', min: 0.9, max: 1.0, step: 0.002 },
  { key: 'depthDrift', label: 'depth drift', min: 0, max: 2, step: 0.02 },
  { key: 'fishSize', label: 'size', min: 2, max: 40, step: 0.5 },
  { key: 'glowBase', label: 'glow base', min: 0, max: 2, step: 0.02 },
  {
    key: 'glowSpeedScale',
    label: 'glow spd',
    min: 0,
    max: 40,
    step: 0.2,
  },
  {
    key: 'trailDecay',
    label: 'trail dec',
    min: 0.5,
    max: 0.99,
    step: 0.005,
  },
  { key: 'composite', label: 'compose', min: 0, max: 3, step: 0.02 },
];

export const SURFACE_SCHEMA: SliderSchema<keyof SurfaceParams>[] = [
  {
    key: 'waveAmplitude',
    label: 'wave amp',
    min: 0.0,
    max: 0.4,
    step: 0.002,
  },
  { key: 'waveSpeed', label: 'wave spd', min: 0.0, max: 2.0, step: 0.02 },
  { key: 'waveScale', label: 'wave scale', min: 2, max: 60, step: 0.5 },
  {
    key: 'disturbStrength',
    label: 'disturb',
    min: 0,
    max: 80,
    step: 0.5,
  },
  { key: 'sunPosX', label: 'sun x', min: -1, max: 1, step: 0.01 },
  { key: 'sunPosY', label: 'sun y', min: -1, max: 1, step: 0.01 },
  { key: 'sunRadius', label: 'sun size', min: 0.005, max: 0.4, step: 0.005 },
  { key: 'sunBrightness', label: 'sun bright', min: 0, max: 5, step: 0.05 },
  { key: 'fresnelExp', label: 'fresnel', min: 1, max: 8, step: 0.1 },
  { key: 'warpGain', label: 'warp gain', min: 0, max: 3, step: 0.05 },
  { key: 'warpDecay', label: 'warp decay', min: 0.8, max: 1.0, step: 0.002 },
];
