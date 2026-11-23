export type FlightPhase =
  | 'idle'
  | 'ascent'
  | 'transition'
  | 'zero_g_loss'
  | 'antarctic_cruise'
  | 'ufo_intercept'
  | 'antarctic_splash'
  | 'outer_breakout'
  | 'parachute_descent'
  | 'outer_landing'
  | 'ufo_incinerated'
  | 'failure_falling'
  | 'ocean_splash';

export type CameraFocusMode =
  | 'rocket'
  | 'engine'
  | 'plume'
  | 'iss'
  | 'pedestrian'
  | 'map'
  | 'broadcast_rocket'
  | 'broadcast_iss'
  | 'free';

export type LaunchMode =
  | 'combined'
  | 'variant_zero_g'
  | 'variant_antarctica'
  | 'forced_failure';

export type ActiveLaunchVariant = 'zero_g' | 'antarctica' | 'failure';
export type AntarcticOutcome = 'ufo_intercept' | 'outer_parachute';

export type WeatherMode = 'auto' | 'clear' | 'rain' | 'storm' | 'snow' | 'sandstorm';

export interface MapPinPreview {
  x: number;
  z: number;
  placeId?: string;
  name: string;
  region: string;
  coords: string;
  surfaceLabel: string;
  isOuter: boolean;
}

export interface BroadcastDialogue {
  speaker: string;
  text: string;
  channel: 'rocket' | 'iss' | 'ufo';
  timestamp: number;
}

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
  /** Launch scenario: combined (default alternating 1 & 2), variant 1 (>40 km), variant 2 (Antarctica), or forced failure */
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
  activeVariant: ActiveLaunchVariant;
  antarcticOutcome: AntarcticOutcome;
  ambientPressurePct: number;
  nozzleSpreadDeg: number;
  missionTimeSec: number;
  isLaunching: boolean;
  hasFailed: boolean;
  splashedCount: number;
  issAltitudeKm: number;
  focusMode: CameraFocusMode;
  pedestrianPlaceName: string;
  pedestrianRegion: string;
  pedestrianCoords: string;
  dropPinMode: boolean;
  weatherMode: WeatherMode;
  activeWeatherLabel: string;
  mapSelection: MapPinPreview | null;
}

export const DEFAULT_SIM_PARAMS: SimulationParams = {
  zeroGStartKm: 38,
  zeroGFullKm: 40,
  plumeDispersion: 1.25,
  plumeGlow: 1.4,
  tumbleIntensity: 1.15,
  outerLandsVisibility: 0.85,
  timeScale: 1.0,
  launchMode: 'combined',
  showBoundaryPlane: true,
  extraTopSafeAreaPx: 0,
};
