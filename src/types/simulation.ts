export type FlightPhase =
  | 'idle'
  | 'ascent'
  | 'transition'
  | 'zero_g_loss'
  | 'failure_falling'
  | 'ocean_splash';

export type CameraFocusMode = 'rocket' | 'engine' | 'plume' | 'map' | 'free';

export type LaunchMode = 'occasional_failure' | 'nominal' | 'forced_failure';

export interface SimulationParams {
  /** Altitude in km where the zero-gravity field begins (default: 38) */
  zeroGStartKm: number;
  /** Full zero-gravity upper boundary in km (default: 40) */
  zeroGFullKm: number;
  /** Uniform radial gas & light dispersion multiplier in zero-G (0.5 - 2.0) */
  plumeDispersion: number;
  /** Glow / twilight illumination strength of the plume (0.4 - 2.0) */
  plumeGlow: number;
  /** Tumbling torque after losing directional thrust above 40 km (0.2 - 2.0) */
  tumbleIntensity: number;
  /** Visibility of the outer lands beyond the Antarctic ice ring (0.15 - 1.0) */
  outerLandsVisibility: number;
  /** Simulation time scale (1.0 = ~60 seconds to 40 km) */
  timeScale: number;
  /** Launch reliability mode: occasional failure (~30%), always nominal, or forced failure */
  launchMode: LaunchMode;
  /** Show the 38-40 km boundary plane and altitude ruler */
  showBoundaryPlane: boolean;
  /** Extra top padding in px for Android 16-17 edge-to-edge / custom display cutouts */
  extraTopSafeAreaPx: number;
}

export interface TelemetryState {
  altitudeKm: number;
  downrangeKm: number;
  velocityKmS: number;
  pitchDeg: number;
  angularRateDegS: number;
  phase: FlightPhase;
  ambientPressurePct: number;
  nozzleSpreadDeg: number;
  missionTimeSec: number;
  isLaunching: boolean;
  hasFailed: boolean;
  splashedCount: number;
}

export const DEFAULT_SIM_PARAMS: SimulationParams = {
  zeroGStartKm: 38,
  zeroGFullKm: 40,
  plumeDispersion: 1.25,
  plumeGlow: 1.4,
  tumbleIntensity: 1.15,
  outerLandsVisibility: 0.85,
  timeScale: 1.0,
  launchMode: 'occasional_failure',
  showBoundaryPlane: true,
  extraTopSafeAreaPx: 0,
};
