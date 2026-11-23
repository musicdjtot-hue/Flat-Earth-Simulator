import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  createAtmosphericCloudsTexture,
  createAzimuthalMapTextures,
  createCoastalSpaceportTexture,
  createLowerCumulusTexture,
  createMoonTexture,
  ICE_INNER_NORM,
  ICE_OUTER_NORM,
  projectLatLonToWorld,
  type AzimuthalMapTextures,
  type SurfaceSampleType,
} from './azimuthalMapTexture';
import {
  getPlaceWorldPosition,
  WORLD_PLACES,
  worldXZToApproxLatLon,
  type WorldPlace,
} from './worldPlaces';
import type {
  ActiveLaunchVariant,
  AntarcticOutcome,
  BroadcastDialogue,
  CameraFocusMode,
  FlightPhase,
  MapPinPreview,
  SimulationParams,
  TelemetryState,
  WeatherMode,
} from '../types/simulation';

// Real-world 1:1 km scale (1 world unit = 1 km)
const DISC_RADIUS = 28000; // 28,000 km total disc radius (20,000 km to Antarctic Ice Ring)
const LAUNCH_SITE = projectLatLonToWorld(28.5, -80.5, DISC_RADIUS);
const LAUNCH_ANGLE = Math.atan2(LAUNCH_SITE.z, LAUNCH_SITE.x);
const LAUNCH_RADIUS_KM = Math.hypot(LAUNCH_SITE.x, LAUNCH_SITE.z);
// Eastward downrange direction from launch coast into the Atlantic Ocean
const DOWNRANGE_DIR = new THREE.Vector3(0.28, 0, -0.96).normalize();
// Radial southward heading directly toward the Antarctic Ice Wall (r = 20,000 km) & Outer Lands (r = 22,600 km)
const SOUTHWARD_DIR = new THREE.Vector3(LAUNCH_SITE.x, 0, LAUNCH_SITE.z).normalize();
const ANTARCTIC_SPLASH_RADIUS = 19660;
const OUTER_LANDING_RADIUS = 22600;

const SUN_ALTITUDE_KM = 6000;
const SUN_ORBIT_RADIUS = 9600;
const MOON_ALTITUDE_KM = 5000;
const MOON_ORBIT_RADIUS = 10600;
const ISS_ALTITUDE_KM = 400;
const ISS_ORBIT_RADIUS = 8200;

const ROCKET_HEIGHT_KM = 0.115; // 115 meters
const ROCKET_HALF_H = ROCKET_HEIGHT_KM * 0.5;
const MAX_PARTICLES = 3200;
const MAX_TRAIL_POINTS = 320;
const MAX_SPLASH_RINGS = 8;

// Pre-allocated scratch math objects (zero GC in animation loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _origin = new THREE.Vector3(0, 0, 0);
const _dir = new THREE.Vector3();
const _nozzleWorld = new THREE.Vector3();
const _rocketUp = new THREE.Vector3();
const _qDelta = new THREE.Quaternion();
const _baseQuat = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _euler = new THREE.Euler();

interface DebrisPiece {
  mesh: THREE.Group;
  sprayMesh: THREE.Mesh;
  sprayMat: THREE.ShaderMaterial;
  flareSprite: THREE.Sprite;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  angVel: THREE.Vector3;
  splashed: boolean;
  smokeTimer: number;
  glowAge: number;
}

interface SplashRing {
  mesh: THREE.Mesh;
  age: number;
  active: boolean;
}

interface ReptiloidNpc {
  group: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  tail: THREE.Mesh;
  baseX: number;
  baseZ: number;
  patrolRadius: number;
  speed: number;
  phase: number;
  isGuard: boolean;
}

type EffectiveWeather = 'clear' | 'rain' | 'storm' | 'snow' | 'sandstorm' | 'alien';

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function makeTextSprite(
  text: string,
  color = '#bae6fd',
  bg = 'rgba(5, 8, 17, 0.78)',
  scaleW = 6.4,
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(12, 12, canvas.width - 24, canvas.height - 24, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = '600 30px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleW, scaleW * (96 / 512), 1);
  return sprite;
}

function makeGlowSprite(innerRgba: string, midRgba: string): THREE.SpriteMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 2, 128, 128, 128);
  g.addColorStop(0, innerRgba);
  g.addColorStop(0.28, midRgba);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
}

export class FlatEarthScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private isSoftwareGl: boolean;

  private skyMesh!: THREE.Mesh;
  private skyMat!: THREE.ShaderMaterial;
  private starsPoints!: THREE.Points;
  private atmosphereLimbMesh!: THREE.Mesh;

  private mapTextures: AzimuthalMapTextures;
  private sunXZUniform = { value: new THREE.Vector2() };
  private sunPosUniform = { value: new THREE.Vector3() };
  private sunGroup!: THREE.Group;
  private moonGroup!: THREE.Group;
  private sunLight!: THREE.PointLight;
  private sunAngle = LAUNCH_ANGLE + Math.PI; // Opposite LAUNCH_SITE -> always dark side at launch!
  private moonAngle = LAUNCH_ANGLE + Math.PI * 0.25;

  private boundaryGroup: THREE.Group;
  private boundaryPlane38: THREE.Mesh;
  private boundaryPlane40: THREE.Mesh;

  // ISS (МКС) at 400 km altitude orbiting the Flat Earth
  private issGroup!: THREE.Group;
  private issOrbitRing!: THREE.LineLoop;
  private issBeaconSprite!: THREE.Sprite;
  private issLabelSprite!: THREE.Sprite;
  private issAngle = LAUNCH_ANGLE - 0.16;

  // Dual-pass interior cockpit & ISS Cupola observatory for rotatable online broadcasts
  private interiorScene!: THREE.Scene;
  private interiorCamera!: THREE.PerspectiveCamera;
  private interiorControls!: OrbitControls;
  private rocketCabinGroup!: THREE.Group;
  private issCupolaGroup!: THREE.Group;
  private cabinAstronauts: THREE.Group[] = [];
  private cabinAlertMat!: THREE.MeshBasicMaterial;
  private issAstronautGroup!: THREE.Group;
  private issMicArmGroup!: THREE.Group;

  private rocketGroup: THREE.Group;
  private nozzleGlowMesh: THREE.Mesh;
  private nozzleCoreLight: THREE.PointLight;
  private engineAnchor = new THREE.Object3D();

  // Engine-originating volumetric light-spray starburst + compact jellyfish plume shell
  private lightSprayMesh: THREE.Mesh;
  private lightSprayMat: THREE.ShaderMaterial;
  private jellyfishMesh: THREE.Mesh;
  private jellyfishMat: THREE.ShaderMaterial;
  private coreFlareSprite: THREE.Sprite;

  // Exhaust & debris smoke/water-spray particle system
  private particleGeom: THREE.BufferGeometry;
  private particleMat: THREE.ShaderMaterial;
  private particlePos: Float32Array;
  private particleVel: Float32Array;
  private particleAge: Float32Array;
  private particleLife: Float32Array;
  private particleSize: Float32Array;
  private particleTemp: Float32Array;
  private particleCursor = 0;

  // Serpentine atmospheric contrail
  private trailPoints: THREE.Vector3[] = [];
  private trailLineGeom: THREE.BufferGeometry;
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private trailLine: THREE.Points;

  // Failed-launch separated debris pieces + ocean splash rings
  private debrisPieces: DebrisPiece[] = [];
  private splashRings: SplashRing[] = [];
  private hasFailed = false;
  private plannedFailureAltKm: number | null = null;
  private splashedCount = 0;

  // Launch variant, Antarctic UFO intercept & Outer-Lands Parachute breakout state
  private activeVariant: ActiveLaunchVariant = 'zero_g';
  private antarcticOutcome: AntarcticOutcome = 'ufo_intercept';
  private antarcticaLaunchCount = 0;
  private antarcticSplashed = false;
  private antarcticSplashTime = 0;
  private antarcticWaterTimer = 0;
  private ufoInterceptActive = false;
  private outerBreakoutActive = false;
  private parachuteDescentActive = false;
  private outerLandedActive = false;
  private outerLandingTime = 0;
  private ufoIncinerated = false;
  private ufoIncinerateTime = 0;

  // Clouds, UFO Flying Saucers, Parachute Capsule & EVA Astronauts
  private cloudLayerMesh!: THREE.Mesh;
  private cloudLowLayerMesh!: THREE.Mesh;
  private localCloudGroup!: THREE.Group;
  private ufoFleet: {
    group: THREE.Group;
    beam: THREE.Mesh;
    impactRing: THREE.Mesh;
    offset: THREE.Vector3;
  }[] = [];
  private capsuleGroup!: THREE.Group;
  private parachuteCanopy!: THREE.Group;
  private capsuleLandingPos = new THREE.Vector3();
  private capsuleBodyMat!: THREE.MeshStandardMaterial;
  private evaAstronauts: THREE.Group[] = [];
  private evaSpeechSprites: THREE.Sprite[] = [];
  private scorchGlowSprite!: THREE.Sprite;

  // Interactive broadcast dialogues
  private onDialogue?: (d: BroadcastDialogue) => void;
  private dialogueFlags = new Set<string>();
  private issTalkTimer = 0;
  private issLineIndex = 0;
  private issTalkPulseUntil = 0;

  // Pedestrian mode, multi-continent settlements & arbitrary map-drop
  private earthTopMesh!: THREE.Mesh;
  private earthIceWall!: THREE.Mesh;
  private earthLocalSpaceportPatch!: THREE.Mesh;
  private mapMarkersGroup!: THREE.Group;
  private mapPinHitMeshes: THREE.Mesh[] = [];
  private activePedMapPin!: THREE.Group;
  private localSettlementGroup!: THREE.Group;
  private settlementCenter = new THREE.Vector3();
  private settlementRadiusKm = 0.62;
  private isOceanPlatform = false;
  private currentPlace: WorldPlace | null = null;
  private currentSurface: SurfaceSampleType = 'land';
  private reptiloidNpcs: ReptiloidNpc[] = [];
  private cityHoverObjects: { obj: THREE.Object3D; baseY: number; phase: number; orbitR: number; speed: number }[] = [];
  private reptiloidGreeted = false;

  // Pedestrian Local Weather System (rain, storm, snow, sandstorm, alien emerald mist)
  private weatherMode: WeatherMode = 'auto';
  private effectiveWeather: EffectiveWeather = 'clear';
  private weatherGroup!: THREE.Group;
  private weatherPoints!: THREE.Points;
  private weatherPos!: Float32Array;
  private weatherSeeds!: Float32Array;
  private weatherLightningTimer = 0;
  private weatherFlashAlpha = 0;

  private pedestrianGroup!: THREE.Group;
  private pedLeftLeg!: THREE.Mesh;
  private pedRightLeg!: THREE.Mesh;
  private pedLeftArm!: THREE.Mesh;
  private pedRightArm!: THREE.Mesh;
  private pedPos = new THREE.Vector3();
  private pedYaw = 0;
  private pedWalkPhase = 0;
  private pedMoveVec = new THREE.Vector2();
  private pedSprint = false;
  private dropPinMode = false;
  private mapSelection: MapPinPreview | null = null;
  private pedMeta = {
    name: 'Москва',
    region: 'Россия · Столица',
    coords: '55.8° с.ш., 37.6° в.д.',
  };
  private keyState: Record<string, boolean> = {};
  private pointerDownPt: { x: number; y: number } | null = null;
  private pedRaycaster = new THREE.Raycaster();
  private pedPointerNdc = new THREE.Vector2();

  // State
  private params: SimulationParams;
  private focusMode: CameraFocusMode = 'rocket';
  private onTelemetry: (t: TelemetryState) => void;
  private isLaunching = false;
  private missionTime = 0;
  private launchCount = 0;
  private rocketPos = new THREE.Vector3();
  private rocketVel = new THREE.Vector3();
  private rocketQuat = new THREE.Quaternion();
  private angularVel = new THREE.Vector3();
  private tumbleSeed = 1.0;
  private prevTrackTarget = new THREE.Vector3();
  private hasTrackTarget = false;

  // Smooth camera offset transition (relative to moving target so pinch-zoom never loses rocket/ISS!)
  private camTransitionActive = false;
  private camDesiredOffset = new THREE.Vector3();
  private camStaticTarget = new THREE.Vector3();

  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private lastTelemetryEmit = 0;
  private windPhase = 0;

  private disposables: { dispose: () => void }[] = [];

  constructor(
    container: HTMLElement,
    initialParams: SimulationParams,
    onTelemetry: (t: TelemetryState) => void,
    onDialogue?: (d: BroadcastDialogue) => void,
  ) {
    this.container = container;
    this.params = { ...initialParams };
    this.onTelemetry = onTelemetry;
    this.onDialogue = onDialogue;
    this.isSoftwareGl = detectSoftwareWebGL();

    // 1. Renderer with logarithmicDepthBuffer for true 115 m rocket vs 28,000 km Earth proportions
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });

    // 2. Scene (no distance fog clipping so the dark night sky and outer disc never flicker!)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050811');

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.disposables.push(envTex);
    pmrem.dispose();

    // 3. Camera & OrbitControls
    const aspect = Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(48, aspect, 0.02, 220000);
    this.camera.position.copy(LAUNCH_SITE).add(new THREE.Vector3(0.32, 0.16, 0.34));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = true;
    this.controls.minDistance = 0.07; // 70 m close-up on engine nozzle
    this.controls.maxDistance = 68000; // Full Flat Earth overview
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.copy(LAUNCH_SITE).add(new THREE.Vector3(0, ROCKET_HALF_H, 0));

    // When user pinches/drags/zooms, cancel preset animation ONLY; NEVER stop tracking rocket target!
    this.controls.addEventListener('start', () => {
      this.camTransitionActive = false;
    });

    // 4. Lighting: subtle starlight/moonlight ambient on night side + warm Sun light at 6000 km
    const hemiLight = new THREE.HemisphereLight('#5c7ba6', '#0c1220', 0.42);
    this.scene.add(hemiLight);

    const launchFill = new THREE.DirectionalLight('#93c5fd', 0.45);
    launchFill.position.set(LAUNCH_SITE.x + 10, 14, LAUNCH_SITE.z + 8);
    launchFill.target.position.copy(LAUNCH_SITE);
    this.scene.add(launchFill.target);
    this.scene.add(launchFill);

    // 5. Flicker-free Sky Dome & Starfield (centered on camera with depthTest: false)
    this.buildSkyAndStars();

    // 6. Real-Scale 28,000 km Azimuthal Flat Earth + Sun (6000 km) + Moon (5000 km)
    this.mapTextures = createAzimuthalMapTextures(
      this.renderer.capabilities.getMaxAnisotropy(),
      this.params.outerLandsVisibility,
    );
    this.buildFlatEarthModel();
    this.buildMapPlaceMarkers();
    this.buildPedestrianActor();
    this.teleportPedestrianToPlace('moscow', false);
    this.buildSunAndMoon();
    this.updateCelestialBodies(0);

    // 7. 38–40 km Zero-Gravity Boundary & Altitude Mast
    const boundary = this.buildZeroGBoundary();
    this.boundaryGroup = boundary.group;
    this.boundaryPlane38 = boundary.plane38;
    this.boundaryPlane40 = boundary.plane40;
    this.updateBoundaryPositions();

    // 8. 115 m Rectangular Rocket + Nozzle Engine + Breakup Debris + Ocean Splashes
    const rocketBuilt = this.buildRocket();
    this.rocketGroup = rocketBuilt.group;
    this.nozzleGlowMesh = rocketBuilt.nozzleGlow;
    this.nozzleCoreLight = rocketBuilt.coreLight;
    this.buildDebrisAndSplashes();

    // 9. Engine-Originating Light Spray + Compact Jellyfish Plume + Particles + Contrail
    const jellyBuilt = this.buildJellyfishAndLightSpray();
    this.lightSprayMesh = jellyBuilt.lightSprayMesh;
    this.lightSprayMat = jellyBuilt.lightSprayMat;
    this.jellyfishMesh = jellyBuilt.jellyfishMesh;
    this.jellyfishMat = jellyBuilt.jellyfishMat;
    this.coreFlareSprite = jellyBuilt.coreFlare;

    const particlesBuilt = this.buildExhaustParticles();
    this.particleGeom = particlesBuilt.geom;
    this.particleMat = particlesBuilt.mat;
    this.particlePos = particlesBuilt.pos;
    this.particleVel = particlesBuilt.vel;
    this.particleAge = particlesBuilt.age;
    this.particleLife = particlesBuilt.life;
    this.particleSize = particlesBuilt.size;
    this.particleTemp = particlesBuilt.temp;

    const trailBuilt = this.buildContrail();
    this.trailLineGeom = trailBuilt.geom;
    this.trailPositions = trailBuilt.positions;
    this.trailColors = trailBuilt.colors;
    this.trailLine = trailBuilt.points;

    // 10. Atmospheric Clouds + Pedestrian Weather System + UFOs + Capsule
    this.buildAtmosphericClouds();
    this.buildWeatherParticles();
    this.buildUfosAndCapsule();

    // 11. ISS (МКС) at 400 km circular orbit + Dual-Pass Interior Live Broadcasts
    this.buildISS();
    this.updateISS(0);
    this.buildInteriorStudios(envTex, aspect);

    this.resetSimulation();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
      this.renderer.compile(this.interiorScene, this.interiorCamera);
    }

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.renderer.domElement.addEventListener('pointerdown', this.handleCanvasPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handleCanvasPointerUp);
    this.startLoop();
  }

  private buildSkyAndStars() {
    // Camera-centered background sky dome with ISS Rayleigh blue horizon limb & weather tint support
    const skyGeom = new THREE.SphereGeometry(500, 32, 24);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      uniforms: {
        uOrbitalMix: { value: 0.0 },
        uWeatherDim: { value: 0.0 },
        uFlash: { value: 0.0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOrbitalMix;
        uniform float uWeatherDim;
        uniform float uFlash;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.25, 1.0);
          // Ground / low-altitude sky gradient
          vec3 groundZenith = vec3(0.016, 0.025, 0.058);
          vec3 groundMid = vec3(0.052, 0.082, 0.165);
          vec3 groundHoriz = vec3(0.165, 0.195, 0.275);
          vec3 groundCol = mix(groundHoriz, groundMid, smoothstep(-0.04, 0.22, h));
          groundCol = mix(groundCol, groundZenith, smoothstep(0.18, 0.72, h));

          // ISS 400 km Orbital Horizon: pitch-black space + razor-thin bright Rayleigh azure limb!
          vec3 spaceBlack = vec3(0.008, 0.012, 0.024);
          vec3 limbDeep = vec3(0.075, 0.24, 0.56);
          vec3 limbBright = vec3(0.46, 0.75, 0.98);
          float limbBand = exp(-pow(max(0.0, h + 0.015) / 0.055, 1.85));
          float upperBlue = exp(-pow(max(0.0, h) / 0.115, 1.5)) * 0.45;
          vec3 orbitCol = spaceBlack + limbDeep * upperBlue + limbBright * limbBand * 0.92;

          vec3 col = mix(groundCol, orbitCol, clamp(uOrbitalMix, 0.0, 1.0));
          col = mix(col, vec3(0.08, 0.10, 0.14), clamp(uWeatherDim, 0.0, 0.78));
          col += vec3(0.55, 0.68, 0.92) * clamp(uFlash, 0.0, 1.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyMesh = new THREE.Mesh(skyGeom, this.skyMat);
    this.skyMesh.renderOrder = -100;
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);
    this.disposables.push(skyGeom, this.skyMat);

    // Crisp camera-centered starfield
    const starCount = 1400;
    const starPos = new Float32Array(starCount * 3);
    const starCol = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.03 + Math.random() * 0.97);
      const r = 420;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const b = 0.45 + Math.random() * 0.55;
      starCol[i * 3] = b * 0.88;
      starCol[i * 3 + 1] = b * 0.94;
      starCol[i * 3 + 2] = b;
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.starsPoints = new THREE.Points(starGeom, starMat);
    this.starsPoints.renderOrder = -99;
    this.starsPoints.frustumCulled = false;
    this.scene.add(this.starsPoints);
    this.disposables.push(starGeom, starMat);
  }

  /**
   * Injects half-Earth solar day/night terminator shading into MeshStandardMaterial
   * so the Sun at 6000 km illuminates strictly half the Earth while the launch side stays dark.
   */
  private applyHalfEarthDayNightShader(
    mat: THREE.MeshStandardMaterial,
    nightLightsMap?: THREE.Texture,
    isCloudLayer = false,
  ) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunXZ = this.sunXZUniform;
      shader.uniforms.uHasNightMap = { value: nightLightsMap ? 1.0 : 0.0 };
      shader.uniforms.uNightMap = { value: nightLightsMap ?? null };
      shader.uniforms.uIsCloud = { value: isCloudLayer ? 1.0 : 0.0 };
      shader.vertexShader =
        `varying vec2 vEarthWorldXZ;\nvarying vec2 vEarthUv;\n` +
        shader.vertexShader
          .replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            vEarthUv = uv;
            `,
          )
          .replace(
            '#include <worldpos_vertex>',
            `
            #include <worldpos_vertex>
            vEarthWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
            `,
          );
      shader.fragmentShader =
        `uniform vec2 uSunXZ;\nuniform float uHasNightMap;\nuniform sampler2D uNightMap;\nuniform float uIsCloud;\nvarying vec2 vEarthWorldXZ;\nvarying vec2 vEarthUv;\n` +
        shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
          vec2 sunDir = normalize(uSunXZ + vec2(0.0001));
          float hemiDot = dot(vEarthWorldXZ, sunDir);
          float distSun = length(vEarthWorldXZ - uSunXZ);
          // Half-disc day mask + local solar spotlight cone from 6000 km altitude
          float hemiMask = smoothstep(-2800.0, 2600.0, hemiDot);
          float spotMask = 1.0 - smoothstep(10500.0, 17500.0, distSun);
          float dayFactor = clamp(hemiMask * 0.72 + spotMask * 0.52, 0.0, 1.0);
          float twilight = exp(-pow(hemiDot / 2400.0, 2.0)) * 0.16;

          vec3 nightTint = gl_FragColor.rgb * (uIsCloud > 0.5 ? 0.12 : 0.22);
          vec3 dayTint = gl_FragColor.rgb * (uIsCloud > 0.5 ? 1.06 : 1.2);
          vec3 twilightWarm = vec3(0.32, 0.18, 0.10) * twilight;
          vec3 atmoBlue = vec3(0.08, 0.28, 0.62) * dayFactor * (uIsCloud > 0.5 ? 0.03 : 0.07);

          vec3 litResult = mix(nightTint, dayTint, dayFactor) + twilightWarm + atmoBlue;
          if (uHasNightMap > 0.5) {
            vec3 cityGlow = texture2D(uNightMap, vEarthUv).rgb;
            float nightFactor = pow(1.0 - dayFactor, 1.6);
            litResult += cityGlow * nightFactor * 1.45;
          }

          gl_FragColor.rgb = litResult;
          #include <dithering_fragment>
          `,
        );
    };
  }

  private buildFlatEarthModel() {
    const earthGroup = new THREE.Group();

    const topGeom = new THREE.CircleGeometry(DISC_RADIUS, 180);
    topGeom.rotateX(-Math.PI / 2);
    const topMat = new THREE.MeshStandardMaterial({
      map: this.mapTextures.colorMap,
      bumpMap: this.mapTextures.bumpMap,
      bumpScale: 35,
      roughness: 0.82,
      metalness: 0.06,
    });
    this.applyHalfEarthDayNightShader(topMat, this.mapTextures.nightLightsMap, false);
    const topMesh = new THREE.Mesh(topGeom, topMat);
    topMesh.receiveShadow = true;
    this.earthTopMesh = topMesh;
    earthGroup.add(topMesh);

    // Open-ended rim wall strictly below y = -8 so ZERO overlap or Z-fighting with top surface!
    const rimGeom = new THREE.CylinderGeometry(DISC_RADIUS, DISC_RADIUS * 1.003, 900, 140, 1, true);
    const rimMat = new THREE.MeshStandardMaterial({
      color: '#0c1424',
      roughness: 0.9,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    const rimMesh = new THREE.Mesh(rimGeom, rimMat);
    rimMesh.position.y = -458;
    earthGroup.add(rimMesh);
    this.disposables.push(topGeom, topMat, rimGeom, rimMat);

    // 3D Sculpted Antarctic Ice Wall Ring (at 20,000 - 21,200 km)
    const iceInner = DISC_RADIUS * ICE_INNER_NORM;
    const iceOuter = DISC_RADIUS * ICE_OUTER_NORM;
    const iceProfile = [
      new THREE.Vector2(iceInner, 0.0),
      new THREE.Vector2(iceInner + 80, 12),
      new THREE.Vector2((iceInner + iceOuter) * 0.5, 18),
      new THREE.Vector2(iceOuter - 80, 11),
      new THREE.Vector2(iceOuter, 0.0),
    ];
    const iceGeom = new THREE.LatheGeometry(iceProfile, 160);
    const iceMat = new THREE.MeshStandardMaterial({
      color: '#d9ecfb',
      roughness: 0.45,
      metalness: 0.05,
    });
    this.applyHalfEarthDayNightShader(iceMat);
    const iceWall = new THREE.Mesh(iceGeom, iceMat);
    this.earthIceWall = iceWall;
    earthGroup.add(iceWall);
    this.disposables.push(iceGeom, iceMat);

    // Local 16 km Coastal Spaceport Patch around LAUNCH_SITE
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const localTex = createCoastalSpaceportTexture(maxAniso);
    const localGeom = new THREE.CircleGeometry(8.5, 64);
    localGeom.rotateX(-Math.PI / 2);
    const angleToDownrange = Math.atan2(-DOWNRANGE_DIR.z, DOWNRANGE_DIR.x);
    localGeom.rotateY(angleToDownrange);
    const localMat = new THREE.MeshStandardMaterial({
      map: localTex,
      transparent: true,
      roughness: 0.8,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.applyHalfEarthDayNightShader(localMat);
    const localPatch = new THREE.Mesh(localGeom, localMat);
    localPatch.position.set(LAUNCH_SITE.x, 0.002, LAUNCH_SITE.z);
    localPatch.receiveShadow = true;
    this.earthLocalSpaceportPatch = localPatch;
    earthGroup.add(localPatch);
    this.disposables.push(localTex, localGeom, localMat);

    // Launch Pad Concrete Plinth & 125 m Service Tower
    const padGroup = new THREE.Group();
    padGroup.position.set(LAUNCH_SITE.x, 0.004, LAUNCH_SITE.z);

    const padBaseGeom = new THREE.BoxGeometry(0.11, 0.008, 0.11);
    const padBaseMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.78,
      metalness: 0.35,
    });
    const padBase = new THREE.Mesh(padBaseGeom, padBaseMat);
    padBase.position.y = 0.004;
    padBase.receiveShadow = true;
    padGroup.add(padBase);

    const towerGeom = new THREE.BoxGeometry(0.014, 0.125, 0.014);
    const towerMat = new THREE.MeshStandardMaterial({
      color: '#64748b',
      roughness: 0.6,
      metalness: 0.55,
    });
    const tower = new THREE.Mesh(towerGeom, towerMat);
    tower.position.set(-0.036, 0.0625, 0);
    tower.castShadow = true;
    padGroup.add(tower);

    earthGroup.add(padGroup);
    this.disposables.push(padBaseGeom, padBaseMat, towerGeom, towerMat);

    this.scene.add(earthGroup);
  }

  private buildMapPlaceMarkers() {
    this.mapMarkersGroup = new THREE.Group();
    this.mapMarkersGroup.visible = false;
    this.mapPinHitMeshes = [];

    const pinStemGeom = new THREE.CylinderGeometry(18, 8, 280, 10);
    const pinHeadGeom = new THREE.SphereGeometry(56, 14, 12);
    const pinHitGeom = new THREE.SphereGeometry(320, 8, 8);
    const pinHitMat = new THREE.MeshBasicMaterial({ visible: false });
    const cityMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
    const villageMat = new THREE.MeshBasicMaterial({ color: '#4ade80' });
    const outerMat = new THREE.MeshBasicMaterial({ color: '#f59e0b' });
    const reptiloidMat = new THREE.MeshBasicMaterial({ color: '#10b981' });
    this.disposables.push(
      pinStemGeom,
      pinHeadGeom,
      pinHitGeom,
      pinHitMat,
      cityMat,
      villageMat,
      outerMat,
      reptiloidMat,
    );

    for (const place of WORLD_PLACES) {
      const pos = getPlaceWorldPosition(place, DISC_RADIUS);
      const pin = new THREE.Group();
      pin.position.set(pos.x, 0, pos.z);

      const mat =
        place.landmark === 'reptiloid'
          ? reptiloidMat
          : place.type === 'outer'
            ? outerMat
            : place.type === 'village'
              ? villageMat
              : cityMat;
      const stem = new THREE.Mesh(pinStemGeom, mat);
      stem.position.y = 140;
      pin.add(stem);

      const head = new THREE.Mesh(pinHeadGeom, mat);
      head.position.y = 290;
      pin.add(head);

      const hit = new THREE.Mesh(pinHitGeom, pinHitMat);
      hit.position.y = 180;
      hit.userData.placeId = place.id;
      pin.add(hit);
      this.mapPinHitMeshes.push(hit);

      const isImportant =
        place.id === 'moscow' ||
        place.id === 'stupino' ||
        place.id === 'washington' ||
        place.id === 'cairo' ||
        place.id === 'sydney' ||
        place.id === 'tokyo' ||
        place.id === 'rio' ||
        place.id === 'africa_village' ||
        place.id === 'reptiloid_city' ||
        place.id === 'outer_outpost';
      if (isImportant) {
        const lbl = makeTextSprite(
          place.name,
          place.landmark === 'reptiloid'
            ? '#6ee7b7'
            : place.type === 'village'
              ? '#86efac'
              : place.type === 'outer'
                ? '#fde68a'
                : '#bae6fd',
          'rgba(5, 8, 17, 0.85)',
          place.landmark === 'reptiloid' ? 1050 : 880,
        );
        lbl.position.y = 480;
        pin.add(lbl);
        this.disposables.push(lbl.material.map!, lbl.material);
      }
      this.mapMarkersGroup.add(pin);
    }

    // Active pedestrian location beacon on the map
    this.activePedMapPin = new THREE.Group();
    const ringGeom = new THREE.RingGeometry(180, 260, 32);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#facc15',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    ringMesh.position.y = 18;
    const beaconColGeom = new THREE.CylinderGeometry(24, 24, 900, 12);
    const beaconColMat = new THREE.MeshBasicMaterial({
      color: '#fde047',
      transparent: true,
      opacity: 0.72,
    });
    const beaconCol = new THREE.Mesh(beaconColGeom, beaconColMat);
    beaconCol.position.y = 450;
    this.activePedMapPin.add(ringMesh, beaconCol);
    this.mapMarkersGroup.add(this.activePedMapPin);
    this.disposables.push(ringGeom, ringMat, beaconColGeom, beaconColMat);

    this.scene.add(this.mapMarkersGroup);

    this.localSettlementGroup = new THREE.Group();
    this.localSettlementGroup.visible = false;
    this.scene.add(this.localSettlementGroup);
  }

  private buildPedestrianActor() {
    this.pedestrianGroup = new THREE.Group();

    const jacketMat = new THREE.MeshStandardMaterial({
      color: '#0ea5e9',
      roughness: 0.45,
      emissive: '#0369a1',
      emissiveIntensity: 0.35,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: '#fde047',
      roughness: 0.35,
      emissive: '#facc15',
      emissiveIntensity: 0.65,
    });
    const pantsMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.78 });
    const skinMat = new THREE.MeshStandardMaterial({ color: '#f1c29b', roughness: 0.65 });
    const capMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.6 });

    // Torso
    const torsoGeom = new THREE.BoxGeometry(0.00056, 0.00072, 0.00034);
    const torso = new THREE.Mesh(torsoGeom, jacketMat);
    torso.position.y = 0.00128;
    torso.castShadow = true;
    this.pedestrianGroup.add(torso);

    // High-vis vest stripe
    const stripeGeom = new THREE.BoxGeometry(0.00058, 0.00014, 0.00036);
    const stripe = new THREE.Mesh(stripeGeom, stripeMat);
    stripe.position.y = 0.00126;
    this.pedestrianGroup.add(stripe);

    // Head + Explorer cap
    const headGeom = new THREE.SphereGeometry(0.00021, 12, 10);
    const head = new THREE.Mesh(headGeom, skinMat);
    head.position.y = 0.00188;
    this.pedestrianGroup.add(head);

    const capGeom = new THREE.CylinderGeometry(0.00022, 0.00023, 0.00012, 12);
    const cap = new THREE.Mesh(capGeom, capMat);
    cap.position.y = 0.00202;
    this.pedestrianGroup.add(cap);

    // Articulated Legs (translated so pivot is at hip y = 0.00092)
    const legGeom = new THREE.BoxGeometry(0.0002, 0.0009, 0.00022);
    legGeom.translate(0, -0.00045, 0);
    this.pedLeftLeg = new THREE.Mesh(legGeom, pantsMat);
    this.pedLeftLeg.position.set(-0.00015, 0.00092, 0);
    this.pedRightLeg = new THREE.Mesh(legGeom, pantsMat);
    this.pedRightLeg.position.set(0.00015, 0.00092, 0);
    this.pedestrianGroup.add(this.pedLeftLeg, this.pedRightLeg);

    // Articulated Arms (pivot at shoulder y = 0.00158)
    const armGeom = new THREE.BoxGeometry(0.00016, 0.00066, 0.00018);
    armGeom.translate(0, -0.00033, 0);
    this.pedLeftArm = new THREE.Mesh(armGeom, jacketMat);
    this.pedLeftArm.position.set(-0.00037, 0.00158, 0);
    this.pedRightArm = new THREE.Mesh(armGeom, jacketMat);
    this.pedRightArm.position.set(0.00037, 0.00158, 0);
    this.pedestrianGroup.add(this.pedLeftArm, this.pedRightArm);

    // Gentle local light so the pedestrian & surrounding street stay crisp on Earth's dark half
    const pedLight = new THREE.PointLight('#bae6fd', 0.45, 0.45, 1.4);
    pedLight.position.set(0, 0.035, 0);
    this.pedestrianGroup.add(pedLight);

    this.disposables.push(
      jacketMat,
      stripeMat,
      pantsMat,
      skinMat,
      capMat,
      torsoGeom,
      stripeGeom,
      headGeom,
      capGeom,
      legGeom,
      armGeom,
    );
    this.pedestrianGroup.visible = false;
    this.scene.add(this.pedestrianGroup);
  }

  private getPedGroundHeight(worldX: number, worldZ: number): number {
    const lx = worldX - this.settlementCenter.x;
    const lz = worldZ - this.settlementCenter.z;
    if (this.isOceanPlatform) {
      if (Math.abs(lx) <= 0.026 && Math.abs(lz) <= 0.026) {
        return 0.003;
      }
      return 0.0;
    }
    if (Math.hypot(lx, lz) <= 0.026) return 0.0007;
    if (Math.abs(lx) <= 0.006 || Math.abs(lz) <= 0.006) return 0.0004;
    return 0.0;
  }

  private clearLocalSettlement() {
    this.reptiloidNpcs = [];
    this.cityHoverObjects = [];
    this.localSettlementGroup.traverse((obj) => {
      const m = obj as THREE.Mesh | THREE.Sprite;
      if ('geometry' in m && m.geometry) {
        m.geometry.dispose();
      }
      const mat = m.material;
      if (Array.isArray(mat)) {
        mat.forEach((mm) => {
          if ('map' in mm && mm.map) (mm.map as THREE.Texture).dispose();
          mm.dispose();
        });
      } else if (mat) {
        if ('map' in mat && (mat as THREE.SpriteMaterial).map) {
          (mat as THREE.SpriteMaterial).map?.dispose();
        }
        mat.dispose();
      }
    });
    this.localSettlementGroup.clear();
  }

  private rebuildLocalSettlement(
    x: number,
    z: number,
    place: WorldPlace | null,
    surface: SurfaceSampleType,
  ) {
    this.clearLocalSettlement();
    this.settlementCenter.set(x, 0, z);
    this.localSettlementGroup.position.set(x, 0, z);
    this.isOceanPlatform = !place && surface === 'ocean';
    this.currentPlace = place;
    this.currentSurface = surface;
    this.reptiloidGreeted = false;
    this.refreshEffectiveWeather();

    const gColor =
      place?.palette.ground ??
      (surface === 'ocean'
        ? '#0d3b66'
        : surface === 'ice'
          ? '#d8ecfc'
          : surface === 'desert'
            ? '#b8945a'
            : surface === 'outer'
              ? '#496b5d'
              : '#4a6b46');
    const horizonColor =
      !place && surface === 'ocean'
        ? '#0a294d'
        : surface === 'desert'
          ? '#967646'
          : surface === 'ice'
            ? '#b4cde2'
            : '#23342c';
    const roadColor =
      place?.palette.road ??
      (surface === 'desert' ? '#8c6d46' : surface === 'ice' ? '#94b8d7' : '#475569');
    const wallColor = place?.palette.wall ?? '#e2e8f0';
    const roofColor = place?.palette.roof ?? '#9a3412';
    const foliageColor = place?.palette.foliage ?? '#2e6a3a';
    const accentColor = place?.palette.accent ?? '#f59e0b';

    const horizonMat = new THREE.MeshStandardMaterial({
      color: horizonColor,
      roughness: 0.95,
      metalness: 0.02,
    });
    const groundMat = new THREE.MeshStandardMaterial({
      color: gColor,
      roughness: 0.9,
      metalness: 0.04,
    });
    const roadMat = new THREE.MeshStandardMaterial({
      color: roadColor,
      roughness: 0.86,
    });
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.72 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      roughness: 0.25,
      metalness: 0.65,
      emissive: '#0284c7',
      emissiveIntensity: 0.28,
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.68 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.4,
      emissive: accentColor,
      emissiveIntensity: 0.25,
    });
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.82 });
    const windowGlowMat = new THREE.MeshStandardMaterial({
      color: '#fde68a',
      emissive: '#fbbf24',
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });

    // Local HemisphereLight + overhead warm light (no target needed -> clean shading anywhere on Earth)
    const localHemi = new THREE.HemisphereLight('#e2e8f0', '#2b394a', 1.05);
    this.localSettlementGroup.add(localHemi);
    const localWarmLight = new THREE.PointLight('#fde68a', 0.65, 1.1, 1.2);
    localWarmLight.position.set(0, 0.09, 0);
    this.localSettlementGroup.add(localWarmLight);

    const R = this.settlementRadiusKm;

    // 14 km local horizon terrain apron centered on settlement (eliminates 28,000 km disc float32 clipping jitter)
    const horizonApron = new THREE.Mesh(
      new THREE.CircleGeometry(14, 56).rotateX(-Math.PI / 2),
      horizonMat,
    );
    horizonApron.position.y = -0.025;
    this.localSettlementGroup.add(horizonApron);

    if (this.isOceanPlatform) {
      // Arbitrary drop on open ocean -> Floating Scientific Expedition Platform + Boat + Lighthouse!
      const seaPatch = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R * 1.04, 0.02, 48),
        groundMat,
      );
      seaPatch.position.y = -0.01; // top face cleanly at y = 0.0
      this.localSettlementGroup.add(seaPatch);

      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(0.052, 0.003, 0.052),
        new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.7 }),
      );
      deck.position.y = 0.0015; // top face cleanly at y = 0.003
      this.localSettlementGroup.add(deck);

      // Helipad circle cleanly raised 0.2m above deck (y = 0.0032)
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.0004, 24),
        new THREE.MeshStandardMaterial({ color: '#eab308', roughness: 0.5 }),
      );
      pad.position.set(-0.012, 0.0032, 0.008);
      this.localSettlementGroup.add(pad);

      // Research station module & Lighthouse tower
      const lab = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.007, 0.012), wallMat);
      lab.position.set(0.01, 0.0065, -0.008);
      this.localSettlementGroup.add(lab);

      const lightHouse = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0034, 0.026, 12), wallMat);
      lightHouse.position.set(0.018, 0.016, 0.016);
      this.localSettlementGroup.add(lightHouse);

      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 10, 8), windowGlowMat);
      beacon.position.set(0.018, 0.03, 0.016);
      this.localSettlementGroup.add(beacon);

      // Expedition Boat docked nearby
      const boatHull = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.003, 0.022), roofMat);
      boatHull.position.set(-0.036, 0.0015, -0.012);
      const boatCabin = new THREE.Mesh(new THREE.BoxGeometry(0.0055, 0.004, 0.008), wallMat);
      boatCabin.position.set(-0.036, 0.005, -0.012);
      this.localSettlementGroup.add(boatHull, boatCabin);

      const label = makeTextSprite('Океанская станция', '#7dd3fc', 'rgba(5, 8, 17, 0.84)', 0.055);
      label.position.set(0, 0.042, 0);
      this.localSettlementGroup.add(label);
      return;
    }

    // Solid 3D terrain disc with top face strictly at y = 0.0 (zero coplanar overlap!)
    const groundDisk = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 1.04, 0.024, 48),
      groundMat,
    );
    groundDisk.position.y = -0.012;
    this.localSettlementGroup.add(groundDisk);

    // Non-overlapping solid 3D road slabs (top face at y = 0.0004)
    const halfLen = R * 0.92;
    const roadNS = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.0004, halfLen * 2), roadMat);
    roadNS.position.set(0, 0.0002, 0);

    const wingLen = halfLen - 0.006;
    const wingCenter = 0.006 + wingLen * 0.5;
    const roadWest = new THREE.Mesh(new THREE.BoxGeometry(wingLen, 0.0004, 0.012), roadMat);
    roadWest.position.set(-wingCenter, 0.0002, 0);
    const roadEast = new THREE.Mesh(new THREE.BoxGeometry(wingLen, 0.0004, 0.012), roadMat);
    roadEast.position.set(wingCenter, 0.0002, 0);
    this.localSettlementGroup.add(roadNS, roadWest, roadEast);

    // Raised stone plaza cylinder cleanly above roads (top face at y = 0.0007)
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.0007, 32), roadMat);
    plaza.position.y = 0.00035;
    this.localSettlementGroup.add(plaza);

    // Helper to add a building anchored flush into ground with warm night windows
    const addBuilding = (
      bx: number,
      bz: number,
      bw: number,
      bh: number,
      bd: number,
      mat: THREE.Material,
      pitchedRoof = false,
    ) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
      box.position.set(bx, bh * 0.5, bz);
      this.localSettlementGroup.add(box);
      if (pitchedRoof) {
        const rf = new THREE.Mesh(new THREE.ConeGeometry(Math.max(bw, bd) * 0.78, bh * 0.48, 4), roofMat);
        rf.rotation.y = Math.PI / 4;
        rf.position.set(bx, bh + bh * 0.24, bz);
        this.localSettlementGroup.add(rf);
      }
      // Glowing night window strip
      const win = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.02, bh * 0.24, bd * 1.02), windowGlowMat);
      win.position.set(bx, bh * 0.58, bz);
      this.localSettlementGroup.add(win);
    };

    // Helper to add biome tree (birch/pine/palm/acacia)
    const addTree = (tx: number, tz: number, hScale = 1.0) => {
      const th = 0.0045 * hScale;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0007, th, 6), trunkMat);
      trunk.position.set(tx, 0.001 + th * 0.5, tz);
      this.localSettlementGroup.add(trunk);

      const biome = place?.biome ?? (surface === 'desert' ? 'desert' : 'temperate');
      if (biome === 'taiga') {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.0024 * hScale, th * 1.6, 7), leafMat);
        cone.position.set(tx, 0.001 + th * 1.25, tz);
        this.localSettlementGroup.add(cone);
      } else if (biome === 'savanna' || biome === 'desert') {
        const canopy = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0038 * hScale, 0.0014 * hScale, th * 0.45, 8),
          leafMat,
        );
        canopy.position.set(tx, 0.001 + th * 1.05, tz);
        this.localSettlementGroup.add(canopy);
      } else {
        const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.0026 * hScale, 0), leafMat);
        crown.position.set(tx, 0.001 + th * 1.15, tz);
        this.localSettlementGroup.add(crown);
      }
    };

    // Helper for streetlamps along avenues
    const lampPoleMat = new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.7 });
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const off = i * 0.055;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.00025, 0.0003, 0.0055, 6), lampPoleMat);
      pole.position.set(off, 0.00375, 0.0075);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.00065, 6, 6), windowGlowMat);
      bulb.position.set(off, 0.0067, 0.0075);
      this.localSettlementGroup.add(pole, bulb);
    }

    // Landmark & settlement architecture
    const lm = place?.landmark;
    const sType = place?.type ?? (surface === 'ice' ? 'outer' : 'village');

    if (lm === 'kremlin') {
      // Москва: Кремлёвская стена, Спасская башня, золотые купола и небоскрёбы Москва-Сити
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.012, 0.055),
        new THREE.MeshStandardMaterial({ color: '#881337', roughness: 0.75 }),
      );
      wall.position.set(-0.06, 0.007, -0.055);
      this.localSettlementGroup.add(wall);

      const spasskaya = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.052, 0.012),
        new THREE.MeshStandardMaterial({ color: '#991b1b', roughness: 0.7 }),
      );
      spasskaya.position.set(-0.022, 0.027, -0.032);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.0085, 0.024, 4), roofMat);
      spire.rotation.y = Math.PI / 4;
      spire.position.set(-0.022, 0.065, -0.032);
      const star = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.0025, 0),
        new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#dc2626', emissiveIntensity: 1.4 }),
      );
      star.position.set(-0.022, 0.079, -0.032);
      this.localSettlementGroup.add(spasskaya, spire, star);

      // Golden cathedral domes
      for (let d = 0; d < 3; d++) {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 12, 10), accentMat);
        dome.position.set(-0.075 + d * 0.016, 0.02, -0.06);
        this.localSettlementGroup.add(dome);
      }

      // Moscow-City skyscrapers
      addBuilding(0.085, -0.075, 0.02, 0.115, 0.02, glassMat);
      addBuilding(0.115, -0.055, 0.018, 0.095, 0.018, glassMat);
      addBuilding(0.095, -0.032, 0.017, 0.078, 0.017, glassMat);
    } else if (lm === 'capitol') {
      // Вашингтон: Капитолий + Монумент Вашингтону + Белые здания
      const baseWing = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.016, 0.026), wallMat);
      baseWing.position.set(0, 0.009, -0.065);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.024, 18), wallMat);
      drum.position.set(0, 0.028, -0.065);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.0155, 18, 12), wallMat);
      dome.position.set(0, 0.04, -0.065);
      this.localSettlementGroup.add(baseWing, drum, dome);

      // Obelisk
      const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.0075, 0.145, 4), wallMat);
      obelisk.rotation.y = Math.PI / 4;
      obelisk.position.set(0.075, 0.073, 0.045);
      this.localSettlementGroup.add(obelisk);
    } else if (lm === 'pyramids') {
      // Каир / Гиза: 3 великие пирамиды
      const sandStoneMat = new THREE.MeshStandardMaterial({ color: '#d4a359', roughness: 0.85 });
      const specs: [number, number, number, number][] = [
        [-0.08, -0.085, 0.092, 0.115],
        [-0.175, -0.025, 0.078, 0.095],
        [-0.14, 0.075, 0.046, 0.055],
      ];
      for (const [px, pz, rad, h] of specs) {
        const pyr = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 4), sandStoneMat);
        pyr.rotation.y = Math.PI / 4;
        pyr.position.set(px, 0.001 + h * 0.5, pz);
        this.localSettlementGroup.add(pyr);
      }
    } else if (lm === 'opera') {
      // Сидней: бухта (солидный цилиндр без наложения на дороги) и белые паруса Оперного театра
      const harbor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.0006, 32),
        new THREE.MeshStandardMaterial({ color: '#0c4a6e', roughness: 0.25 }),
      );
      harbor.position.set(-0.26, 0.0003, -0.26);
      this.localSettlementGroup.add(harbor);

      for (let s = 0; s < 4; s++) {
        const sail = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.036 + (s % 2) * 0.012, 12), wallMat);
        sail.rotation.z = -0.25 + s * 0.08;
        sail.position.set(-0.075 + s * 0.016, 0.019, -0.068);
        this.localSettlementGroup.add(sail);
      }
    } else if (lm === 'tower') {
      // Париж / Токио: высокая решётчатая башня
      const tower = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.19, 4), accentMat);
      tower.rotation.y = Math.PI / 4;
      tower.position.set(-0.07, 0.096, -0.065);
      this.localSettlementGroup.add(tower);
    } else if (lm === 'outpost') {
      // Аванпост за Антарктидой
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), glassMat);
      dome.position.set(-0.055, 0.01, -0.05);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.002, 0.065, 8), accentMat);
      antenna.position.set(0.05, 0.033, -0.05);
      this.localSettlementGroup.add(dome, antenna);
    } else if (lm === 'reptiloid') {
      // ГОРОД РЕПТИЛОИДОВ ЗА АНТАРКТИДОЙ: обсидиановый Зиккурат, кристаллы, парящие диски и живые 3D-рептилоиды!
      const obsidianMat = new THREE.MeshStandardMaterial({ color: '#111d1a', roughness: 0.36, metalness: 0.65 });
      const goldMat = new THREE.MeshStandardMaterial({ color: '#eab308', roughness: 0.3, metalness: 0.85 });
      const emeraldMat = new THREE.MeshStandardMaterial({
        color: '#10b981',
        emissive: '#059669',
        emissiveIntensity: 1.35,
        roughness: 0.2,
      });

      // Glowing emerald ritual ring inlaid slightly above plaza
      const runeRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.021, 0.021, 0.0008, 32),
        emeraldMat,
      );
      runeRing.position.set(0, 0.00042, 0);
      const innerObsidian = new THREE.Mesh(
        new THREE.CylinderGeometry(0.017, 0.017, 0.00084, 32),
        obsidianMat,
      );
      innerObsidian.position.set(0, 0.00044, 0);
      this.localSettlementGroup.add(runeRing, innerObsidian);

      // Stepped Obsidian & Gold Reptiloid Ziggurat on the north side
      const tiers = [
        [0.088, 0.012],
        [0.068, 0.012],
        [0.05, 0.012],
        [0.034, 0.012],
        [0.02, 0.011],
      ];
      let curY = 0;
      tiers.forEach(([w, h], idx) => {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), idx % 2 === 0 ? obsidianMat : goldMat);
        tier.position.set(0, curY + h * 0.5, -0.078);
        this.localSettlementGroup.add(tier);
        curY += h;
      });

      // Levitating glowing Emerald Crystal above Ziggurat apex
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.011, 0), emeraldMat);
      crystal.position.set(0, curY + 0.016, -0.078);
      this.localSettlementGroup.add(crystal);
      this.cityHoverObjects.push({ obj: crystal, baseY: curY + 0.016, phase: 0, orbitR: 0, speed: 1.6 });

      // Crystal Spire Obelisks flanking the Ziggurat & plaza
      const spirePts = [
        [-0.062, -0.042],
        [0.062, -0.042],
        [-0.075, 0.068],
        [0.075, 0.068],
      ];
      for (const [sx, sz] of spirePts) {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.012, 6), obsidianMat);
        base.position.set(sx, 0.006, sz);
        const shaft = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.042, 6), emeraldMat);
        shaft.position.set(sx, 0.033, sz);
        this.localSettlementGroup.add(base, shaft);
      }

      // 2 Hovering Alien Patrol Saucers circling above Reptiloid City
      for (let u = 0; u < 2; u++) {
        const saucer = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.015, 0.004, 16), obsidianMat);
        const ufoDome = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 12, 8), emeraldMat);
        ufoDome.position.y = 0.002;
        saucer.add(hull, ufoDome);
        const baseY = 0.042 + u * 0.018;
        saucer.position.set(0, baseY, 0);
        this.localSettlementGroup.add(saucer);
        this.cityHoverObjects.push({
          obj: saucer,
          baseY,
          phase: u * Math.PI,
          orbitR: 0.065 + u * 0.035,
          speed: 0.55 + u * 0.25,
        });
      }

      // Spawn 8 Animated 3D Reptiloid Residents & Temple Guards!
      const repScaleMat = new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.52 });
      const repBellyMat = new THREE.MeshStandardMaterial({ color: '#65a30d', roughness: 0.58 });
      const repEyeMat = new THREE.MeshBasicMaterial({ color: '#fbbf24' });
      const repArmorMat = goldMat;

      const repLegGeom = new THREE.BoxGeometry(0.00024, 0.00095, 0.00024);
      repLegGeom.translate(0, -0.000475, 0);
      const repArmGeom = new THREE.BoxGeometry(0.00018, 0.00072, 0.00018);
      repArmGeom.translate(0, -0.00036, 0);
      const repTailGeom = new THREE.ConeGeometry(0.00018, 0.0014, 6);
      repTailGeom.rotateX(-Math.PI * 0.58);
      repTailGeom.translate(0, -0.0002, -0.00065);

      const repSpecs: { bx: number; bz: number; r: number; spd: number; guard: boolean }[] = [
        { bx: 0.012, bz: 0.018, r: 0.016, spd: 0.65, guard: false },
        { bx: -0.018, bz: 0.008, r: 0.022, spd: 0.55, guard: false },
        { bx: 0.024, bz: -0.018, r: 0.018, spd: 0.72, guard: false },
        { bx: -0.008, bz: 0.044, r: 0.025, spd: 0.5, guard: false },
        { bx: 0.042, bz: 0.015, r: 0.02, spd: 0.62, guard: false },
        { bx: -0.024, bz: -0.032, r: 0, spd: 0, guard: true },
        { bx: 0.024, bz: -0.032, r: 0, spd: 0, guard: true },
        { bx: 0.0, bz: -0.026, r: 0, spd: 0, guard: true },
      ];

      repSpecs.forEach((spec, idx) => {
        const rg = new THREE.Group();
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.00064, 0.00086, 0.00038), repScaleMat);
        torso.position.y = 0.00138;
        const chest = new THREE.Mesh(new THREE.BoxGeometry(0.00046, 0.00062, 0.0004), repBellyMat);
        chest.position.y = 0.00134;
        const armor = new THREE.Mesh(new THREE.BoxGeometry(0.00076, 0.0002, 0.00044), repArmorMat);
        armor.position.y = 0.00172;

        // Reptilian head + elongated snout + dorsal crest + glowing yellow eyes
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.00036, 0.00032, 0.00042), repScaleMat);
        head.position.set(0, 0.00202, 0.00008);
        const snout = new THREE.Mesh(new THREE.BoxGeometry(0.00024, 0.00018, 0.00034), repScaleMat);
        snout.position.set(0, 0.00196, 0.00036);
        const crest = new THREE.Mesh(new THREE.ConeGeometry(0.00012, 0.00044, 4), repArmorMat);
        crest.rotation.x = -0.35;
        crest.position.set(0, 0.00222, -0.00005);
        const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.000055, 6, 6), repEyeMat);
        eyeL.position.set(-0.00012, 0.00208, 0.00028);
        const eyeR = eyeL.clone();
        eyeR.position.x = 0.00012;

        const legL = new THREE.Mesh(repLegGeom, repScaleMat);
        legL.position.set(-0.00017, 0.00095, 0);
        const legR = new THREE.Mesh(repLegGeom, repScaleMat);
        legR.position.set(0.00017, 0.00095, 0);

        const armL = new THREE.Mesh(repArmGeom, repScaleMat);
        armL.position.set(-0.00042, 0.00168, 0);
        const armR = new THREE.Mesh(repArmGeom, repScaleMat);
        armR.position.set(0.00042, 0.00168, 0);

        if (spec.guard) {
          const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.00004, 0.00004, 0.0022, 6), repArmorMat);
          staff.position.set(0, -0.00015, 0.00022);
          const orb = new THREE.Mesh(new THREE.SphereGeometry(0.00011, 8, 8), emeraldMat);
          orb.position.set(0, 0.00098, 0.00022);
          armR.add(staff, orb);
        }

        const tail = new THREE.Mesh(repTailGeom, repScaleMat);
        tail.position.set(0, 0.00105, -0.00018);

        rg.add(torso, chest, armor, head, snout, crest, eyeL, eyeR, legL, legR, armL, armR, tail);
        rg.position.set(spec.bx, spec.guard ? 0.0007 : 0.0007, spec.bz);
        this.localSettlementGroup.add(rg);

        this.reptiloidNpcs.push({
          group: rg,
          legL,
          legR,
          armL,
          armR,
          tail,
          baseX: spec.bx,
          baseZ: spec.bz,
          patrolRadius: spec.r,
          speed: spec.spd,
          phase: idx * 1.15,
          isGuard: spec.guard,
        });
      });
    }

    // Populate urban / town / village blocks
    if (sType === 'capital' || sType === 'city') {
      const blocks = [
        [0.052, 0.048, 0.022, 0.048, 0.022],
        [0.092, 0.042, 0.024, 0.062, 0.02],
        [0.048, -0.048, 0.022, 0.054, 0.022],
        [-0.048, 0.052, 0.025, 0.038, 0.022],
        [-0.092, 0.055, 0.022, 0.044, 0.02],
        [0.125, -0.095, 0.026, 0.072, 0.024],
        [-0.135, 0.11, 0.026, 0.036, 0.024],
      ];
      blocks.forEach(([bx, bz, bw, bh, bd], i) => {
        addBuilding(bx, bz, bw, bh, bd, i % 2 === 0 ? wallMat : glassMat, false);
      });
      for (let t = 0; t < 26; t++) {
        const ang = (t / 26) * Math.PI * 2;
        const tr = 0.034 + (t % 3) * 0.045;
        addTree(Math.cos(ang) * tr, Math.sin(ang) * tr, 1.1);
      }
    } else if (sType === 'town') {
      // Город типа г. Ступино: уютные 5-9 этажные дома, ДК на площади, парк
      const dk = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.018, 0.024), wallMat);
      dk.position.set(-0.045, 0.01, -0.042);
      const dkRoof = new THREE.Mesh(new THREE.BoxGeometry(0.039, 0.004, 0.027), roofMat);
      dkRoof.position.set(-0.045, 0.021, -0.042);
      this.localSettlementGroup.add(dk, dkRoof);

      const townBlocks = [
        [0.048, 0.042, 0.026, 0.024, 0.016],
        [0.092, 0.042, 0.026, 0.028, 0.016],
        [0.048, -0.046, 0.028, 0.022, 0.016],
        [0.098, -0.052, 0.024, 0.032, 0.018],
        [-0.052, 0.048, 0.024, 0.02, 0.016],
        [-0.098, 0.052, 0.026, 0.026, 0.016],
        [-0.105, -0.048, 0.024, 0.022, 0.016],
      ];
      townBlocks.forEach(([bx, bz, bw, bh, bd]) => addBuilding(bx, bz, bw, bh, bd, wallMat, true));

      for (let t = 0; t < 38; t++) {
        const ang = (t / 38) * Math.PI * 2 + 0.15;
        const tr = 0.032 + (t % 4) * 0.038;
        addTree(Math.cos(ang) * tr, Math.sin(ang) * tr, 1.0);
      }
    } else {
      // Деревня / посёлок / произвольная суша: избы, фермы, хижины саванны, лес/пальмы
      const huts = [
        [0.028, 0.024, 0.0085, 0.0045, 0.0068],
        [0.054, 0.026, 0.009, 0.0048, 0.0072],
        [-0.032, 0.028, 0.008, 0.0042, 0.0065],
        [-0.064, 0.025, 0.0095, 0.0052, 0.0075],
        [0.036, -0.03, 0.009, 0.0046, 0.007],
        [-0.042, -0.034, 0.0088, 0.0048, 0.007],
        [0.088, -0.028, 0.011, 0.0055, 0.008],
      ];
      huts.forEach(([bx, bz, bw, bh, bd]) => addBuilding(bx, bz, bw, bh, bd, wallMat, true));

      for (let t = 0; t < 44; t++) {
        const ang = (t / 44) * Math.PI * 2;
        const tr = 0.024 + (t % 5) * 0.036;
        const tx = Math.cos(ang) * tr;
        const tz = Math.sin(ang) * tr;
        if (Math.abs(tx) > 0.011 && Math.abs(tz) > 0.011) {
          addTree(tx, tz, 0.9 + (t % 3) * 0.25);
        }
      }
    }

    const titleText =
      place?.name ??
      (surface === 'ice'
        ? 'Ледяной барьер'
        : surface === 'desert'
          ? 'Пустынный оазис'
          : surface === 'outer'
            ? 'Внешние земли'
            : 'Высадка на суше');
    const signSprite = makeTextSprite(titleText, '#fef08a', 'rgba(5, 8, 17, 0.85)', 0.055);
    signSprite.position.set(0, 0.032, -0.022);
    this.localSettlementGroup.add(signSprite);
  }

  public teleportPedestrianToPlace(placeId: string, focusPedestrian = true) {
    const place = WORLD_PLACES.find((p) => p.id === placeId) ?? WORLD_PLACES[0];
    const worldPos = getPlaceWorldPosition(place, DISC_RADIUS);
    const surface = this.mapTextures.sampleSurfaceAtWorld(worldPos.x, worldPos.z, DISC_RADIUS);

    this.rebuildLocalSettlement(worldPos.x, worldPos.z, place, surface);
    const py = this.getPedGroundHeight(worldPos.x, worldPos.z + 0.012);
    this.pedPos.set(worldPos.x, py, worldPos.z + 0.012);
    this.pedYaw = Math.PI;
    this.pedestrianGroup.position.copy(this.pedPos);
    this.pedestrianGroup.rotation.y = this.pedYaw;
    this.activePedMapPin.position.set(worldPos.x, 0, worldPos.z);

    this.pedMeta = {
      name: place.name,
      region: `${place.continentLabel} · ${place.region}`,
      coords: `${Math.abs(place.lat).toFixed(1)}° ${place.lat >= 0 ? 'с.ш.' : 'ю.ш.'}, ${Math.abs(place.lon).toFixed(1)}° ${place.lon >= 0 ? 'в.д.' : 'з.д.'}`,
    };

    if (focusPedestrian) {
      this.dropPinMode = false;
      this.mapSelection = null;
      this.setFocusMode('pedestrian');
    }
    this.emitTelemetry(true);
  }

  public dropPedestrianAtWorld(x: number, z: number) {
    // Snap to closest named settlement if tapped within 260 km on the global map
    let closestPlace: WorldPlace | null = null;
    let minD = 260;
    for (const p of WORLD_PLACES) {
      const wp = getPlaceWorldPosition(p, DISC_RADIUS);
      const d = Math.hypot(x - wp.x, z - wp.z);
      if (d < minD) {
        minD = d;
        closestPlace = p;
      }
    }

    if (closestPlace) {
      this.teleportPedestrianToPlace(closestPlace.id, true);
      return;
    }

    const clampedR = Math.min(DISC_RADIUS * 0.96, Math.hypot(x, z));
    const ang = Math.atan2(z, x);
    const wx = Math.cos(ang) * clampedR;
    const wz = Math.sin(ang) * clampedR;

    const surface = this.mapTextures.sampleSurfaceAtWorld(wx, wz, DISC_RADIUS);
    const geo = worldXZToApproxLatLon(wx, wz, DISC_RADIUS);

    this.rebuildLocalSettlement(wx, wz, null, surface);
    const py = this.getPedGroundHeight(wx, wz + 0.01);
    this.pedPos.set(wx, py, wz + 0.01);
    this.pedYaw = Math.PI;
    this.pedestrianGroup.position.copy(this.pedPos);
    this.pedestrianGroup.rotation.y = this.pedYaw;
    this.activePedMapPin.position.set(wx, 0, wz);

    const terrainName =
      surface === 'ocean'
        ? 'Океан (станция)'
        : surface === 'ice'
          ? 'Антарктический ледник'
          : surface === 'desert'
            ? 'Песчаная пустыня'
            : surface === 'outer'
              ? 'Неизведанные земли'
              : 'Местность на карте';
    const regionLabel = geo.isOuter
      ? `Внешние земли · r = ${Math.round(geo.radiusKm)} км`
      : geo.isIceWall
        ? 'Ледяной барьер Антарктиды'
        : `Точка на карте · r = ${Math.round(geo.radiusKm)} км`;

    this.pedMeta = {
      name: terrainName,
      region: regionLabel,
      coords: `${Math.abs(geo.lat).toFixed(1)}° ${geo.lat >= 0 ? 'с.ш.' : 'ю.ш.'}, ${Math.abs(geo.lon).toFixed(1)}° ${geo.lon >= 0 ? 'в.д.' : 'з.д.'}`,
    };

    this.dropPinMode = false;
    this.mapSelection = null;
    this.setFocusMode('pedestrian');
    this.emitTelemetry(true);
  }

  private previewMapPoint(x: number, z: number, forcedPlaceId?: string) {
    let targetPlace: WorldPlace | null = forcedPlaceId
      ? WORLD_PLACES.find((p) => p.id === forcedPlaceId) ?? null
      : null;

    if (!targetPlace) {
      let minD = 320;
      for (const p of WORLD_PLACES) {
        const wp = getPlaceWorldPosition(p, DISC_RADIUS);
        const d = Math.hypot(x - wp.x, z - wp.z);
        if (d < minD) {
          minD = d;
          targetPlace = p;
        }
      }
    }

    if (targetPlace) {
      const wp = getPlaceWorldPosition(targetPlace, DISC_RADIUS);
      this.activePedMapPin.position.set(wp.x, 0, wp.z);
      this.mapSelection = {
        x: wp.x,
        z: wp.z,
        placeId: targetPlace.id,
        name: targetPlace.name,
        region: `${targetPlace.continentLabel} · ${targetPlace.region}`,
        coords: `${Math.abs(targetPlace.lat).toFixed(1)}° ${targetPlace.lat >= 0 ? 'с.ш.' : 'ю.ш.'}, ${Math.abs(targetPlace.lon).toFixed(1)}° ${targetPlace.lon >= 0 ? 'в.д.' : 'з.д.'}`,
        surfaceLabel:
          targetPlace.landmark === 'reptiloid'
            ? 'Город рептилоидов'
            : targetPlace.type === 'village'
              ? 'Деревня'
              : targetPlace.type === 'outer'
                ? 'За стеной'
                : 'Город',
        isOuter: targetPlace.type === 'outer',
      };
      this.emitTelemetry(true);
      return;
    }

    const clampedR = Math.min(DISC_RADIUS * 0.96, Math.hypot(x, z));
    const ang = Math.atan2(z, x);
    const wx = Math.cos(ang) * clampedR;
    const wz = Math.sin(ang) * clampedR;
    const surface = this.mapTextures.sampleSurfaceAtWorld(wx, wz, DISC_RADIUS);
    const geo = worldXZToApproxLatLon(wx, wz, DISC_RADIUS);

    this.activePedMapPin.position.set(wx, 0, wz);
    const surfaceLabel =
      surface === 'ocean'
        ? 'Океан (плавучая станция)'
        : surface === 'ice'
          ? 'Ледяной барьер'
          : surface === 'desert'
            ? 'Пустыня'
            : surface === 'outer'
              ? 'Внешние земли'
              : 'Суша';
    this.mapSelection = {
      x: wx,
      z: wz,
      name:
        surface === 'ocean'
          ? 'Океан · Научная платформа'
          : surface === 'ice'
            ? 'Стена Антарктиды'
            : geo.isOuter
              ? 'Земли за Антарктидой'
              : 'Выбранная точка на карте',
      region: geo.isOuter
        ? `Внешнее кольцо · r = ${Math.round(geo.radiusKm)} км`
        : `r = ${Math.round(geo.radiusKm)} км от Полюса`,
      coords: `${Math.abs(geo.lat).toFixed(1)}° ${geo.lat >= 0 ? 'с.ш.' : 'ю.ш.'}, ${Math.abs(geo.lon).toFixed(1)}° ${geo.lon >= 0 ? 'в.д.' : 'з.д.'}`,
      surfaceLabel,
      isOuter: geo.isOuter,
    };
    this.emitTelemetry(true);
  }

  public confirmMapDropToPedestrian() {
    if (!this.mapSelection) return;
    if (this.mapSelection.placeId) {
      this.teleportPedestrianToPlace(this.mapSelection.placeId, true);
    } else {
      this.dropPedestrianAtWorld(this.mapSelection.x, this.mapSelection.z);
    }
  }

  public clearMapSelection() {
    this.mapSelection = null;
    this.emitTelemetry(true);
  }

  public setWeatherMode(mode: WeatherMode) {
    this.weatherMode = mode;
    this.refreshEffectiveWeather();
    this.emitTelemetry(true);
  }

  public cycleWeatherMode() {
    const order: WeatherMode[] = ['auto', 'clear', 'rain', 'storm', 'snow', 'sandstorm'];
    const idx = order.indexOf(this.weatherMode);
    this.setWeatherMode(order[(idx + 1) % order.length]);
  }

  public setDropPinMode(enabled: boolean) {
    this.dropPinMode = enabled;
    if (enabled && this.focusMode !== 'map') {
      this.setFocusMode('map');
    }
    this.emitTelemetry(true);
  }

  public setPedestrianInput(x: number, y: number, sprint = false) {
    this.pedMoveVec.set(x, y);
    this.pedSprint = sprint;
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    this.keyState[e.code] = true;
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keyState[e.code] = false;
  };

  private handleCanvasPointerDown = (e: PointerEvent) => {
    this.pointerDownPt = { x: e.clientX, y: e.clientY };
  };

  private handleCanvasPointerUp = (e: PointerEvent) => {
    if (!this.pointerDownPt) return;
    const moved = Math.hypot(e.clientX - this.pointerDownPt.x, e.clientY - this.pointerDownPt.y);
    this.pointerDownPt = null;
    if (moved > 7 || (this.focusMode !== 'map' && !this.dropPinMode)) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pedPointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pedPointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.pedRaycaster.setFromCamera(this.pedPointerNdc, this.camera);

    // 1. Prioritize named 3D city/village/Reptiloid map markers
    const pinHits = this.pedRaycaster.intersectObjects(this.mapPinHitMeshes, false);
    if (pinHits.length > 0) {
      const placeId = String(pinHits[0].object.userData.placeId ?? '');
      if (placeId) {
        if (this.dropPinMode) {
          this.teleportPedestrianToPlace(placeId, true);
        } else {
          const p = WORLD_PLACES.find((pl) => pl.id === placeId);
          if (p) {
            const wp = getPlaceWorldPosition(p, DISC_RADIUS);
            this.previewMapPoint(wp.x, wp.z, placeId);
          }
        }
        return;
      }
    }

    // 2. Otherwise intersect the Earth surface disc anywhere
    const hits = this.pedRaycaster.intersectObject(this.earthTopMesh, false);
    if (hits.length > 0) {
      if (this.dropPinMode) {
        this.dropPedestrianAtWorld(hits[0].point.x, hits[0].point.z);
      } else {
        this.previewMapPoint(hits[0].point.x, hits[0].point.z);
      }
    }
  };

  private buildAtmosphericClouds() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const cloudTex = createAtmosphericCloudsTexture(maxAniso);
    const lowCloudTex = createLowerCumulusTexture(maxAniso);

    // 1a. Lower Scattered Cumulus Deck at 7.5 km altitude (parallax layer under ISS cyclones!)
    const lowCloudGeom = new THREE.CircleGeometry(DISC_RADIUS * 0.985, 128);
    lowCloudGeom.rotateX(-Math.PI / 2);
    const lowCloudMat = new THREE.MeshStandardMaterial({
      map: lowCloudTex,
      transparent: true,
      opacity: 0.7,
      roughness: 0.95,
      metalness: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.applyHalfEarthDayNightShader(lowCloudMat, undefined, true);
    this.cloudLowLayerMesh = new THREE.Mesh(lowCloudGeom, lowCloudMat);
    this.cloudLowLayerMesh.position.y = 7.5;
    this.cloudLowLayerMesh.renderOrder = 1;
    this.scene.add(this.cloudLowLayerMesh);

    // 1b. Upper Global Cyclonic & Hurricane Eye Cloud Cover Layer at 13.5 km altitude
    const globalCloudGeom = new THREE.CircleGeometry(DISC_RADIUS * 0.985, 144);
    globalCloudGeom.rotateX(-Math.PI / 2);
    const globalCloudMat = new THREE.MeshStandardMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.88,
      roughness: 0.94,
      metalness: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.applyHalfEarthDayNightShader(globalCloudMat, undefined, true);
    this.cloudLayerMesh = new THREE.Mesh(globalCloudGeom, globalCloudMat);
    this.cloudLayerMesh.position.y = 13.5;
    this.cloudLayerMesh.renderOrder = 2;
    this.scene.add(this.cloudLayerMesh);

    // 1c. Stratospheric Rayleigh Blue Rim Haze Ring (visible from ISS & high orbit)
    const limbGeom = new THREE.RingGeometry(DISC_RADIUS * 0.86, DISC_RADIUS * 1.035, 160);
    limbGeom.rotateX(-Math.PI / 2);
    const limbMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uDiscR: { value: DISC_RADIUS } },
      vertexShader: `
        varying vec2 vXZ;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vXZ = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uDiscR;
        varying vec2 vXZ;
        void main() {
          float r = length(vXZ) / uDiscR;
          float rim = smoothstep(0.86, 0.992, r) * (1.0 - smoothstep(0.992, 1.035, r));
          gl_FragColor = vec4(vec3(0.32, 0.66, 0.98), rim * 0.42);
        }
      `,
    });
    this.atmosphereLimbMesh = new THREE.Mesh(limbGeom, limbMat);
    this.atmosphereLimbMesh.position.y = 28;
    this.atmosphereLimbMesh.renderOrder = 3;
    this.scene.add(this.atmosphereLimbMesh);

    // 2. Local 3D Volumetric Cumulus Cloud Banks (4-10 km) along ascent & Antarctic corridor
    this.localCloudGroup = new THREE.Group();
    const puffCanvas = document.createElement('canvas');
    puffCanvas.width = 128;
    puffCanvas.height = 128;
    const pctx = puffCanvas.getContext('2d')!;
    const g = pctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, 'rgba(226, 238, 252, 0.72)');
    g.addColorStop(0.45, 'rgba(186, 210, 238, 0.34)');
    g.addColorStop(1, 'rgba(148, 178, 215, 0.0)');
    pctx.fillStyle = g;
    pctx.fillRect(0, 0, 128, 128);

    const puffTex = new THREE.CanvasTexture(puffCanvas);
    puffTex.colorSpace = THREE.SRGBColorSpace;
    const puffMat = new THREE.SpriteMaterial({
      map: puffTex,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });

    // Ascent cloud ring around launch site (5–45 km away so pad stays crisp, ascent cuts through clouds)
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2 + (i % 3) * 0.14;
      const dist = 3.2 + (i % 7) * 5.8;
      const alt = 4.2 + (i % 5) * 1.35;
      const spr = new THREE.Sprite(puffMat);
      spr.position.set(
        LAUNCH_SITE.x + Math.cos(ang) * dist,
        alt,
        LAUNCH_SITE.z + Math.sin(ang) * dist,
      );
      const w = 2.6 + (i % 4) * 1.4;
      spr.scale.set(w, w * 0.42, 1);
      this.localCloudGroup.add(spr);
    }

    // Dramatic cloud banks approaching the Antarctic Ice Wall & Outer Lands
    for (let i = 0; i < 28; i++) {
      const rKm = 18800 + (i % 8) * 520;
      const latDrift = ((i % 7) - 3) * 180;
      const perp = new THREE.Vector3(-SOUTHWARD_DIR.z, 0, SOUTHWARD_DIR.x);
      const pos = new THREE.Vector3()
        .copy(SOUTHWARD_DIR)
        .multiplyScalar(rKm)
        .addScaledVector(perp, latDrift);
      const spr = new THREE.Sprite(puffMat);
      spr.position.set(pos.x, 5.5 + (i % 4) * 1.8, pos.z);
      const w = 180 + (i % 5) * 90;
      spr.scale.set(w, w * 0.35, 1);
      this.localCloudGroup.add(spr);
    }

    this.scene.add(this.localCloudGroup);
    this.disposables.push(
      cloudTex,
      lowCloudTex,
      lowCloudGeom,
      lowCloudMat,
      globalCloudGeom,
      globalCloudMat,
      limbGeom,
      limbMat,
      puffTex,
      puffMat,
    );
  }

  private buildWeatherParticles() {
    this.weatherGroup = new THREE.Group();
    this.weatherGroup.visible = false;

    const count = 750;
    this.weatherPos = new Float32Array(count * 3);
    this.weatherSeeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.weatherPos[i * 3] = (Math.random() - 0.5) * 0.16;
      this.weatherPos[i * 3 + 1] = Math.random() * 0.055;
      this.weatherPos[i * 3 + 2] = (Math.random() - 0.5) * 0.16;
      this.weatherSeeds[i * 3] = 0.7 + Math.random() * 0.6;
      this.weatherSeeds[i * 3 + 1] = Math.random() * Math.PI * 2;
      this.weatherSeeds[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.weatherPos, 3));
    const mat = new THREE.PointsMaterial({
      color: '#bae6fd',
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.weatherPoints = new THREE.Points(geom, mat);
    this.weatherPoints.frustumCulled = false;
    this.weatherGroup.add(this.weatherPoints);
    this.scene.add(this.weatherGroup);
    this.disposables.push(geom, mat);
  }

  private refreshEffectiveWeather() {
    if (this.weatherMode !== 'auto') {
      this.effectiveWeather = this.weatherMode;
    } else if (this.currentPlace?.landmark === 'reptiloid') {
      this.effectiveWeather = 'alien';
    } else if (this.currentSurface === 'ice' || this.currentPlace?.biome === 'taiga') {
      this.effectiveWeather = 'snow';
    } else if (this.currentSurface === 'desert' || this.currentPlace?.biome === 'outback') {
      this.effectiveWeather = 'sandstorm';
    } else if (
      this.currentPlace?.id === 'spb' ||
      this.currentPlace?.id === 'amazon_village' ||
      this.currentPlace?.id === 'rio'
    ) {
      this.effectiveWeather = 'rain';
    } else {
      this.effectiveWeather = 'clear';
    }

    const mat = this.weatherPoints?.material as THREE.PointsMaterial | undefined;
    if (mat) {
      if (this.effectiveWeather === 'rain') {
        mat.color.set('#93c5fd');
        mat.size = 2.4;
        mat.opacity = 0.68;
      } else if (this.effectiveWeather === 'storm') {
        mat.color.set('#cbd5e1');
        mat.size = 2.8;
        mat.opacity = 0.85;
      } else if (this.effectiveWeather === 'snow') {
        mat.color.set('#f8fafc');
        mat.size = 3.2;
        mat.opacity = 0.88;
      } else if (this.effectiveWeather === 'sandstorm') {
        mat.color.set('#d9a76a');
        mat.size = 2.6;
        mat.opacity = 0.62;
      } else if (this.effectiveWeather === 'alien') {
        mat.color.set('#34d399');
        mat.size = 3.0;
        mat.opacity = 0.82;
      } else {
        mat.opacity = 0.0;
      }
    }

    this.applyPedestrianAtmosphereFog();
  }

  private applyPedestrianAtmosphereFog() {
    if (this.focusMode !== 'pedestrian') {
      this.scene.fog = null;
      return;
    }
    if (this.effectiveWeather === 'storm') {
      this.scene.fog = new THREE.FogExp2('#1b2432', 1.25);
    } else if (this.effectiveWeather === 'rain') {
      this.scene.fog = new THREE.FogExp2('#243247', 0.85);
    } else if (this.effectiveWeather === 'snow') {
      this.scene.fog = new THREE.FogExp2('#4b5d73', 0.92);
    } else if (this.effectiveWeather === 'sandstorm') {
      this.scene.fog = new THREE.FogExp2('#5e482c', 1.15);
    } else if (this.effectiveWeather === 'alien') {
      this.scene.fog = new THREE.FogExp2('#0f2a22', 0.72);
    } else {
      this.scene.fog = new THREE.FogExp2('#1d2b3e', 0.32);
    }
  }

  private getWeatherLabel(): string {
    switch (this.effectiveWeather) {
      case 'rain':
        return 'Дождь';
      case 'storm':
        return 'Гроза';
      case 'snow':
        return 'Снегопад';
      case 'sandstorm':
        return 'Пыльная буря';
      case 'alien':
        return 'Споры Нибиру';
      default:
        return 'Ясно';
    }
  }

  private buildUfosAndCapsule() {
    // 1. 3 Flying Saucers (НЛО) + Laser Beams
    const hullMat = new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.24,
      metalness: 0.88,
    });
    const domeMat = new THREE.MeshStandardMaterial({
      color: '#22d3ee',
      emissive: '#0891b2',
      emissiveIntensity: 1.4,
      roughness: 0.15,
      metalness: 0.35,
    });
    const rimLightMat = new THREE.MeshBasicMaterial({ color: '#4ade80' });
    const saucerPts = [
      new THREE.Vector2(0.0, -0.008),
      new THREE.Vector2(0.032, -0.006),
      new THREE.Vector2(0.056, 0.0),
      new THREE.Vector2(0.034, 0.007),
      new THREE.Vector2(0.0, 0.009),
    ];
    const saucerGeom = new THREE.LatheGeometry(saucerPts, 28);
    const domeGeom = new THREE.SphereGeometry(0.022, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const nodeGeom = new THREE.SphereGeometry(0.004, 8, 8);
    const beamGeom = new THREE.CylinderGeometry(0.018, 0.035, 1, 12, 1, true);
    // Shift cylinder base to origin and extend +Y by 1.0 for easy world-space beam aiming
    beamGeom.translate(0, 0.5, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      color: '#4ade80',
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const impactRingGeom = new THREE.RingGeometry(0.02, 0.08, 24).rotateX(-Math.PI / 2);
    const impactRingMat = new THREE.MeshBasicMaterial({
      color: '#86efac',
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const ufoOffsets = [
      new THREE.Vector3(-0.24, 0.22, -0.18),
      new THREE.Vector3(0.26, 0.26, -0.14),
      new THREE.Vector3(0.02, 0.31, 0.24),
    ];

    for (let i = 0; i < 3; i++) {
      const grp = new THREE.Group();
      const saucer = new THREE.Mesh(saucerGeom, hullMat);
      grp.add(saucer);

      const dome = new THREE.Mesh(domeGeom, domeMat);
      dome.position.y = 0.006;
      grp.add(dome);

      for (let n = 0; n < 8; n++) {
        const ang = (n / 8) * Math.PI * 2;
        const node = new THREE.Mesh(nodeGeom, rimLightMat);
        node.position.set(Math.cos(ang) * 0.048, 0.0, Math.sin(ang) * 0.048);
        grp.add(node);
      }

      grp.visible = false;
      this.scene.add(grp);

      const beam = new THREE.Mesh(beamGeom, beamMat);
      beam.visible = false;
      beam.renderOrder = 10;
      this.scene.add(beam);

      const impactRing = new THREE.Mesh(impactRingGeom, impactRingMat);
      impactRing.visible = false;
      impactRing.renderOrder = 10;
      this.scene.add(impactRing);

      this.ufoFleet.push({ group: grp, beam, impactRing, offset: ufoOffsets[i] });
    }

    // 2. Crew Capsule + Red/White Parachute Canopy (for Outer Lands Breakout)
    this.capsuleGroup = new THREE.Group();
    this.capsuleGroup.visible = false;
    this.capsuleBodyMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.42,
      metalness: 0.3,
    });
    const shieldMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.78,
      metalness: 0.4,
    });
    const capBodyG = new THREE.CylinderGeometry(0.011, 0.021, 0.032, 18);
    const capBody = new THREE.Mesh(capBodyG, this.capsuleBodyMat);
    capBody.position.y = 0.018;
    this.capsuleGroup.add(capBody);

    const capShieldG = new THREE.CylinderGeometry(0.021, 0.019, 0.006, 18);
    const capShield = new THREE.Mesh(capShieldG, shieldMat);
    capShield.position.y = 0.003;
    this.capsuleGroup.add(capShield);

    // Parachute canopy with striped red & white gores
    this.parachuteCanopy = new THREE.Group();
    const chuteCanvas = document.createElement('canvas');
    chuteCanvas.width = 256;
    chuteCanvas.height = 128;
    const cctx = chuteCanvas.getContext('2d')!;
    for (let s = 0; s < 12; s++) {
      cctx.fillStyle = s % 2 === 0 ? '#ef4444' : '#f8fafc';
      cctx.fillRect((s * 256) / 12, 0, 256 / 12 + 1, 128);
    }
    const chuteTex = new THREE.CanvasTexture(chuteCanvas);
    chuteTex.colorSpace = THREE.SRGBColorSpace;
    const chuteMat = new THREE.MeshStandardMaterial({
      map: chuteTex,
      roughness: 0.75,
      side: THREE.DoubleSide,
    });
    const chuteGeom = new THREE.SphereGeometry(0.068, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52);
    const chuteMesh = new THREE.Mesh(chuteGeom, chuteMat);
    chuteMesh.position.y = 0.125;
    this.parachuteCanopy.add(chuteMesh);

    const riserMat = new THREE.MeshBasicMaterial({ color: '#cbd5e1' });
    const riserGeom = new THREE.CylinderGeometry(0.0007, 0.0007, 0.105, 4);
    for (let r = 0; r < 6; r++) {
      const ang = (r / 6) * Math.PI * 2;
      const riser = new THREE.Mesh(riserGeom, riserMat);
      riser.position.set(Math.cos(ang) * 0.032, 0.082, Math.sin(ang) * 0.032);
      riser.rotation.z = Math.cos(ang) * 0.42;
      riser.rotation.x = -Math.sin(ang) * 0.42;
      this.parachuteCanopy.add(riser);
    }
    this.capsuleGroup.add(this.parachuteCanopy);
    this.scene.add(this.capsuleGroup);

    // 3. Two EVA Astronauts shouting "Ура! Ура!" on the Outer Lands
    const evaSuitMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.45 });
    const evaVisorMat = new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.18, metalness: 0.85 });
    const evaTorsoG = new THREE.CapsuleGeometry(0.006, 0.012, 6, 10);
    const evaHeadG = new THREE.SphereGeometry(0.005, 12, 10);
    const evaArmG = new THREE.CapsuleGeometry(0.0022, 0.01, 4, 8);
    const speechTexts = ['УРА!! МЫ ЗА СТЕНОЙ!', 'УРА! ЗЕМЛЯ ЗДЕСЬ!'];

    for (let a = 0; a < 2; a++) {
      const astro = new THREE.Group();
      const torso = new THREE.Mesh(evaTorsoG, evaSuitMat);
      torso.position.y = 0.014;
      astro.add(torso);

      const head = new THREE.Mesh(evaHeadG, evaVisorMat);
      head.position.y = 0.027;
      astro.add(head);

      const armL = new THREE.Mesh(evaArmG, evaSuitMat);
      armL.position.set(-0.007, 0.022, 0);
      armL.rotation.z = 2.4;
      const armR = new THREE.Mesh(evaArmG, evaSuitMat);
      armR.position.set(0.007, 0.022, 0);
      armR.rotation.z = -2.4;
      astro.add(armL, armR);

      const spr = makeTextSprite(speechTexts[a], '#fef08a', 'rgba(15, 23, 42, 0.88)', 0.18);
      spr.position.set(0, 0.062 + a * 0.022, 0);
      spr.visible = false;
      this.scene.add(spr);

      astro.visible = false;
      this.scene.add(astro);
      this.evaAstronauts.push(astro);
      this.evaSpeechSprites.push(spr);
      this.disposables.push(spr.material, spr.material.map!);
    }

    // Incineration plasma scorch glow sprite
    const scorchMat = makeGlowSprite('rgba(255,255,255,1)', 'rgba(249,115,22,0.72)');
    this.scorchGlowSprite = new THREE.Sprite(scorchMat);
    this.scorchGlowSprite.visible = false;
    this.scorchGlowSprite.renderOrder = 11;
    this.scene.add(this.scorchGlowSprite);

    this.disposables.push(
      hullMat,
      domeMat,
      rimLightMat,
      saucerGeom,
      domeGeom,
      nodeGeom,
      beamGeom,
      beamMat,
      impactRingGeom,
      impactRingMat,
      this.capsuleBodyMat,
      shieldMat,
      capBodyG,
      capShieldG,
      chuteTex,
      chuteMat,
      chuteGeom,
      riserMat,
      riserGeom,
      evaSuitMat,
      evaVisorMat,
      evaTorsoG,
      evaHeadG,
      evaArmG,
      scorchMat,
      scorchMat.map!,
    );
  }

  private buildSunAndMoon() {
    // 1. Sun at 6,000 km altitude
    this.sunGroup = new THREE.Group();
    const sunGeom = new THREE.SphereGeometry(520, 32, 24);
    const sunMat = new THREE.MeshBasicMaterial({ color: '#fff7d6' });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    this.sunGroup.add(sunMesh);

    const sunHaloMat = makeGlowSprite('rgba(255,248,210,0.95)', 'rgba(251,191,36,0.38)');
    const sunHalo = new THREE.Sprite(sunHaloMat);
    sunHalo.scale.set(3800, 3800, 1);
    this.sunGroup.add(sunHalo);

    const sunLabel = makeTextSprite('Солнце · 6 000 км', '#fde68a', 'rgba(5, 8, 17, 0.72)', 3400);
    sunLabel.position.set(0, 1100, 0);
    this.sunGroup.add(sunLabel);

    this.sunLight = new THREE.PointLight('#ffe8bd', 1.6, 48000, 0.6);
    this.sunGroup.add(this.sunLight);
    this.scene.add(this.sunGroup);

    // 2. Moon at 5,000 km altitude with accurate directional Sun light & shadow terminator
    this.moonGroup = new THREE.Group();
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const moonTex = createMoonTexture(maxAniso);
    const moonGeom = new THREE.SphereGeometry(420, 40, 28);
    const moonMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: moonTex },
        uSunPos: this.sunPosUniform,
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uMap;
        uniform vec3 uSunPos;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 N = normalize(vWorldNormal);
          vec3 L = normalize(uSunPos - vWorldPos);
          float ndotl = dot(N, L);

          // Crisp lunar terminator (lit hemisphere toward Sun, deep shadow away from Sun)
          float litMask = smoothstep(-0.04, 0.06, ndotl);
          float sunShade = litMask * (0.18 + 0.96 * pow(max(0.0, ndotl), 0.72));

          vec3 texCol = texture2D(uMap, vUv).rgb;
          vec3 litCol = texCol * vec3(1.03, 0.99, 0.92) * sunShade;
          // Very faint cool earthshine on the unlit night side of the Moon
          vec3 shadowCol = texCol * vec3(0.032, 0.042, 0.068);

          gl_FragColor = vec4(mix(shadowCol, litCol, litMask), 1.0);
        }
      `,
    });
    const moonMesh = new THREE.Mesh(moonGeom, moonMat);
    this.moonGroup.add(moonMesh);

    const moonHaloMat = makeGlowSprite('rgba(226,238,255,0.18)', 'rgba(148,163,184,0.04)');
    const moonHalo = new THREE.Sprite(moonHaloMat);
    moonHalo.scale.set(1500, 1500, 1);
    this.moonGroup.add(moonHalo);

    const moonLabel = makeTextSprite('Луна · 5 000 км', '#cbd5e1', 'rgba(5, 8, 17, 0.72)', 3000);
    moonLabel.position.set(0, 950, 0);
    this.moonGroup.add(moonLabel);

    this.scene.add(this.moonGroup);

    this.disposables.push(
      sunGeom,
      sunMat,
      sunHaloMat,
      sunHaloMat.map!,
      sunLabel.material,
      sunLabel.material.map!,
      moonTex,
      moonGeom,
      moonMat,
      moonHaloMat,
      moonHaloMat.map!,
      moonLabel.material,
      moonLabel.material.map!,
    );
  }

  private updateCelestialBodies(dt: number) {
    // Gentle celestial orbit around North Pole
    const orbitRate = 0.0025 * dt;
    this.sunAngle += orbitRate;
    this.moonAngle += orbitRate * 0.94;

    const sx = Math.cos(this.sunAngle) * SUN_ORBIT_RADIUS;
    const sz = Math.sin(this.sunAngle) * SUN_ORBIT_RADIUS;
    this.sunGroup.position.set(sx, SUN_ALTITUDE_KM, sz);
    this.sunXZUniform.value.set(sx, sz);
    this.sunPosUniform.value.set(sx, SUN_ALTITUDE_KM, sz);

    const mx = Math.cos(this.moonAngle) * MOON_ORBIT_RADIUS;
    const mz = Math.sin(this.moonAngle) * MOON_ORBIT_RADIUS;
    this.moonGroup.position.set(mx, MOON_ALTITUDE_KM, mz);
  }

  private buildISS() {
    this.issGroup = new THREE.Group();

    const trussMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      roughness: 0.35,
      metalness: 0.78,
    });
    const moduleMat = new THREE.MeshStandardMaterial({
      color: '#f1f5f9',
      roughness: 0.42,
      metalness: 0.32,
    });
    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.6,
      metalness: 0.5,
    });

    // Procedural copper-gold solar panel grid texture
    const solarCanvas = document.createElement('canvas');
    solarCanvas.width = 256;
    solarCanvas.height = 128;
    const sctx = solarCanvas.getContext('2d')!;
    sctx.fillStyle = '#78350f';
    sctx.fillRect(0, 0, 256, 128);
    sctx.fillStyle = '#b45309';
    for (let x = 4; x < 252; x += 16) {
      for (let y = 4; y < 124; y += 20) {
        sctx.fillRect(x, y, 13, 17);
      }
    }
    const solarTex = new THREE.CanvasTexture(solarCanvas);
    solarTex.colorSpace = THREE.SRGBColorSpace;
    const solarMat = new THREE.MeshStandardMaterial({
      map: solarTex,
      roughness: 0.25,
      metalness: 0.65,
      side: THREE.DoubleSide,
    });

    // Integrated Main Truss (0.16 km span = 160 m real proportion)
    const trussGeom = new THREE.BoxGeometry(0.155, 0.0045, 0.0045);
    const truss = new THREE.Mesh(trussGeom, trussMat);
    this.issGroup.add(truss);

    // 8 Solar Array Wings (4 pairs port & starboard)
    const wingGeom = new THREE.PlaneGeometry(0.018, 0.072);
    const wingOffsetsX = [-0.068, -0.048, 0.048, 0.068];
    for (const wx of wingOffsetsX) {
      const wingF = new THREE.Mesh(wingGeom, solarMat);
      wingF.position.set(wx, 0, 0.042);
      wingF.rotation.x = -Math.PI / 2 + 0.18;
      this.issGroup.add(wingF);

      const wingB = new THREE.Mesh(wingGeom, solarMat);
      wingB.position.set(wx, 0, -0.042);
      wingB.rotation.x = -Math.PI / 2 + 0.18;
      this.issGroup.add(wingB);
    }

    // Core Pressurized Modules along Z-forward axis
    const coreGeom = new THREE.CylinderGeometry(0.005, 0.005, 0.088, 16);
    coreGeom.rotateX(Math.PI / 2);
    const coreMesh = new THREE.Mesh(coreGeom, moduleMat);
    this.issGroup.add(coreMesh);

    // Transverse Lab Modules (Columbus / Kibo)
    const labGeom = new THREE.CylinderGeometry(0.0042, 0.0042, 0.044, 14);
    labGeom.rotateZ(Math.PI / 2);
    const labMesh = new THREE.Mesh(labGeom, moduleMat);
    labMesh.position.set(0, 0, 0.02);
    this.issGroup.add(labMesh);

    // Thermal Radiators
    const radGeom = new THREE.PlaneGeometry(0.011, 0.036);
    const radL = new THREE.Mesh(radGeom, moduleMat);
    radL.position.set(-0.022, 0.016, -0.006);
    const radR = new THREE.Mesh(radGeom, moduleMat);
    radR.position.set(0.022, 0.016, -0.006);
    this.issGroup.add(radL, radR);

    // Nadir-facing Cupola Observation Dome on the bottom (-Y)
    const cupolaGeom = new THREE.CylinderGeometry(0.0042, 0.0028, 0.0042, 8);
    const cupolaMesh = new THREE.Mesh(cupolaGeom, darkTrimMat);
    cupolaMesh.position.set(0, -0.0065, 0.008);
    this.issGroup.add(cupolaMesh);

    // Orbital Beacon + Label (scales dynamically cleanly so it disappears on close-up)
    const beaconMat = makeGlowSprite('rgba(56,189,248,0.95)', 'rgba(14,165,233,0.28)');
    this.issBeaconSprite = new THREE.Sprite(beaconMat);
    this.issBeaconSprite.scale.set(220, 220, 1);
    this.issGroup.add(this.issBeaconSprite);

    this.issLabelSprite = makeTextSprite('МКС · 400 км', '#7dd3fc', 'rgba(5, 8, 17, 0.78)', 2200);
    this.issLabelSprite.position.set(0, 520, 0);
    this.issGroup.add(this.issLabelSprite);

    this.scene.add(this.issGroup);

    // Circular Orbit Ring at y = 400 km over Flat Earth
    const orbitPts: THREE.Vector3[] = [];
    const segs = 160;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      orbitPts.push(new THREE.Vector3(Math.cos(a) * ISS_ORBIT_RADIUS, ISS_ALTITUDE_KM, Math.sin(a) * ISS_ORBIT_RADIUS));
    }
    const orbitGeom = new THREE.BufferGeometry().setFromPoints(orbitPts);
    const orbitMat = new THREE.LineBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.28,
    });
    this.issOrbitRing = new THREE.LineLoop(orbitGeom, orbitMat);
    this.scene.add(this.issOrbitRing);

    this.disposables.push(
      trussMat,
      moduleMat,
      darkTrimMat,
      solarTex,
      solarMat,
      trussGeom,
      wingGeom,
      coreGeom,
      labGeom,
      radGeom,
      cupolaGeom,
      beaconMat,
      beaconMat.map!,
      this.issLabelSprite.material,
      this.issLabelSprite.material.map!,
      orbitGeom,
      orbitMat,
    );
  }

  private updateISS(simDt: number) {
    this.issAngle += 0.022 * simDt;
    const ix = Math.cos(this.issAngle) * ISS_ORBIT_RADIUS;
    const iz = Math.sin(this.issAngle) * ISS_ORBIT_RADIUS;
    this.issGroup.position.set(ix, ISS_ALTITUDE_KM, iz);

    // Orient ISS along circular orbital tangent with nadir (-Y) pointing down to Earth
    _v1.set(-Math.sin(this.issAngle), 0, Math.cos(this.issAngle)).normalize();
    _qDelta.setFromUnitVectors(_v2.set(0, 0, 1), _v1);
    this.issGroup.quaternion.copy(_qDelta);
    this.issGroup.updateMatrixWorld(true);
  }

  private createSeatedAstronaut(suitHex: string, accentHex: string): THREE.Group {
    const astro = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({ color: suitHex, roughness: 0.55, metalness: 0.12 });
    const trimMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.45, metalness: 0.25 });
    const bootMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.7, metalness: 0.2 });
    const visorMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      roughness: 0.08,
      metalness: 0.92,
      emissive: '#451a03',
      emissiveIntensity: 0.25,
    });
    const seatMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.72, metalness: 0.35 });

    // Bucket seat frame
    const seatBackG = new THREE.BoxGeometry(0.46, 0.78, 0.08);
    const seatBack = new THREE.Mesh(seatBackG, seatMat);
    seatBack.position.set(0, 0.12, 0.18);
    seatBack.rotation.x = -0.14;
    astro.add(seatBack);

    const seatPanG = new THREE.BoxGeometry(0.46, 0.08, 0.44);
    const seatPan = new THREE.Mesh(seatPanG, seatMat);
    seatPan.position.set(0, -0.26, -0.02);
    astro.add(seatPan);

    // Torso & Chest Pack
    const torsoG = new THREE.CapsuleGeometry(0.16, 0.34, 8, 16);
    const torso = new THREE.Mesh(torsoG, suitMat);
    torso.position.set(0, 0.08, 0.02);
    torso.rotation.x = -0.1;
    astro.add(torso);

    const chestG = new THREE.BoxGeometry(0.22, 0.18, 0.1);
    const chest = new THREE.Mesh(chestG, trimMat);
    chest.position.set(0, 0.12, -0.14);
    astro.add(chest);

    // Legs (thighs forward, shins down)
    const thighG = new THREE.CapsuleGeometry(0.068, 0.24, 6, 12);
    const shinG = new THREE.CapsuleGeometry(0.058, 0.26, 6, 12);
    const bootG = new THREE.BoxGeometry(0.11, 0.09, 0.18);
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(thighG, suitMat);
      thigh.position.set(side * 0.11, -0.16, -0.18);
      thigh.rotation.x = Math.PI / 2 - 0.15;
      astro.add(thigh);

      const shin = new THREE.Mesh(shinG, suitMat);
      shin.position.set(side * 0.11, -0.38, -0.34);
      astro.add(shin);

      const boot = new THREE.Mesh(bootG, bootMat);
      boot.position.set(side * 0.11, -0.56, -0.39);
      astro.add(boot);
    }

    // Arms reaching toward cockpit console / armrests
    const armG = new THREE.CapsuleGeometry(0.05, 0.24, 6, 10);
    for (const side of [-1, 1]) {
      const upperArm = new THREE.Mesh(armG, suitMat);
      upperArm.position.set(side * 0.22, 0.12, -0.04);
      upperArm.rotation.z = side * 0.22;
      upperArm.rotation.x = 0.48;
      astro.add(upperArm);

      const foreArm = new THREE.Mesh(armG, suitMat);
      foreArm.position.set(side * 0.21, -0.02, -0.22);
      foreArm.rotation.x = 1.15;
      astro.add(foreArm);
    }

    // Pressurized Helmet + Reflective Gold Visor
    const helmetG = new THREE.SphereGeometry(0.155, 20, 16);
    const helmet = new THREE.Mesh(helmetG, suitMat);
    helmet.position.set(0, 0.43, -0.02);
    astro.add(helmet);

    const visorG = new THREE.SphereGeometry(0.142, 18, 14, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.24, Math.PI * 0.45);
    const visor = new THREE.Mesh(visorG, visorMat);
    visor.position.set(0, 0.43, -0.04);
    visor.rotation.y = Math.PI; // Face toward -Z porthole
    astro.add(visor);

    this.disposables.push(
      suitMat,
      trimMat,
      bootMat,
      visorMat,
      seatMat,
      seatBackG,
      seatPanG,
      torsoG,
      chestG,
      thighG,
      shinG,
      bootG,
      armG,
      helmetG,
      visorG,
    );
    return astro;
  }

  private buildInteriorStudios(envTex: THREE.Texture, aspect: number) {
    this.interiorScene = new THREE.Scene();
    this.interiorScene.environment = envTex;

    this.interiorCamera = new THREE.PerspectiveCamera(54, aspect, 0.04, 40);
    this.interiorCamera.position.set(0.24, 0.32, 1.58);

    this.interiorControls = new OrbitControls(this.interiorCamera, this.renderer.domElement);
    this.interiorControls.enableDamping = !this.isSoftwareGl;
    this.interiorControls.dampingFactor = 0.07;
    this.interiorControls.enablePan = false;
    this.interiorControls.minDistance = 0.65;
    this.interiorControls.maxDistance = 3.1;
    this.interiorControls.maxPolarAngle = Math.PI - 0.22;
    this.interiorControls.minPolarAngle = 0.22;
    this.interiorControls.target.set(0, 0.08, -0.58);
    this.interiorControls.enabled = false;

    const intHemi = new THREE.HemisphereLight('#bfd7ff', '#1e293b', 0.95);
    const intKey = new THREE.DirectionalLight('#f8fafc', 1.15);
    intKey.position.set(1.5, 2.2, 2.5);
    const consoleGlow = new THREE.PointLight('#38bdf8', 1.4, 5);
    consoleGlow.position.set(0, -0.1, -1.0);
    const earthBounce = new THREE.PointLight('#60a5fa', 1.25, 6);
    earthBounce.position.set(0, -0.6, -1.7);
    this.interiorScene.add(intHemi, intKey, consoleGlow, earthBounce);

    // =========================================================================
    // 1. ROCKET COCKPIT CABIN (Two Seated Astronauts + Open Porthole Window)
    // =========================================================================
    this.rocketCabinGroup = new THREE.Group();
    this.rocketCabinGroup.visible = false;

    const wallMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.68,
      metalness: 0.42,
      side: THREE.DoubleSide,
    });
    const ribMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.45,
      metalness: 0.72,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: '#64748b',
      roughness: 0.35,
      metalness: 0.85,
    });

    // Front bulkhead with exact circular porthole hole (radius 0.64 m) looking straight into Pass 1 3D scene
    const bulkShape = new THREE.Shape();
    bulkShape.moveTo(-2.1, -1.65);
    bulkShape.lineTo(2.1, -1.65);
    bulkShape.lineTo(2.1, 1.75);
    bulkShape.lineTo(-2.1, 1.75);
    bulkShape.closePath();

    const holePath = new THREE.Path();
    holePath.absarc(0, 0.36, 0.64, 0, Math.PI * 2, true);
    bulkShape.holes.push(holePath);

    const bulkGeom = new THREE.ExtrudeGeometry(bulkShape, {
      depth: 0.14,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      curveSegments: 48,
    });
    const bulkMesh = new THREE.Mesh(bulkGeom, wallMat);
    bulkMesh.position.set(0, 0, -1.68);
    this.rocketCabinGroup.add(bulkMesh);

    // Machined metallic porthole bezel & faint perimeter glare rim (center 100% transparent!)
    const bezelGeom = new THREE.TorusGeometry(0.65, 0.048, 16, 48);
    const bezel = new THREE.Mesh(bezelGeom, trimMat);
    bezel.position.set(0, 0.36, -1.53);
    this.rocketCabinGroup.add(bezel);

    const glareGeom = new THREE.RingGeometry(0.57, 0.64, 48);
    const glareMat = new THREE.MeshBasicMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glareRing = new THREE.Mesh(glareGeom, glareMat);
    glareRing.position.set(0, 0.36, -1.56);
    this.rocketCabinGroup.add(glareRing);

    // Curved Cabin Shell wrapping sides & rear so camera rotation ("смотреть сбоку") stays inside capsule
    const shellGeom = new THREE.CylinderGeometry(
      2.25,
      2.25,
      3.5,
      36,
      1,
      true,
      Math.PI + 0.68,
      Math.PI * 2 - 1.36,
    );
    const shellMesh = new THREE.Mesh(shellGeom, wallMat);
    shellMesh.position.set(0, 0.08, 0.25);
    this.rocketCabinGroup.add(shellMesh);

    // Cabin Floor & Ceiling Rings
    const floorGeom = new THREE.CircleGeometry(2.3, 36);
    floorGeom.rotateX(-Math.PI / 2);
    const floorMesh = new THREE.Mesh(floorGeom, wallMat);
    floorMesh.position.set(0, -1.12, 0.15);
    const ceilingMesh = new THREE.Mesh(floorGeom, ribMat);
    ceilingMesh.position.set(0, 1.62, 0.15);
    this.rocketCabinGroup.add(floorMesh, ceilingMesh);

    // Flight Instrument Console under the porthole
    const consoleBodyG = new THREE.BoxGeometry(1.75, 0.44, 0.56);
    const consoleBody = new THREE.Mesh(consoleBodyG, ribMat);
    consoleBody.position.set(0, -0.58, -1.25);
    consoleBody.rotation.x = -0.35;
    this.rocketCabinGroup.add(consoleBody);

    // Crisp Console Telemetry Screen
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 512;
    screenCanvas.height = 160;
    const sc = screenCanvas.getContext('2d')!;
    sc.fillStyle = '#071224';
    sc.fillRect(0, 0, 512, 160);
    sc.strokeStyle = '#38bdf8';
    sc.lineWidth = 3;
    sc.strokeRect(10, 10, 220, 140);
    sc.strokeRect(250, 10, 250, 140);
    sc.fillStyle = '#0ea5e9';
    sc.fillRect(28, 80, 184, 52);
    sc.fillStyle = '#38bdf8';
    sc.font = 'bold 20px monospace';
    sc.fillText('АЗИМУТ-40 // НАВ', 268, 44);
    sc.fillStyle = '#94a3b8';
    sc.font = '16px monospace';
    sc.fillText('КУРС: ЮГ / ОРБИТА', 268, 78);
    sc.fillText('ГРАНИЦА: 38-40 КМ', 268, 108);
    sc.fillStyle = '#22c55e';
    sc.fillRect(268, 124, 180, 12);

    const screenTex = new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
    const screenGeom = new THREE.PlaneGeometry(1.42, 0.34);
    const screenMesh = new THREE.Mesh(screenGeom, screenMat);
    screenMesh.position.set(0, -0.45, -1.03);
    screenMesh.rotation.x = -0.35;
    this.rocketCabinGroup.add(screenMesh);

    const alertG = new THREE.SphereGeometry(0.032, 12, 10);
    this.cabinAlertMat = new THREE.MeshBasicMaterial({ color: '#22c55e' });
    const alertLed = new THREE.Mesh(alertG, this.cabinAlertMat);
    alertLed.position.set(0, -0.26, -1.32);
    this.rocketCabinGroup.add(alertLed);

    // Two Seated Astronauts inside the capsule!
    const astroL = this.createSeatedAstronaut('#f1f5f9', '#f97316');
    astroL.position.set(-0.48, -0.35, -0.48);
    const astroR = this.createSeatedAstronaut('#e2e8f0', '#38bdf8');
    astroR.position.set(0.48, -0.35, -0.48);
    this.cabinAstronauts = [astroL, astroR];
    this.rocketCabinGroup.add(astroL, astroR);

    this.interiorScene.add(this.rocketCabinGroup);

    // =========================================================================
    // 2. ISS CUPOLA OBSERVATORY (Large 7-Pane Cupola + Floating Astronaut w/ Mic)
    // =========================================================================
    this.issCupolaGroup = new THREE.Group();
    this.issCupolaGroup.visible = false;

    const issWallMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.58,
      metalness: 0.45,
      side: THREE.DoubleSide,
    });
    const cupolaFrameMat = new THREE.MeshStandardMaterial({
      color: '#475569',
      roughness: 0.36,
      metalness: 0.82,
    });
    const handrailMat = new THREE.MeshStandardMaterial({
      color: '#facc15',
      roughness: 0.38,
      metalness: 0.25,
    });

    // Huge circular Cupola bulkhead aperture (radius 1.42 m open straight onto Pass 1 Flat Earth!)
    const cupWallShape = new THREE.Shape();
    cupWallShape.moveTo(-2.5, -2.0);
    cupWallShape.lineTo(2.5, -2.0);
    cupWallShape.lineTo(2.5, 2.2);
    cupWallShape.lineTo(-2.5, 2.2);
    cupWallShape.closePath();

    const cupHole = new THREE.Path();
    cupHole.absarc(0, 0.08, 1.42, 0, Math.PI * 2, true);
    cupWallShape.holes.push(cupHole);

    const cupWallGeom = new THREE.ExtrudeGeometry(cupWallShape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      curveSegments: 56,
    });
    const cupWall = new THREE.Mesh(cupWallGeom, issWallMat);
    cupWall.position.set(0, 0, -1.62);
    this.issCupolaGroup.add(cupWall);

    // Inner Nadir Circular Window Frame & 6 Radial Mullion Struts (iconic 7-pane ISS Cupola!)
    const outerCupRingG = new THREE.TorusGeometry(1.42, 0.055, 16, 56);
    const outerCupRing = new THREE.Mesh(outerCupRingG, cupolaFrameMat);
    outerCupRing.position.set(0, 0.08, -1.46);
    this.issCupolaGroup.add(outerCupRing);

    const innerCupRingG = new THREE.TorusGeometry(0.62, 0.038, 14, 48);
    const innerCupRing = new THREE.Mesh(innerCupRingG, cupolaFrameMat);
    innerCupRing.position.set(0, 0.08, -1.62);
    this.issCupolaGroup.add(innerCupRing);

    const strutG = new THREE.BoxGeometry(0.045, 0.82, 0.055);
    for (let i = 0; i < 6; i++) {
      const ang = (i * Math.PI) / 3 + Math.PI / 6;
      const strut = new THREE.Mesh(strutG, cupolaFrameMat);
      strut.position.set(Math.cos(ang) * 1.02, 0.08 + Math.sin(ang) * 1.02, -1.54);
      strut.rotation.z = ang - Math.PI / 2;
      strut.rotation.x = 0.18;
      this.issCupolaGroup.add(strut);
    }

    // Surrounding pressurized ISS observatory shell for 360° side camera rotation
    const issShellG = new THREE.CylinderGeometry(
      2.45,
      2.45,
      3.8,
      36,
      1,
      true,
      Math.PI + 0.72,
      Math.PI * 2 - 1.44,
    );
    const issShell = new THREE.Mesh(issShellG, issWallMat);
    issShell.position.set(0, 0.1, 0.3);
    this.issCupolaGroup.add(issShell);

    const issFloorMesh = new THREE.Mesh(floorGeom, issWallMat);
    issFloorMesh.position.set(0, -1.45, 0.1);
    this.issCupolaGroup.add(issFloorMesh);

    // Yellow EVA safety handrails around Cupola perimeter
    const railG = new THREE.CylinderGeometry(0.018, 0.018, 0.55, 10);
    const railL = new THREE.Mesh(railG, handrailMat);
    railL.position.set(-1.35, -0.25, -1.25);
    railL.rotation.z = 0.35;
    const railR = new THREE.Mesh(railG, handrailMat);
    railR.position.set(1.35, -0.25, -1.25);
    railR.rotation.z = -0.35;
    this.issCupolaGroup.add(railL, railR);

    // Floating Weightless Astronaut holding a Microphone!
    this.issAstronautGroup = new THREE.Group();
    const crewBlueMat = new THREE.MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.6, metalness: 0.1 });
    const crewAccentMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.45, metalness: 0.2 });
    const skinMat = new THREE.MeshStandardMaterial({ color: '#e6b89c', roughness: 0.65, metalness: 0.05 });
    const hairMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.8 });
    const micMetalMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.25, metalness: 0.9 });
    const micFoamMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.9 });
    const micGlowMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });

    const aTorsoG = new THREE.CapsuleGeometry(0.145, 0.36, 8, 16);
    const aTorso = new THREE.Mesh(aTorsoG, crewBlueMat);
    this.issAstronautGroup.add(aTorso);

    const beltG = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 16);
    const belt = new THREE.Mesh(beltG, crewAccentMat);
    belt.position.y = -0.14;
    this.issAstronautGroup.add(belt);

    const patchG = new THREE.BoxGeometry(0.08, 0.06, 0.02);
    const patch = new THREE.Mesh(patchG, crewAccentMat);
    patch.position.set(-0.07, 0.14, 0.14);
    this.issAstronautGroup.add(patch);

    // Head with headset
    const headG = new THREE.SphereGeometry(0.115, 18, 16);
    const head = new THREE.Mesh(headG, skinMat);
    head.position.set(0, 0.36, 0.02);
    this.issAstronautGroup.add(head);

    const hairG = new THREE.SphereGeometry(0.118, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const hair = new THREE.Mesh(hairG, hairMat);
    hair.position.set(0, 0.37, 0.01);
    this.issAstronautGroup.add(hair);

    // Floating legs splayed slightly in zero-G
    const aLegG = new THREE.CapsuleGeometry(0.062, 0.44, 6, 12);
    const legL = new THREE.Mesh(aLegG, crewBlueMat);
    legL.position.set(-0.11, -0.45, -0.06);
    legL.rotation.set(0.28, 0, -0.14);
    const legR = new THREE.Mesh(aLegG, crewBlueMat);
    legR.position.set(0.12, -0.42, 0.08);
    legR.rotation.set(-0.22, 0, 0.16);
    this.issAstronautGroup.add(legL, legR);

    // Left arm floating outward toward handrail
    const aArmG = new THREE.CapsuleGeometry(0.046, 0.36, 6, 10);
    const armL = new THREE.Mesh(aArmG, crewBlueMat);
    armL.position.set(-0.25, 0.12, -0.06);
    armL.rotation.set(0.35, 0, 0.65);
    this.issAstronautGroup.add(armL);

    // Right arm holding broadcast microphone!
    this.issMicArmGroup = new THREE.Group();
    this.issMicArmGroup.position.set(0.18, 0.18, 0.05);
    const armR = new THREE.Mesh(aArmG, crewBlueMat);
    armR.position.set(0.1, 0.04, 0.12);
    armR.rotation.set(-0.95, 0, -0.45);
    this.issMicArmGroup.add(armR);

    const micHandleG = new THREE.CylinderGeometry(0.018, 0.014, 0.19, 12);
    const micHandle = new THREE.Mesh(micHandleG, micMetalMat);
    micHandle.position.set(0.16, 0.16, 0.27);
    micHandle.rotation.x = -0.35;
    this.issMicArmGroup.add(micHandle);

    const micRingG = new THREE.TorusGeometry(0.022, 0.005, 8, 16);
    const micRing = new THREE.Mesh(micRingG, micGlowMat);
    micRing.position.set(0.16, 0.24, 0.23);
    micRing.rotation.x = Math.PI / 2 - 0.35;
    this.issMicArmGroup.add(micRing);

    const micHeadG = new THREE.SphereGeometry(0.036, 14, 12);
    const micHead = new THREE.Mesh(micHeadG, micFoamMat);
    micHead.position.set(0.16, 0.27, 0.22);
    this.issMicArmGroup.add(micHead);

    this.issAstronautGroup.add(this.issMicArmGroup);
    // Position beside Cupola window facing viewer & Earth
    this.issAstronautGroup.position.set(-0.62, -0.06, -0.28);
    this.issAstronautGroup.rotation.set(0.12, 0.42, -0.18);
    this.issCupolaGroup.add(this.issAstronautGroup);

    this.interiorScene.add(this.issCupolaGroup);

    this.disposables.push(
      wallMat,
      ribMat,
      trimMat,
      bulkGeom,
      bezelGeom,
      glareGeom,
      glareMat,
      shellGeom,
      floorGeom,
      consoleBodyG,
      screenTex,
      screenMat,
      screenGeom,
      alertG,
      this.cabinAlertMat,
      issWallMat,
      cupolaFrameMat,
      handrailMat,
      cupWallGeom,
      outerCupRingG,
      innerCupRingG,
      strutG,
      issShellG,
      railG,
      crewBlueMat,
      crewAccentMat,
      skinMat,
      hairMat,
      micMetalMat,
      micFoamMat,
      micGlowMat,
      aTorsoG,
      beltG,
      patchG,
      headG,
      hairG,
      aLegG,
      aArmG,
      micHandleG,
      micRingG,
      micHeadG,
    );
  }

  private animateInterior(altKm: number) {
    const t = this.windPhase;
    if (this.focusMode === 'broadcast_rocket') {
      const zeroGStart = Math.min(this.params.zeroGStartKm, this.params.zeroGFullKm - 0.2);
      const isZeroG = this.activeVariant === 'zero_g' && altKm >= zeroGStart;
      const isLaunchVib = this.isLaunching && !this.hasFailed && !this.antarcticSplashed && !isZeroG;

      // Alert LED color on console
      if (this.hasFailed || isZeroG || this.ufoInterceptActive || this.ufoIncinerated) {
        this.cabinAlertMat.color.setHex(Math.sin(t * 11) > 0 ? 0xf43f5e : 0x4ade80);
      } else if (this.antarcticSplashed || this.outerLandedActive) {
        this.cabinAlertMat.color.setHex(0x38bdf8);
      } else {
        this.cabinAlertMat.color.setHex(0x22c55e);
      }

      this.cabinAstronauts.forEach((astro, idx) => {
        const sign = idx === 0 ? -1 : 1;
        if (isZeroG || this.hasFailed) {
          astro.position.y = -0.35 + Math.sin(t * 2.2 + idx * 1.4) * 0.055;
          astro.rotation.z = Math.sin(t * 1.7 + idx) * 0.14;
          astro.rotation.x = Math.cos(t * 1.5 + idx) * 0.12;
        } else if (this.ufoInterceptActive) {
          astro.position.y = -0.35 + Math.sin(t * 36 + idx * 2) * 0.024;
          astro.rotation.z = sign * Math.sin(t * 24) * 0.08;
          astro.rotation.x = Math.cos(t * 20) * 0.06;
        } else if (this.antarcticSplashed) {
          astro.position.y = -0.35;
          astro.rotation.z = 0.24;
          astro.rotation.x = -0.18;
        } else if (isLaunchVib) {
          astro.position.y = -0.35 + Math.sin(t * 28 + idx * 3) * 0.008;
          astro.rotation.z = sign * Math.sin(t * 22) * 0.012;
          astro.rotation.x = Math.cos(t * 19) * 0.01;
        } else {
          astro.position.y = -0.35 + Math.sin(t * 1.6 + idx) * 0.006;
          astro.rotation.set(0, 0, 0);
        }
      });
    } else if (this.focusMode === 'broadcast_iss') {
      // Weightless microgravity floating astronaut with microphone & animated hand gesture when speaking
      const isSpeaking = this.issTalkPulseUntil > t;
      const talkAmp = isSpeaking ? 1.85 : 1.0;
      this.issAstronautGroup.position.set(
        -0.62 + Math.sin(t * 0.72) * 0.045,
        -0.06 + Math.sin(t * 0.98) * 0.085,
        -0.28 + Math.cos(t * 0.64) * 0.04,
      );
      this.issAstronautGroup.rotation.set(
        0.12 + Math.sin(t * 0.82) * 0.09,
        0.42 + Math.sin(t * 0.45) * 0.14,
        -0.18 + Math.cos(t * 0.76) * 0.1,
      );
      this.issMicArmGroup.rotation.x = Math.sin(t * (isSpeaking ? 6.5 : 1.9)) * 0.09 * talkAmp;
      this.issMicArmGroup.rotation.z = Math.cos(t * (isSpeaking ? 4.8 : 1.5)) * 0.07 * talkAmp;
    }
  }

  private buildZeroGBoundary() {
    const group = new THREE.Group();

    const makePlaneShader = (hex: string, gridScale: number, baseAlpha: number) =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color(hex) },
          uLaunchXZ: { value: new THREE.Vector2(LAUNCH_SITE.x, LAUNCH_SITE.z) },
        },
        vertexShader: `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
            #include <logdepthbuf_vertex>
          }
        `,
        fragmentShader: `
          #include <logdepthbuf_pars_fragment>
          uniform vec3 uColor;
          uniform vec2 uLaunchXZ;
          varying vec3 vWorldPos;
          void main() {
            #include <logdepthbuf_fragment>
            float rGlobal = length(vWorldPos.xz);
            float rLocal = length(vWorldPos.xz - uLaunchXZ);

            float localGrid = min(
              abs(fract(vWorldPos.x * ${gridScale.toFixed(3)}) - 0.5),
              abs(fract(vWorldPos.z * ${gridScale.toFixed(3)}) - 0.5)
            );
            float localLine = (1.0 - smoothstep(0.0, 0.04, localGrid)) * (1.0 - smoothstep(45.0, 140.0, rLocal));

            float globalRing = 1.0 - smoothstep(0.0, 0.06, abs(fract(rGlobal * 0.0005) - 0.5));
            float outerRim = smoothstep(20800.0, 21100.0, rGlobal) * (1.0 - smoothstep(21100.0, 21400.0, rGlobal));
            float globalFade = 1.0 - smoothstep(16000.0, 22500.0, rGlobal);

            float alpha = (${baseAlpha.toFixed(3)} + localLine * 0.14 + globalRing * 0.06) * globalFade + outerRim * 0.35;
            gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 0.45));
          }
        `,
      });

    const geom38 = new THREE.RingGeometry(0.1, 21500, 128);
    geom38.rotateX(-Math.PI / 2);
    const mat38 = makePlaneShader('#38bdf8', 0.1, 0.045);
    const plane38 = new THREE.Mesh(geom38, mat38);
    group.add(plane38);

    const geom40 = new THREE.RingGeometry(0.1, 21500, 128);
    geom40.rotateX(-Math.PI / 2);
    const mat40 = makePlaneShader('#818cf8', 0.1, 0.06);
    const plane40 = new THREE.Mesh(geom40, mat40);
    group.add(plane40);

    // Local 0 -> 70 km Altitude Scale Mast near launch corridor
    const mastH = 70;
    const mastGeom = new THREE.CylinderGeometry(0.08, 0.08, mastH, 8);
    const mastMat = new THREE.MeshBasicMaterial({
      color: '#475569',
      transparent: true,
      opacity: 0.45,
    });
    const mast = new THREE.Mesh(mastGeom, mastMat);
    mast.position.set(LAUNCH_SITE.x - 4.5, mastH / 2, LAUNCH_SITE.z - 2.5);
    group.add(mast);

    const marks = [
      { km: 10, text: '10 км · Атмосфера', color: '#94a3b8' },
      { km: 25, text: '25 км · Стратосфера', color: '#94a3b8' },
      { km: 39, text: '38–40 км · Поле невесомости', color: '#7dd3fc' },
      { km: 60, text: '60 км · Вакуумный шлейф', color: '#c4b5fd' },
    ];
    for (const m of marks) {
      const tickGeom = new THREE.BoxGeometry(1.2, 0.06, 0.06);
      const tickMat = new THREE.MeshBasicMaterial({ color: m.color });
      const tick = new THREE.Mesh(tickGeom, tickMat);
      tick.position.set(LAUNCH_SITE.x - 3.9, m.km, LAUNCH_SITE.z - 2.5);
      group.add(tick);

      const spr = makeTextSprite(m.text, m.color);
      spr.position.set(LAUNCH_SITE.x - 8.2, m.km, LAUNCH_SITE.z - 2.5);
      group.add(spr);
      this.disposables.push(tickGeom, tickMat, spr.material, spr.material.map!);
    }

    this.disposables.push(geom38, mat38, geom40, mat40, mastGeom, mastMat);
    this.scene.add(group);
    return { group, plane38, plane40 };
  }

  private buildRocket() {
    const group = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.42,
      metalness: 0.18,
    });
    const darkBandMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.72,
      metalness: 0.35,
    });
    const nozzleMetalMat = new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.25,
      metalness: 0.92,
    });
    const finMat = new THREE.MeshStandardMaterial({
      color: '#f59e0b',
      roughness: 0.5,
      metalness: 0.2,
    });

    const bodyGeom = new THREE.BoxGeometry(0.016, 0.072, 0.016);
    const bodyMesh = new THREE.Mesh(bodyGeom, hullMat);
    bodyMesh.position.y = 0.004;
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    const bandGeom = new THREE.BoxGeometry(0.017, 0.014, 0.017);
    const bandMesh = new THREE.Mesh(bandGeom, darkBandMat);
    bandMesh.position.y = -0.024;
    group.add(bandMesh);

    const noseGeom = new THREE.CylinderGeometry(0.0025, 0.0113, 0.022, 4);
    noseGeom.rotateY(Math.PI / 4);
    const noseMesh = new THREE.Mesh(noseGeom, darkBandMat);
    noseMesh.position.y = 0.051;
    noseMesh.castShadow = true;
    group.add(noseMesh);

    const finGeom = new THREE.BoxGeometry(0.002, 0.018, 0.01);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(finGeom, finMat);
      const angle = (i * Math.PI) / 2;
      fin.rotation.y = angle;
      fin.position.set(Math.sin(angle) * 0.011, -0.024, Math.cos(angle) * 0.011);
      group.add(fin);
    }

    const bellPts = [
      new THREE.Vector2(0.0025, 0.0),
      new THREE.Vector2(0.0038, -0.004),
      new THREE.Vector2(0.0068, -0.011),
      new THREE.Vector2(0.0082, -0.019),
      new THREE.Vector2(0.0074, -0.0195),
      new THREE.Vector2(0.003, -0.006),
    ];
    const nozzleGeom = new THREE.LatheGeometry(bellPts, 24);
    const nozzleMesh = new THREE.Mesh(nozzleGeom, nozzleMetalMat);
    nozzleMesh.position.y = -0.032;
    group.add(nozzleMesh);

    const glowGeom = new THREE.SphereGeometry(0.0055, 16, 12);
    const glowMat = new THREE.MeshBasicMaterial({ color: '#fb923c' });
    const nozzleGlow = new THREE.Mesh(glowGeom, glowMat);
    nozzleGlow.position.y = -0.044;
    nozzleGlow.visible = false;
    group.add(nozzleGlow);

    this.engineAnchor.position.set(0, -0.052, 0);
    group.add(this.engineAnchor);

    const coreLight = new THREE.PointLight('#93c5fd', 0, 8, 1.4);
    coreLight.position.set(0, -0.055, 0);
    group.add(coreLight);

    this.scene.add(group);
    this.disposables.push(
      hullMat,
      darkBandMat,
      nozzleMetalMat,
      finMat,
      bodyGeom,
      bandGeom,
      noseGeom,
      finGeom,
      nozzleGeom,
      glowGeom,
      glowMat,
    );

    return { group, nozzleGlow, coreLight };
  }

  private buildDebrisAndSplashes() {
    const hullMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.55, metalness: 0.25 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.75, metalness: 0.4 });
    const metalMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.3, metalness: 0.88 });
    const debrisSprayGeom = new THREE.SphereGeometry(1, 20, 14);
    const debrisFlareMatBase = makeGlowSprite('rgba(255,255,255,0.95)', 'rgba(147,197,253,0.42)');
    this.disposables.push(hullMat, darkMat, metalMat, debrisSprayGeom, debrisFlareMatBase, debrisFlareMatBase.map!);

    const makePiece = (geom: THREE.BufferGeometry, mat: THREE.Material, seed: number): DebrisPiece => {
      const grp = new THREE.Group();
      const m = new THREE.Mesh(geom, mat);
      grp.add(m);
      grp.visible = false;
      this.scene.add(grp);

      const sprayMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uGlowScale: { value: this.params.plumeGlow },
          uSeed: { value: seed },
        },
        vertexShader: `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vLocalDir;
          void main() {
            vLocalDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }
        `,
        fragmentShader: `
          #include <logdepthbuf_pars_fragment>
          uniform float uTime;
          uniform float uIntensity;
          uniform float uGlowScale;
          uniform float uSeed;
          varying vec3 vLocalDir;
          void main() {
            #include <logdepthbuf_fragment>
            if (uIntensity <= 0.01) discard;
            float phi = atan(vLocalDir.z, vLocalDir.x);
            float theta = acos(clamp(vLocalDir.y, -1.0, 1.0));
            float rayA = 0.5 + 0.5 * sin(phi * 14.0 + theta * 6.0 - uTime * 1.5 + uSeed);
            float rayB = 0.5 + 0.5 * cos(phi * 23.0 - theta * 11.0 + uTime * 1.1 - uSeed);
            float shafts = pow(rayA * 0.55 + rayB * 0.45, 2.2);
            vec3 col = mix(vec3(0.62, 0.82, 1.0), vec3(0.98, 0.99, 1.0), shafts);
            float alpha = (0.10 + shafts * 0.36) * uIntensity * uGlowScale;
            gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.8));
          }
        `,
      });
      const sprayMesh = new THREE.Mesh(debrisSprayGeom, sprayMat);
      sprayMesh.visible = false;
      sprayMesh.renderOrder = 8;
      this.scene.add(sprayMesh);

      const flareMat = debrisFlareMatBase.clone();
      const flareSprite = new THREE.Sprite(flareMat);
      flareSprite.visible = false;
      flareSprite.renderOrder = 9;
      this.scene.add(flareSprite);

      this.disposables.push(geom, sprayMat, flareMat);
      return {
        mesh: grp,
        sprayMesh,
        sprayMat,
        flareSprite,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        angVel: new THREE.Vector3(),
        splashed: false,
        smokeTimer: 0,
        glowAge: 0,
      };
    };

    const noseG = new THREE.CylinderGeometry(0.0025, 0.0113, 0.022, 4).rotateY(Math.PI / 4);
    const upperG = new THREE.BoxGeometry(0.016, 0.036, 0.016);
    const lowerG = new THREE.BoxGeometry(0.016, 0.036, 0.016);
    const engG = new THREE.CylinderGeometry(0.004, 0.0085, 0.022, 16);

    this.debrisPieces = [
      makePiece(noseG, darkMat, 0.4),
      makePiece(upperG, hullMat, 1.9),
      makePiece(lowerG, hullMat, 3.3),
      makePiece(engG, metalMat, 5.1),
    ];

    const ringGeom = new THREE.RingGeometry(0.025, 0.065, 32).rotateX(-Math.PI / 2);
    this.disposables.push(ringGeom);
    for (let i = 0; i < MAX_SPLASH_RINGS; i++) {
      const rMat = new THREE.MeshBasicMaterial({
        color: '#e0f2fe',
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeom, rMat);
      ringMesh.visible = false;
      this.scene.add(ringMesh);
      this.disposables.push(rMat);
      this.splashRings.push({ mesh: ringMesh, age: 0, active: false });
    }
  }

  private buildJellyfishAndLightSpray() {
    // 1. Compact 360° Radial Light-Spray Sphere centered right on the engine nozzle
    const sprayGeom = new THREE.SphereGeometry(1, 36, 28);
    const lightSprayMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uGlowScale: { value: this.params.plumeGlow },
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vLocalDir;
        void main() {
          vLocalDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <logdepthbuf_pars_fragment>
        uniform float uTime;
        uniform float uIntensity;
        uniform float uGlowScale;
        varying vec3 vLocalDir;

        void main() {
          #include <logdepthbuf_fragment>
          if (uIntensity <= 0.005) discard;
          float phi = atan(vLocalDir.z, vLocalDir.x);
          float theta = acos(clamp(vLocalDir.y, -1.0, 1.0));

          float rayA = 0.5 + 0.5 * sin(phi * 18.0 + theta * 7.0 - uTime * 1.4);
          float rayB = 0.5 + 0.5 * cos(phi * 29.0 - theta * 13.0 + uTime * 0.9);
          float shafts = pow(rayA * 0.55 + rayB * 0.45, 2.4);

          vec3 col = mix(vec3(0.58, 0.80, 1.0), vec3(0.96, 0.99, 1.0), shafts);
          float alpha = (0.08 + shafts * 0.30) * uIntensity * uGlowScale;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.78));
        }
      `,
    });
    const lightSprayMesh = new THREE.Mesh(sprayGeom, lightSprayMat);
    lightSprayMesh.visible = false;
    lightSprayMesh.renderOrder = 8;
    this.scene.add(lightSprayMesh);

    // 2. Compact Luminous Jellyfish Cloud expanding gradually around the rocket & engine
    const pts: THREE.Vector2[] = [];
    const segs = 34;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      let r: number;
      if (t < 0.24) {
        const k = t / 0.24;
        r = Math.sin(k * (Math.PI / 2)) * 0.9;
      } else {
        const k = (t - 0.24) / 0.76;
        r = Math.pow(1.0 - k, 0.74) * 0.9 + Math.sin(k * Math.PI) * 0.08;
      }
      const y = 0.42 - t * 3.4;
      pts.push(new THREE.Vector2(Math.max(0.005, r), y));
    }
    const jellyGeom = new THREE.LatheGeometry(pts, 48);

    const jellyfishMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uGlowScale: { value: this.params.plumeGlow },
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          vNormalView = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <logdepthbuf_pars_fragment>
        uniform float uTime;
        uniform float uIntensity;
        uniform float uGlowScale;
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        varying vec3 vLocalPos;

        void main() {
          #include <logdepthbuf_fragment>
          if (uIntensity <= 0.005) discard;

          vec3 N = normalize(vNormalView);
          vec3 V = normalize(vViewPos);
          float ndotv = abs(dot(N, V));

          float fresnel = pow(1.0 - ndotv, 1.85);
          float bodyFill = 0.14 * pow(ndotv, 0.7);

          float angle = atan(vLocalPos.z, vLocalPos.x);
          float ray1 = 0.5 + 0.5 * sin(angle * 22.0 + vLocalPos.y * 1.4 - uTime * 0.8);
          float ray2 = 0.5 + 0.5 * sin(angle * 37.0 - vLocalPos.y * 2.1 + uTime * 1.2);
          float striations = pow(ray1 * 0.65 + ray2 * 0.35, 2.2);

          float axialFade = smoothstep(-2.85, -1.0, vLocalPos.y) * (1.0 - smoothstep(0.15, 0.42, vLocalPos.y));
          float nozzleCore = exp(-pow(vLocalPos.y * 2.4, 2.0)) * 0.65;

          vec3 icyBlue = vec3(0.72, 0.87, 1.0);
          vec3 coreWhite = vec3(0.96, 0.99, 1.0);
          vec3 outerViolet = vec3(0.58, 0.72, 0.98);

          vec3 col = mix(outerViolet, icyBlue, striations);
          col = mix(col, coreWhite, clamp(nozzleCore + fresnel * 0.45, 0.0, 1.0));

          float alpha = (fresnel * 0.62 + bodyFill + striations * 0.25 + nozzleCore * 0.38)
                        * axialFade * uIntensity * uGlowScale;

          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.9));
        }
      `,
    });

    const jellyfishMesh = new THREE.Mesh(jellyGeom, jellyfishMat);
    jellyfishMesh.visible = false;
    jellyfishMesh.renderOrder = 8;
    this.scene.add(jellyfishMesh);

    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.width = 256;
    spriteCanvas.height = 256;
    const sctx = spriteCanvas.getContext('2d')!;
    const grad = sctx.createRadialGradient(128, 128, 2, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.18, 'rgba(219, 234, 254, 0.88)');
    grad.addColorStop(0.48, 'rgba(147, 197, 253, 0.32)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 256, 256);

    const flareTex = new THREE.CanvasTexture(spriteCanvas);
    flareTex.colorSpace = THREE.SRGBColorSpace;
    const flareMat = new THREE.SpriteMaterial({
      map: flareTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreFlare = new THREE.Sprite(flareMat);
    coreFlare.visible = false;
    coreFlare.renderOrder = 9;
    this.scene.add(coreFlare);

    this.disposables.push(sprayGeom, lightSprayMat, jellyGeom, jellyfishMat, flareTex, flareMat);
    return { lightSprayMesh, lightSprayMat, jellyfishMesh, jellyfishMat, coreFlare };
  }

  private buildExhaustParticles() {
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const vel = new Float32Array(MAX_PARTICLES * 3);
    const age = new Float32Array(MAX_PARTICLES);
    const life = new Float32Array(MAX_PARTICLES);
    const size = new Float32Array(MAX_PARTICLES);
    const temp = new Float32Array(MAX_PARTICLES);

    age.fill(999);
    life.fill(1);

    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    geom.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geom.setAttribute('aTemp', new THREE.BufferAttribute(temp, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uGlowScale: { value: this.params.plumeGlow },
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aAge;
        attribute float aLife;
        attribute float aSize;
        attribute float aTemp;
        uniform float uPixelRatio;
        varying float vProgress;
        varying float vTemp;

        void main() {
          vProgress = clamp(aAge / max(0.01, aLife), 0.0, 1.0);
          vTemp = aTemp;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float isAlive = step(aAge, aLife);
          float grow = mix(0.65, 2.2, vProgress);
          gl_PointSize = isAlive * aSize * grow * uPixelRatio * (300.0 / max(0.15, -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <logdepthbuf_pars_fragment>
        uniform float uGlowScale;
        varying float vProgress;
        varying float vTemp;

        void main() {
          #include <logdepthbuf_fragment>
          if (vProgress >= 0.99) discard;
          vec2 cxy = 2.0 * gl_PointCoord - 1.0;
          float r2 = dot(cxy, cxy);
          if (r2 > 1.0) discard;

          float soft = exp(-r2 * 2.5);
          float fade = (1.0 - vProgress) * smoothstep(0.0, 0.07, vProgress);

          vec3 hotCol = mix(vec3(1.0, 0.92, 0.72), vec3(0.98, 0.48, 0.14), smoothstep(0.0, 0.55, vProgress));
          vec3 zeroGCol = mix(vec3(0.96, 0.99, 1.0), vec3(0.55, 0.78, 1.0), smoothstep(0.1, 0.85, vProgress));
          vec3 smokeCol = vec3(0.62, 0.68, 0.76);

          vec3 col = vTemp > 1.5
            ? smokeCol
            : mix(hotCol, zeroGCol, clamp(vTemp, 0.0, 1.0));

          float alpha = soft * fade * (vTemp > 1.5 ? 0.45 : (0.48 + 0.32 * uGlowScale));
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
        }
      `,
    });

    const points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    points.renderOrder = 7;
    this.scene.add(points);
    this.disposables.push(geom, mat);

    return { geom, mat, pos, vel, age, life, size, temp };
  }

  private buildContrail() {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_TRAIL_POINTS * 3);
    const colors = new Float32Array(MAX_TRAIL_POINTS * 3);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setDrawRange(0, 0);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(220,238,255,0.75)');
    g.addColorStop(1, 'rgba(180,210,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.PointsMaterial({
      size: 0.22,
      map: tex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    const points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    points.renderOrder = 6;
    this.scene.add(points);
    this.disposables.push(geom, tex, mat);

    return { geom, positions, colors, points };
  }

  public updateParams(next: SimulationParams) {
    const outerChanged =
      Math.abs(next.outerLandsVisibility - this.params.outerLandsVisibility) > 0.01;
    this.params = { ...next };

    this.boundaryGroup.visible = next.showBoundaryPlane;
    this.updateBoundaryPositions();
    this.jellyfishMat.uniforms.uGlowScale.value = next.plumeGlow;
    this.lightSprayMat.uniforms.uGlowScale.value = next.plumeGlow;
    this.particleMat.uniforms.uGlowScale.value = next.plumeGlow;
    for (const p of this.debrisPieces) {
      p.sprayMat.uniforms.uGlowScale.value = next.plumeGlow;
    }

    if (outerChanged) {
      this.mapTextures.updateOuterLandsVisibility(next.outerLandsVisibility);
    }
  }

  private updateBoundaryPositions() {
    this.boundaryPlane38.position.y = this.params.zeroGStartKm;
    this.boundaryPlane40.position.y = this.params.zeroGFullKm;
  }

  public setDialogueListener(cb?: (d: BroadcastDialogue) => void) {
    this.onDialogue = cb;
  }

  private emitDialogue(speaker: string, text: string, channel: 'rocket' | 'iss' | 'ufo', onceKey?: string) {
    if (onceKey) {
      if (this.dialogueFlags.has(onceKey)) return;
      this.dialogueFlags.add(onceKey);
    }
    if (channel === 'iss') {
      this.issTalkPulseUntil = this.windPhase + 3.2;
    }
    this.onDialogue?.({ speaker, text, channel, timestamp: Date.now() });
  }

  public triggerInteractivePrompt(channel: 'iss' | 'rocket', topic: string) {
    if (channel === 'iss') {
      const answers: Record<string, string> = {
        stars:
          'Официально докладываю: звёзд на снимках нет из-за короткой выдержки камеры и яркого альбедо Земли. Просто поверьте нашим приборам.',
        shape:
          'По протоколу ЦУП мы вращаемся вокруг Земного шара! То, что в куполе внизу кажется диском с ледяным кольцом — это оптический широкоугольный эффект.',
        space:
          'Высота 400 км, мы в глубоком открытом космосе! Да, парим на тросах в невесомости... простите, микрогравитации.',
        report:
          'Обстановка штатная, полёт нормальный! Вода в стакане круглая, волосы дыбом, всё строго по учебнику астрономии.',
      };
      this.emitDialogue('Бортинженер МКС (в микрофон)', answers[topic] ?? answers.report, 'iss');
    } else {
      const answers: Record<string, string> = {
        barrier:
          'Командир: Наш курс — строго на юг, ниже 40 км! Нужно дотянуть до ледяного барьера Антарктиды и перелететь его, чтобы увидеть, что там!',
        beyond:
          'Штурман: Если прорвёмся за ледяную стену, там огромные неизвестные материки! Главное — не нарваться на патруль летающих тарелок.',
        status:
          this.ufoInterceptActive
            ? 'Тревога!! Три НЛО над Антарктидой бьют по нам зелёными лазерами! Падаем в ледяное море!'
            : this.outerBreakoutActive || this.parachuteDescentActive
              ? 'Мы прошли ледяной барьер Антарктиды!! Готовим парашют и капсулу к посадке на внешние земли!'
              : this.outerLandedActive
                ? 'УРА! УРА! Мы вылезли из капсулы, мы стоим на землях за Антарктидой!! Стойте... что это светится в небе?!'
                : 'Идём ниже поля невесомости. Двигатель работает стабильно, горизонт абсолютно плоский!',
      };
      this.emitDialogue('Экипаж корабля', answers[topic] ?? answers.barrier, 'rocket');
    }
  }

  private getTrackedTarget(out: THREE.Vector3) {
    if (this.focusMode === 'pedestrian') {
      out.copy(this.pedPos).add(new THREE.Vector3(0, 0.0016, 0));
    } else if (this.focusMode === 'iss') {
      out.copy(this.issGroup.position);
    } else if (
      this.parachuteDescentActive ||
      this.outerLandedActive ||
      this.ufoIncinerated
    ) {
      out.copy(this.capsuleGroup.position);
    } else if (this.hasFailed) {
      out.copy(this.debrisPieces[2].pos);
    } else if (this.focusMode === 'engine') {
      this.engineAnchor.getWorldPosition(out);
    } else {
      out.copy(this.rocketPos);
    }
  }

  public setFocusMode(mode: CameraFocusMode) {
    this.focusMode = mode;
    const isBroadcast = mode === 'broadcast_rocket' || mode === 'broadcast_iss';
    const isPed = mode === 'pedestrian';

    this.controls.enabled = !isBroadcast;
    this.interiorControls.enabled = isBroadcast;
    this.rocketCabinGroup.visible = mode === 'broadcast_rocket';
    this.issCupolaGroup.visible = mode === 'broadcast_iss';

    // Hide exterior vehicle geometry only when inside its live interior broadcast
    this.rocketGroup.visible =
      !this.hasFailed &&
      !this.parachuteDescentActive &&
      !this.outerLandedActive &&
      !this.ufoIncinerated &&
      mode !== 'broadcast_rocket';
    this.issGroup.visible = mode !== 'broadcast_iss';

    this.localSettlementGroup.visible = isPed;
    this.pedestrianGroup.visible = isPed;
    this.weatherGroup.visible = isPed && this.effectiveWeather !== 'clear';
    this.atmosphereLimbMesh.visible = !isPed;
    this.earthTopMesh.position.y = isPed ? -2.0 : 0;
    this.earthIceWall.position.y = isPed ? -2.0 : 0;
    this.earthLocalSpaceportPatch.visible = !isPed;
    this.applyPedestrianAtmosphereFog();

    // Tune camera near/far clip & OrbitControls limits for crisp human-scale walk vs 28,000 km Earth
    if (isPed) {
      this.camera.near = 0.0012;
      this.camera.far = 65000;
      this.camera.fov = 52;
      this.controls.minDistance = 0.0045;
      this.controls.maxDistance = 0.48;
      this.controls.maxPolarAngle = Math.PI * 0.485;
    } else {
      this.camera.near = 0.02;
      this.camera.far = 220000;
      this.camera.fov = isBroadcast ? 54 : 48;
      this.controls.minDistance = 0.07;
      this.controls.maxDistance = 68000;
      this.controls.maxPolarAngle = Math.PI * 0.495;
    }
    this.camera.updateProjectionMatrix();

    if (mode !== 'map' && this.dropPinMode) {
      this.dropPinMode = false;
    }

    if (isBroadcast) {
      if (mode === 'broadcast_rocket') {
        this.interiorCamera.position.set(0.32, 0.34, 1.56);
        this.interiorControls.target.set(0, 0.08, -0.58);
        this.emitDialogue(
          'Командир экипажа',
          this.activeVariant === 'antarctica'
            ? 'Мы должны пролететь за ледяной барьер Антарктиды и посмотреть, что там!'
            : 'Проверка систем перед проходом поля невесомости 40 км. Нам нужно пробиться к Антарктиде!',
          'rocket',
        );
      } else {
        this.interiorCamera.position.set(0.42, 0.18, 1.58);
        this.interiorControls.target.set(-0.2, 0.02, -0.68);
        this.emitDialogue(
          'Бортинженер МКС (в микрофон)',
          'Прямой эфир с высоты 400 км! Мы находимся в космосе над земным шаром. Звёзд не видно — яркий свет Земли слепит матрицу.',
          'iss',
        );
      }
      this.interiorControls.update();
      this.camTransitionActive = false;
    } else if (isPed) {
      this.camDesiredOffset.set(0.012, 0.0058, 0.014);
      this.camTransitionActive = true;
    } else if (mode === 'map') {
      this.camStaticTarget.set(0, 0, 0);
      this.camDesiredOffset.set(0, 26000, 32000);
      this.camTransitionActive = true;
    } else if (mode === 'iss') {
      this.camDesiredOffset.set(0.24, 0.09, 0.26);
      this.camTransitionActive = true;
    } else if (mode === 'plume') {
      this.camDesiredOffset.set(2.4, 0.75, 2.8);
      this.camTransitionActive = true;
    } else if (mode === 'rocket') {
      this.camDesiredOffset.set(0.32, 0.12, 0.34);
      this.camTransitionActive = true;
    } else if (mode === 'engine') {
      this.camDesiredOffset.set(0.14, 0.03, 0.16);
      this.camTransitionActive = true;
    }
    if (!isPed) {
      this.pedMoveVec.set(0, 0);
      this.pedSprint = false;
    }
    this.hasTrackTarget = false;
    this.emitTelemetry(true);
  }

  public zoomStep(factor: number) {
    if (this.focusMode === 'broadcast_rocket' || this.focusMode === 'broadcast_iss') {
      _v1.subVectors(this.interiorCamera.position, this.interiorControls.target);
      const len = _v1.length();
      const nextLen = THREE.MathUtils.clamp(
        len * factor,
        this.interiorControls.minDistance,
        this.interiorControls.maxDistance,
      );
      _v1.normalize().multiplyScalar(nextLen);
      this.interiorCamera.position.copy(this.interiorControls.target).add(_v1);
      this.interiorControls.update();
      return;
    }

    this.camTransitionActive = false;
    _v1.subVectors(this.camera.position, this.controls.target);
    const len = _v1.length();
    const nextLen = THREE.MathUtils.clamp(
      len * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    _v1.normalize().multiplyScalar(nextLen);
    this.camera.position.copy(this.controls.target).add(_v1);
    this.controls.update();
  }

  public launch() {
    if (this.isLaunching) {
      this.resetSimulation();
    }
    // Guarantee launch occurs on the dark night half of Earth
    this.sunAngle = LAUNCH_ANGLE + Math.PI;
    this.moonAngle = LAUNCH_ANGLE + Math.PI * 0.25;
    this.updateCelestialBodies(0);

    this.launchCount += 1;
    this.isLaunching = true;
    this.hasFailed = false;
    this.antarcticSplashed = false;
    this.antarcticSplashTime = 0;
    this.antarcticWaterTimer = 0;
    this.ufoInterceptActive = false;
    this.outerBreakoutActive = false;
    this.parachuteDescentActive = false;
    this.outerLandedActive = false;
    this.outerLandingTime = 0;
    this.ufoIncinerated = false;
    this.ufoIncinerateTime = 0;
    this.dialogueFlags.clear();
    this.splashedCount = 0;
    this.nozzleGlowMesh.visible = true;

    if (this.params.launchMode === 'variant_zero_g') {
      this.activeVariant = 'zero_g';
      this.plannedFailureAltKm = null;
    } else if (this.params.launchMode === 'variant_antarctica') {
      this.activeVariant = 'antarctica';
      this.plannedFailureAltKm = null;
    } else if (this.params.launchMode === 'forced_failure') {
      this.activeVariant = 'failure';
      this.plannedFailureAltKm = 16 + Math.random() * 26;
    } else {
      // Combined default: alternates Variant 1 (>40 km zero-G loss) and Variant 2 (Antarctica)
      this.activeVariant = this.launchCount % 2 === 1 ? 'zero_g' : 'antarctica';
      this.plannedFailureAltKm = null;
    }

    if (this.activeVariant === 'antarctica') {
      this.antarcticaLaunchCount += 1;
      // 1st Antarctica run -> UFO laser intercept at the wall; 2nd run -> Breakout & parachute! Later: 45% breakout
      if (this.antarcticaLaunchCount === 1) {
        this.antarcticOutcome = 'ufo_intercept';
      } else if (this.antarcticaLaunchCount === 2) {
        this.antarcticOutcome = 'outer_parachute';
      } else {
        this.antarcticOutcome = Math.random() < 0.45 ? 'outer_parachute' : 'ufo_intercept';
      }
      this.emitDialogue(
        'Командир экипажа',
        'Взлёт! Идём ниже 40 км прямо на ледяной барьер Антарктиды — надо перелететь и посмотреть, что там!',
        'rocket',
        'ant_start',
      );
    }

    if (this.focusMode === 'map' || this.focusMode === 'free' || this.focusMode === 'iss') {
      this.setFocusMode('rocket');
    }
    this.emitTelemetry(true);
  }

  public triggerFailure() {
    if (!this.isLaunching || this.hasFailed || this.antarcticSplashed || this.ufoIncinerated) return;
    this.hasFailed = true;
    this.activeVariant = 'failure';
    this.plannedFailureAltKm = null;
    this.rocketGroup.visible = false;
    this.jellyfishMesh.visible = false;
    this.lightSprayMesh.visible = false;
    this.coreFlareSprite.visible = false;
    this.nozzleCoreLight.intensity = 0;

    // Separation flash particles
    for (let i = 0; i < 40; i++) {
      const idx = this.particleCursor;
      this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
      _dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.particlePos[idx * 3] = this.rocketPos.x;
      this.particlePos[idx * 3 + 1] = this.rocketPos.y;
      this.particlePos[idx * 3 + 2] = this.rocketPos.z;
      const sp = 0.08 + Math.random() * 0.22;
      this.particleVel[idx * 3] = this.rocketVel.x * 0.3 + _dir.x * sp;
      this.particleVel[idx * 3 + 1] = this.rocketVel.y * 0.3 + _dir.y * sp;
      this.particleVel[idx * 3 + 2] = this.rocketVel.z * 0.3 + _dir.z * sp;
      this.particleAge[idx] = 0;
      this.particleLife[idx] = 0.9 + Math.random() * 0.6;
      this.particleSize[idx] = 0.09 + Math.random() * 0.1;
      this.particleTemp[idx] = 0.05;
    }

    const offsets = [0.045, 0.015, -0.018, -0.045];
    const sepVels = [
      new THREE.Vector3(0.14, 0.05, -0.08),
      new THREE.Vector3(-0.15, -0.14, -0.10),
      new THREE.Vector3(0.09, -0.22, -0.12),
      new THREE.Vector3(-0.08, -0.30, -0.15),
    ];

    this.debrisPieces.forEach((p, idx) => {
      p.mesh.visible = true;
      p.sprayMesh.visible = true;
      p.flareSprite.visible = true;
      p.splashed = false;
      p.smokeTimer = 0;
      p.glowAge = 0;
      _rocketUp.set(0, 1, 0).applyQuaternion(this.rocketQuat);
      p.pos.copy(this.rocketPos).addScaledVector(_rocketUp, offsets[idx]);
      p.vel.copy(this.rocketVel).multiplyScalar(0.08).add(sepVels[idx]);
      p.vel.addScaledVector(DOWNRANGE_DIR, 0.14 + idx * 0.035);
      p.quat.copy(this.rocketQuat);
      p.angVel.set(
        (Math.random() - 0.5) * 2.4,
        (Math.random() - 0.5) * 2.4,
        (Math.random() - 0.5) * 2.4,
      );
      p.mesh.position.copy(p.pos);
      p.mesh.quaternion.copy(p.quat);
      p.sprayMesh.position.copy(p.pos);
      p.flareSprite.position.copy(p.pos);
    });

    this.emitTelemetry(true);
  }

  public resetSimulation() {
    this.isLaunching = false;
    this.hasFailed = false;
    this.antarcticSplashed = false;
    this.antarcticSplashTime = 0;
    this.antarcticWaterTimer = 0;
    this.ufoInterceptActive = false;
    this.outerBreakoutActive = false;
    this.parachuteDescentActive = false;
    this.outerLandedActive = false;
    this.outerLandingTime = 0;
    this.ufoIncinerated = false;
    this.ufoIncinerateTime = 0;
    this.dialogueFlags.clear();
    this.plannedFailureAltKm = null;
    this.splashedCount = 0;
    this.missionTime = 0;
    this.activeVariant =
      this.params.launchMode === 'variant_antarctica'
        ? 'antarctica'
        : this.params.launchMode === 'forced_failure'
          ? 'failure'
          : 'zero_g';

    // Reset Sun opposite LAUNCH_SITE -> dark side launch guaranteed
    this.sunAngle = LAUNCH_ANGLE + Math.PI;
    this.moonAngle = LAUNCH_ANGLE + Math.PI * 0.25;
    this.updateCelestialBodies(0);

    this.rocketPos.set(LAUNCH_SITE.x, 0.062, LAUNCH_SITE.z);
    this.rocketVel.set(0, 0, 0);
    this.rocketQuat.identity();
    this.angularVel.set(0, 0, 0);
    this.tumbleSeed = (Math.random() > 0.5 ? 1 : -1) * (0.85 + Math.random() * 0.45);
    this.windPhase = 0;

    this.rocketGroup.visible = this.focusMode !== 'broadcast_rocket';
    this.rocketGroup.position.copy(this.rocketPos);
    this.rocketGroup.quaternion.copy(this.rocketQuat);
    this.nozzleGlowMesh.visible = false;
    this.nozzleCoreLight.intensity = 0;
    this.jellyfishMesh.visible = false;
    this.jellyfishMat.uniforms.uIntensity.value = 0;
    this.lightSprayMesh.visible = false;
    this.lightSprayMat.uniforms.uIntensity.value = 0;
    this.coreFlareSprite.visible = false;

    for (const u of this.ufoFleet) {
      u.group.visible = false;
      u.beam.visible = false;
      u.impactRing.visible = false;
    }
    this.capsuleGroup.visible = false;
    this.parachuteCanopy.visible = true;
    this.capsuleBodyMat.color.set('#e2e8f0');
    this.scorchGlowSprite.visible = false;
    for (let i = 0; i < this.evaAstronauts.length; i++) {
      this.evaAstronauts[i].visible = false;
      this.evaSpeechSprites[i].visible = false;
    }

    for (const p of this.debrisPieces) {
      p.mesh.visible = false;
      p.sprayMesh.visible = false;
      p.flareSprite.visible = false;
      p.splashed = false;
    }
    for (const r of this.splashRings) {
      r.active = false;
      r.mesh.visible = false;
    }

    this.particleAge.fill(999);
    this.particleGeom.attributes.aAge.needsUpdate = true;

    this.trailPoints = [];
    this.trailLineGeom.setDrawRange(0, 0);
    this.hasTrackTarget = false;

    this.emitTelemetry(true);
  }

  private spawnExhaustParticle(zeroGRatio: number, altKm: number) {
    const idx = this.particleCursor;
    this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;

    this.engineAnchor.getWorldPosition(_nozzleWorld);
    _rocketUp.set(0, 1, 0).applyQuaternion(this.rocketQuat).normalize();

    if (zeroGRatio < 0.15) {
      const spread = 0.09 + zeroGRatio * 0.55;
      _dir
        .copy(_rocketUp)
        .negate()
        .add(
          _v1.set(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread * 0.5,
            (Math.random() - 0.5) * spread,
          ),
        )
        .normalize();
      const speed = 0.28 + Math.random() * 0.2;
      this.particleVel[idx * 3] = this.rocketVel.x * 0.3 + _dir.x * speed;
      this.particleVel[idx * 3 + 1] = this.rocketVel.y * 0.3 + _dir.y * speed;
      this.particleVel[idx * 3 + 2] = this.rocketVel.z * 0.3 + _dir.z * speed;
      this.particleLife[idx] = 0.42 + Math.random() * 0.3;
      this.particleSize[idx] = 0.018 + Math.random() * 0.02;
      this.particleTemp[idx] = zeroGRatio * 0.4;
    } else {
      // Compact 360° engine-centered gas/light cloud expanding gradually from the nozzle
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const sqrtOneMinusU2 = Math.sqrt(1 - u * u);
      _dir.set(sqrtOneMinusU2 * Math.cos(theta), u, sqrtOneMinusU2 * Math.sin(theta));

      const isotropicMix = THREE.MathUtils.smoothstep(zeroGRatio, 0.15, 1.0);
      _v2.copy(_rocketUp).negate();
      _dir.lerp(_v2, (1 - isotropicMix) * 0.6).normalize();

      // Gradual, bounded cloud growth around rocket (never overly huge)
      const growthFactor = (0.35 + Math.min(1.0, Math.max(0, altKm - 38) * 0.04)) * this.params.plumeDispersion;
      const dispSpeed = (0.14 + Math.random() * 0.26) * growthFactor;
      this.particleVel[idx * 3] = this.rocketVel.x * 0.55 + _dir.x * dispSpeed;
      this.particleVel[idx * 3 + 1] = this.rocketVel.y * 0.55 + _dir.y * dispSpeed;
      this.particleVel[idx * 3 + 2] = this.rocketVel.z * 0.55 + _dir.z * dispSpeed;
      this.particleLife[idx] = 1.6 + Math.random() * 1.4;
      this.particleSize[idx] = (0.032 + Math.random() * 0.055) * growthFactor;
      this.particleTemp[idx] = Math.min(1, 0.45 + zeroGRatio * 0.55);
    }

    this.particlePos[idx * 3] = _nozzleWorld.x;
    this.particlePos[idx * 3 + 1] = _nozzleWorld.y;
    this.particlePos[idx * 3 + 2] = _nozzleWorld.z;
    this.particleAge[idx] = 0;
  }

  private spawnOceanSplash(pos: THREE.Vector3) {
    const ring = this.splashRings.find((r) => !r.active) || this.splashRings[0];
    ring.active = true;
    ring.age = 0;
    ring.mesh.visible = true;
    ring.mesh.position.set(pos.x, 0.015, pos.z);
    ring.mesh.scale.set(1, 1, 1);

    for (let i = 0; i < 24; i++) {
      const idx = this.particleCursor;
      this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
      const ang = Math.random() * Math.PI * 2;
      const sp = 0.06 + Math.random() * 0.16;
      this.particlePos[idx * 3] = pos.x;
      this.particlePos[idx * 3 + 1] = 0.02;
      this.particlePos[idx * 3 + 2] = pos.z;
      this.particleVel[idx * 3] = Math.cos(ang) * sp;
      this.particleVel[idx * 3 + 1] = 0.1 + Math.random() * 0.2;
      this.particleVel[idx * 3 + 2] = Math.sin(ang) * sp;
      this.particleAge[idx] = 0;
      this.particleLife[idx] = 1.1 + Math.random() * 0.7;
      this.particleSize[idx] = 0.04 + Math.random() * 0.05;
      this.particleTemp[idx] = 2.0;
    }
  }

  private updateUfoLaserBeams(targetPos: THREE.Vector3, activeBeams: boolean, timeNow: number) {
    this.ufoFleet.forEach((u, idx) => {
      u.group.visible = true;
      const hoverX = Math.sin(timeNow * 1.4 + idx * 2.1) * 0.05;
      const hoverY = Math.cos(timeNow * 1.8 + idx * 1.7) * 0.025;
      u.group.position.set(
        targetPos.x + u.offset.x + hoverX,
        targetPos.y + u.offset.y + hoverY,
        targetPos.z + u.offset.z,
      );
      u.group.rotation.y = timeNow * 2.4 + idx;

      if (activeBeams) {
        u.beam.visible = true;
        _v1.subVectors(targetPos, u.group.position);
        const dist = _v1.length();
        u.beam.position.copy(u.group.position);
        if (dist > 0.001) {
          _v2.copy(_v1).normalize();
          _qDelta.setFromUnitVectors(_v3.set(0, 1, 0), _v2);
          u.beam.quaternion.copy(_qDelta);
          const pulse = 0.75 + 0.45 * Math.sin(timeNow * 24 + idx * 1.9);
          u.beam.scale.set(pulse, dist, pulse);
        }

        u.impactRing.visible = true;
        u.impactRing.position.copy(targetPos);
        const s = 0.6 + ((timeNow * 3 + idx * 0.33) % 1) * 1.4;
        u.impactRing.scale.set(s, s, s);
      } else {
        u.beam.visible = false;
        u.impactRing.visible = false;
      }
    });
  }

  private stepSimulation(dt: number) {
    const simDt = dt * this.params.timeScale;
    this.windPhase += simDt;
    this.updateCelestialBodies(simDt);
    this.updateISS(simDt);
    if (this.cloudLowLayerMesh) {
      this.cloudLowLayerMesh.rotation.y += 0.0013 * simDt;
    }
    if (this.cloudLayerMesh) {
      this.cloudLayerMesh.rotation.y += 0.0021 * simDt;
    }
    if (this.mapMarkersGroup) {
      this.mapMarkersGroup.visible = this.focusMode === 'map' || this.dropPinMode;
    }
    if (this.skyMat) {
      const targetOrbitMix =
        this.focusMode === 'pedestrian'
          ? 0.0
          : this.focusMode === 'broadcast_iss' || this.focusMode === 'iss' || this.focusMode === 'map'
            ? 1.0
            : THREE.MathUtils.smoothstep(this.camera.position.y, 18, 120);
      this.skyMat.uniforms.uOrbitalMix.value = targetOrbitMix;
      const wDim =
        this.focusMode === 'pedestrian'
          ? this.effectiveWeather === 'storm'
            ? 0.72
            : this.effectiveWeather === 'rain'
              ? 0.45
              : this.effectiveWeather === 'snow' || this.effectiveWeather === 'sandstorm'
                ? 0.35
                : 0.0
          : 0.0;
      this.skyMat.uniforms.uWeatherDim.value = wDim;
      this.weatherFlashAlpha = Math.max(0, this.weatherFlashAlpha - dt * 3.8);
      this.skyMat.uniforms.uFlash.value = this.weatherFlashAlpha;
    }

    // Pedestrian walking physics & leg/arm animation relative to camera yaw
    if (this.focusMode === 'pedestrian') {
      let inX = this.pedMoveVec.x;
      let inY = this.pedMoveVec.y;
      if (this.keyState['KeyW'] || this.keyState['ArrowUp']) inY += 1;
      if (this.keyState['KeyS'] || this.keyState['ArrowDown']) inY -= 1;
      if (this.keyState['KeyD'] || this.keyState['ArrowRight']) inX += 1;
      if (this.keyState['KeyA'] || this.keyState['ArrowLeft']) inX -= 1;
      const sprint =
        this.pedSprint || this.keyState['ShiftLeft'] || this.keyState['ShiftRight'];

      const mag = Math.hypot(inX, inY);
      if (mag > 0.05) {
        const nx = inX / Math.max(1, mag);
        const ny = inY / Math.max(1, mag);
        this.camera.getWorldDirection(_v1);
        _v1.y = 0;
        if (_v1.lengthSq() < 1e-6) _v1.set(0, 0, -1);
        _v1.normalize();
        _v2.set(-_v1.z, 0, _v1.x).normalize(); // camera right on XZ

        _dir.copy(_v1).multiplyScalar(ny).addScaledVector(_v2, nx).normalize();
        const speed = sprint ? 0.022 : 0.01;
        this.pedPos.addScaledVector(_dir, speed * dt);

        // Keep comfortably within the 1.2 km walkable local district
        const offX = this.pedPos.x - this.settlementCenter.x;
        const offZ = this.pedPos.z - this.settlementCenter.z;
        const distFromCenter = Math.hypot(offX, offZ);
        const maxWalkR = this.settlementRadiusKm * 0.9;
        if (distFromCenter > maxWalkR) {
          const s = maxWalkR / distFromCenter;
          this.pedPos.x = this.settlementCenter.x + offX * s;
          this.pedPos.z = this.settlementCenter.z + offZ * s;
        }

        this.pedPos.y = this.getPedGroundHeight(this.pedPos.x, this.pedPos.z);
        this.pedYaw = Math.atan2(_dir.x, _dir.z);
        this.pedWalkPhase += dt * (sprint ? 14 : 9.5);
        const swing = Math.sin(this.pedWalkPhase) * 0.62;
        this.pedLeftLeg.rotation.x = swing;
        this.pedRightLeg.rotation.x = -swing;
        this.pedLeftArm.rotation.x = -swing * 0.78;
        this.pedRightArm.rotation.x = swing * 0.78;
      } else {
        this.pedLeftLeg.rotation.x *= 0.82;
        this.pedRightLeg.rotation.x *= 0.82;
        this.pedLeftArm.rotation.x *= 0.82;
        this.pedRightArm.rotation.x *= 0.82;
      }
      this.pedestrianGroup.position.copy(this.pedPos);
      this.pedestrianGroup.rotation.y = this.pedYaw;

      // Animate Reptiloid NPCs, hovering city UFOs & Ziggurat crystal
      for (const h of this.cityHoverObjects) {
        if (h.orbitR > 0) {
          const a = this.windPhase * h.speed + h.phase;
          h.obj.position.set(Math.cos(a) * h.orbitR, h.baseY + Math.sin(a * 2.0) * 0.003, Math.sin(a) * h.orbitR);
          h.obj.rotation.y = -a;
        } else {
          h.obj.rotation.y += dt * h.speed;
          h.obj.position.y = h.baseY + Math.sin(this.windPhase * 2.2) * 0.0025;
        }
      }

      for (const npc of this.reptiloidNpcs) {
        if (!npc.isGuard && npc.patrolRadius > 0) {
          npc.phase += dt * npc.speed;
          const nx = npc.baseX + Math.cos(npc.phase) * npc.patrolRadius;
          const nz = npc.baseZ + Math.sin(npc.phase * 0.85) * npc.patrolRadius;
          const dx = nx - npc.group.position.x;
          const dz = nz - npc.group.position.z;
          npc.group.position.set(nx, this.getPedGroundHeight(this.settlementCenter.x + nx, this.settlementCenter.z + nz), nz);
          if (dx * dx + dz * dz > 1e-10) {
            npc.group.rotation.y = Math.atan2(dx, dz);
          }
          const sw = Math.sin(npc.phase * 8.5) * 0.52;
          npc.legL.rotation.x = sw;
          npc.legR.rotation.x = -sw;
          npc.armL.rotation.x = -sw * 0.7;
          npc.armR.rotation.x = sw * 0.7;
          npc.tail.rotation.y = Math.sin(npc.phase * 6.0) * 0.35;
        } else {
          npc.phase += dt * 1.6;
          npc.tail.rotation.y = Math.sin(npc.phase) * 0.18;
          npc.armR.rotation.x = -0.25 + Math.sin(npc.phase * 0.9) * 0.08;
        }
      }

      if (!this.reptiloidGreeted && this.currentPlace?.landmark === 'reptiloid') {
        const distZ = Math.hypot(this.pedPos.x - this.settlementCenter.x, this.pedPos.z - this.settlementCenter.z);
        if (distZ < 0.032) {
          this.reptiloidGreeted = true;
          this.emitDialogue(
            'Страж Зиккурата (Рептилоид)',
            'Шшш... Добро пожаловать за ледяной барьер Антарктиды! Это наш древний город Нибиру за внешней стеной!',
            'ufo',
          );
        }
      }

      // Step local Pedestrian Weather Particles around walker
      this.weatherGroup.visible = this.effectiveWeather !== 'clear';
      if (this.weatherGroup.visible) {
        this.weatherGroup.position.set(this.pedPos.x, 0, this.pedPos.z);
        if (this.effectiveWeather === 'storm') {
          this.weatherLightningTimer -= dt;
          if (this.weatherLightningTimer <= 0) {
            this.weatherLightningTimer = 3.5 + Math.random() * 5.0;
            this.weatherFlashAlpha = 0.85;
          }
        }
        const n = this.weatherPos.length / 3;
        for (let i = 0; i < n; i++) {
          const spd = this.weatherSeeds[i * 3];
          const ph = this.weatherSeeds[i * 3 + 1];
          const drift = this.weatherSeeds[i * 3 + 2];
          let px = this.weatherPos[i * 3];
          let py = this.weatherPos[i * 3 + 1];
          let pz = this.weatherPos[i * 3 + 2];

          if (this.effectiveWeather === 'rain' || this.effectiveWeather === 'storm') {
            const fallV = (this.effectiveWeather === 'storm' ? 0.055 : 0.038) * spd;
            py -= fallV * dt;
            px += (this.effectiveWeather === 'storm' ? 0.018 : 0.005) * dt;
            if (py < 0) py = 0.052;
          } else if (this.effectiveWeather === 'snow') {
            py -= 0.0075 * spd * dt;
            px += Math.sin(this.windPhase * 1.4 + ph) * 0.0035 * dt;
            pz += Math.cos(this.windPhase * 1.1 + ph) * 0.0035 * dt;
            if (py < 0) py = 0.052;
          } else if (this.effectiveWeather === 'sandstorm') {
            px += 0.045 * spd * dt;
            pz += drift * 0.02 * dt;
            py += Math.sin(this.windPhase * 3.0 + ph) * 0.003 * dt;
            if (px > 0.08) px = -0.08;
          } else if (this.effectiveWeather === 'alien') {
            py += 0.0045 * spd * dt;
            px += Math.sin(this.windPhase + ph) * 0.0025 * dt;
            if (py > 0.048) py = 0.001;
          }
          if (px > 0.08) px -= 0.16;
          if (px < -0.08) px += 0.16;
          if (pz > 0.08) pz -= 0.16;
          if (pz < -0.08) pz += 0.16;

          this.weatherPos[i * 3] = px;
          this.weatherPos[i * 3 + 1] = py;
          this.weatherPos[i * 3 + 2] = pz;
        }
        this.weatherPoints.geometry.attributes.position.needsUpdate = true;
      }
    }

    // Auto-cycle official-style ISS monologues while watching ISS live stream
    if (this.focusMode === 'broadcast_iss') {
      this.issTalkTimer += dt;
      if (this.issTalkTimer > 8.5) {
        this.issTalkTimer = 0;
        const issLines = [
          'Официальная сводка МКС: мы находимся на орбите земного шара на высоте 400 км. Падение постоянное, поэтому чувствуется невесомость.',
          'Часто спрашивают, почему через иллюминаторы Купола не видно звёзд: фотоаппаратура настроена на яркий солнечный свет Земли!',
          'Повторяю для телезрителей: горизонт абсолютно изогнутый, просто в нашем широком объективе он временно кажется плоским!',
          'Мы в открытом космосе! Все показания приборов подтверждают официальную модель — смотрите и не задавайте лишних вопросов.',
        ];
        this.issLineIndex = (this.issLineIndex + 1) % issLines.length;
        this.emitDialogue('Бортинженер МКС (в микрофон)', issLines[this.issLineIndex], 'iss');
      }
    }

    const currentAltKm = Math.max(0, (this.hasFailed ? this.debrisPieces[2].pos.y : this.rocketPos.y) - 0.062);
    this.animateInterior(currentAltKm);

    if (this.isLaunching) {
      this.missionTime += simDt;

      if (!this.hasFailed) {
        const altKm = Math.max(0, this.rocketPos.y - 0.062);

        if (this.plannedFailureAltKm !== null && altKm >= this.plannedFailureAltKm) {
          this.triggerFailure();
        }
      }

      if (!this.hasFailed) {
        if (this.activeVariant === 'antarctica') {
          const maxCruiseAlt = Math.min(32.5, Math.max(22, this.params.zeroGStartKm - 4.5));
          const t = this.missionTime;

          if (this.antarcticOutcome === 'ufo_intercept') {
            // OUTCOME A: Rocket reaches Antarctica -> 3 Flying Saucers intercept & shoot it down with laser beams -> sinks in sea
            const totalRange = ANTARCTIC_SPLASH_RADIUS - LAUNCH_RADIUS_KM;

            if (!this.antarcticSplashed) {
              this.ufoInterceptActive = t >= 54;
              if (this.ufoInterceptActive) {
                this.emitDialogue(
                  'Радар корабля',
                  'ТРЕВОГА! Над ледяным барьером Антарктиды зависли летающие тарелки! Они открыли огонь лазерными лучами!!',
                  'ufo',
                  'ufo_shoot_warn',
                );
              } else if (t >= 34) {
                this.emitDialogue(
                  'Штурман',
                  'Впереди ледяная стена Антарктиды! Держим высоту ниже 40 км — скоро выйдем за барьер и посмотрим, что там!',
                  'rocket',
                  'ant_approach',
                );
              }

              let nextAlt: number;
              if (t < 22) {
                const climbU = t / 22;
                nextAlt = maxCruiseAlt * Math.pow(Math.sin(climbU * (Math.PI / 2)), 1.35);
              } else if (t < 54) {
                nextAlt = maxCruiseAlt + Math.sin((t - 22) * 0.28) * 0.85;
              } else {
                // Shot down by UFO lasers (t = 54..64): spiral drop into Antarctic sea
                const descU = THREE.MathUtils.clamp((t - 54) / 10, 0, 1);
                nextAlt = maxCruiseAlt * (1 - descU * descU);
              }

              const rangeU = THREE.MathUtils.smoothstep(t, 4, 64);
              const nextRange = rangeU * totalRange;

              _v1.copy(LAUNCH_SITE).addScaledVector(SOUTHWARD_DIR, nextRange);
              _v1.y = Math.max(0.015, nextAlt + 0.062);

              if (simDt > 0.0001) {
                this.rocketVel.subVectors(_v1, this.rocketPos).divideScalar(simDt);
              }
              this.rocketPos.copy(_v1);

              if (this.ufoInterceptActive) {
                // Spin under laser impact & spawn fire sparks
                _euler.set(simDt * 2.4, simDt * 1.8, simDt * 2.9);
                _qDelta.setFromEuler(_euler);
                this.rocketQuat.multiply(_qDelta).normalize();
                this.updateUfoLaserBeams(this.rocketPos, true, this.missionTime);

                for (let k = 0; k < 4; k++) {
                  const idx = this.particleCursor;
                  this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
                  this.particlePos[idx * 3] = this.rocketPos.x + (Math.random() - 0.5) * 0.04;
                  this.particlePos[idx * 3 + 1] = this.rocketPos.y + (Math.random() - 0.5) * 0.04;
                  this.particlePos[idx * 3 + 2] = this.rocketPos.z + (Math.random() - 0.5) * 0.04;
                  this.particleVel[idx * 3] = (Math.random() - 0.5) * 0.25;
                  this.particleVel[idx * 3 + 1] = (Math.random() - 0.5) * 0.25;
                  this.particleVel[idx * 3 + 2] = (Math.random() - 0.5) * 0.25;
                  this.particleAge[idx] = 0;
                  this.particleLife[idx] = 0.65;
                  this.particleSize[idx] = 0.055;
                  this.particleTemp[idx] = 0.02;
                }
              } else if (this.rocketVel.lengthSq() > 0.00001) {
                _v2.copy(this.rocketVel).normalize();
                _qDelta.setFromUnitVectors(_v3.set(0, 1, 0), _v2);
                this.rocketQuat.slerp(_qDelta, 1 - Math.exp(-5.0 * simDt));
              }

              this.rocketGroup.position.copy(this.rocketPos);
              this.rocketGroup.quaternion.copy(this.rocketQuat);
              this.rocketGroup.updateMatrixWorld(true);

              const glowMat = this.nozzleGlowMesh.material as THREE.MeshBasicMaterial;
              glowMat.color.setHex(0xfb923c);
              this.nozzleCoreLight.color.setHex(0xfb923c);
              this.nozzleCoreLight.intensity = 1.65;
              this.jellyfishMesh.visible = false;
              this.lightSprayMesh.visible = false;
              this.coreFlareSprite.visible = false;

              const emitCount = Math.round(12 * Math.min(2.2, this.params.timeScale));
              for (let i = 0; i < emitCount; i++) {
                this.spawnExhaustParticle(0, nextAlt);
              }

              this.engineAnchor.getWorldPosition(_nozzleWorld);
              if (
                this.trailPoints.length === 0 ||
                this.trailPoints[this.trailPoints.length - 1].distanceTo(_nozzleWorld) > 1.2
              ) {
                this.trailPoints.push(_nozzleWorld.clone());
                if (this.trailPoints.length > MAX_TRAIL_POINTS) {
                  this.trailPoints.shift();
                }
              }
              const count = this.trailPoints.length;
              for (let i = 0; i < count; i++) {
                const p = this.trailPoints[i];
                this.trailPositions[i * 3] = p.x;
                this.trailPositions[i * 3 + 1] = p.y;
                this.trailPositions[i * 3 + 2] = p.z;
                this.trailColors[i * 3] = 0.96;
                this.trailColors[i * 3 + 1] = 0.72;
                this.trailColors[i * 3 + 2] = 0.42;
              }
              this.trailLineGeom.setDrawRange(0, count);
              this.trailLineGeom.attributes.position.needsUpdate = true;
              this.trailLineGeom.attributes.color.needsUpdate = true;

              if (t >= 64) {
                this.antarcticSplashed = true;
                this.ufoInterceptActive = false;
                this.antarcticSplashTime = 0;
                this.nozzleGlowMesh.visible = false;
                this.nozzleCoreLight.intensity = 0;
                this.rocketVel.set(0, -0.025, 0);
                this.spawnOceanSplash(this.rocketPos);
                for (const u of this.ufoFleet) {
                  u.beam.visible = false;
                  u.impactRing.visible = false;
                }
                this.emitDialogue(
                  'Бортовой самописец',
                  'Ракета сбита лазерными лучами НЛО и затонула в море у ледяного барьера Антарктиды.',
                  'ufo',
                  'ufo_sank_msg',
                );
              }
            } else {
              // UFOs hover away after sinking rocket
              this.antarcticSplashTime += simDt;
              this.antarcticWaterTimer += simDt;
              this.ufoFleet.forEach((u, idx) => {
                u.group.position.y += 0.04 * simDt;
                u.group.rotation.y = this.missionTime * 2.2 + idx;
              });

              const sinkDepth = Math.min(0.16, this.antarcticSplashTime * 0.028);
              this.rocketPos.y = 0.02 - sinkDepth;
              this.rocketVel.set(0, this.antarcticSplashTime < 5.7 ? -0.028 : 0, 0);

              _euler.set(0, LAUNCH_ANGLE, -Math.min(1.05, 0.25 + this.antarcticSplashTime * 0.2));
              _qDelta.setFromEuler(_euler);
              this.rocketQuat.slerp(_qDelta, 1 - Math.exp(-2.5 * simDt));

              this.rocketGroup.position.copy(this.rocketPos);
              this.rocketGroup.quaternion.copy(this.rocketQuat);
              this.rocketGroup.updateMatrixWorld(true);

              if (this.antarcticSplashTime < 5.5 && this.antarcticWaterTimer > 0.14) {
                this.antarcticWaterTimer = 0;
                const idx = this.particleCursor;
                this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
                const ang = Math.random() * Math.PI * 2;
                const sp = 0.03 + Math.random() * 0.08;
                this.particlePos[idx * 3] = this.rocketPos.x + (Math.random() - 0.5) * 0.04;
                this.particlePos[idx * 3 + 1] = 0.02;
                this.particlePos[idx * 3 + 2] = this.rocketPos.z + (Math.random() - 0.5) * 0.04;
                this.particleVel[idx * 3] = Math.cos(ang) * sp;
                this.particleVel[idx * 3 + 1] = 0.06 + Math.random() * 0.08;
                this.particleVel[idx * 3 + 2] = Math.sin(ang) * sp;
                this.particleAge[idx] = 0;
                this.particleLife[idx] = 0.9 + Math.random() * 0.6;
                this.particleSize[idx] = 0.045;
                this.particleTemp[idx] = 2.0;
              }
            }
          } else {
            // OUTCOME B: Rocket breaks out OVER the Antarctic Ice Wall onto Outer Lands ->
            // Parachute Capsule lands -> 2 Astronauts climb out & shout "УРА! УРА!" -> Incinerated by UFO lasers!
            const outerRangeTotal = OUTER_LANDING_RADIUS - LAUNCH_RADIUS_KM;

            if (t < 64) {
              // Phase B1: Ascent & flight past Ice Barrier (r = 20,000-21,200 km) onto Outer Lands
              const rangeU = THREE.MathUtils.smoothstep(t, 4, 64);
              const nextRange = rangeU * outerRangeTotal;
              const curR = LAUNCH_RADIUS_KM + nextRange;
              this.outerBreakoutActive = curR >= 20000;

              let nextAlt: number;
              if (t < 22) {
                nextAlt = maxCruiseAlt * Math.pow(Math.sin((t / 22) * (Math.PI / 2)), 1.35);
              } else {
                nextAlt = maxCruiseAlt + Math.sin((t - 22) * 0.25) * 0.9;
              }

              if (this.outerBreakoutActive) {
                this.emitDialogue(
                  'Командир экипажа',
                  'Мы перелетели ледяной барьер Антарктиды!! Внизу огромные неизвестные континенты — сбрасываем капсулу на парашюте!',
                  'rocket',
                  'breakout_msg',
                );
              } else if (t >= 30) {
                this.emitDialogue(
                  'Штурман',
                  'Летим на форсаже прямо над ледяной стеной Антарктиды — нужно прорваться и увидеть земли за барьером!',
                  'rocket',
                  'ant_breakout_approach',
                );
              }

              _v1.copy(LAUNCH_SITE).addScaledVector(SOUTHWARD_DIR, nextRange);
              _v1.y = Math.max(0.015, nextAlt + 0.062);

              if (simDt > 0.0001) {
                this.rocketVel.subVectors(_v1, this.rocketPos).divideScalar(simDt);
              }
              this.rocketPos.copy(_v1);

              if (this.rocketVel.lengthSq() > 0.00001) {
                _v2.copy(this.rocketVel).normalize();
                _qDelta.setFromUnitVectors(_v3.set(0, 1, 0), _v2);
                this.rocketQuat.slerp(_qDelta, 1 - Math.exp(-5.0 * simDt));
              }

              this.rocketGroup.position.copy(this.rocketPos);
              this.rocketGroup.quaternion.copy(this.rocketQuat);
              this.rocketGroup.updateMatrixWorld(true);

              const glowMat = this.nozzleGlowMesh.material as THREE.MeshBasicMaterial;
              glowMat.color.setHex(0xfb923c);
              this.nozzleCoreLight.color.setHex(0xfb923c);
              this.nozzleCoreLight.intensity = 1.65;
              this.jellyfishMesh.visible = false;
              this.lightSprayMesh.visible = false;
              this.coreFlareSprite.visible = false;

              const emitCount = Math.round(12 * Math.min(2.2, this.params.timeScale));
              for (let i = 0; i < emitCount; i++) {
                this.spawnExhaustParticle(0, nextAlt);
              }

              this.engineAnchor.getWorldPosition(_nozzleWorld);
              if (
                this.trailPoints.length === 0 ||
                this.trailPoints[this.trailPoints.length - 1].distanceTo(_nozzleWorld) > 1.2
              ) {
                this.trailPoints.push(_nozzleWorld.clone());
                if (this.trailPoints.length > MAX_TRAIL_POINTS) {
                  this.trailPoints.shift();
                }
              }
              const count = this.trailPoints.length;
              for (let i = 0; i < count; i++) {
                const p = this.trailPoints[i];
                this.trailPositions[i * 3] = p.x;
                this.trailPositions[i * 3 + 1] = p.y;
                this.trailPositions[i * 3 + 2] = p.z;
                this.trailColors[i * 3] = 0.96;
                this.trailColors[i * 3 + 1] = 0.72;
                this.trailColors[i * 3 + 2] = 0.42;
              }
              this.trailLineGeom.setDrawRange(0, count);
              this.trailLineGeom.attributes.position.needsUpdate = true;
              this.trailLineGeom.attributes.color.needsUpdate = true;
            } else if (t < 74) {
              // Phase B2: Capsule with Parachute descends gently onto Outer Continent (y: 28 km -> 0)
              if (!this.parachuteDescentActive) {
                this.parachuteDescentActive = true;
                this.outerBreakoutActive = false;
                this.rocketGroup.visible = false;
                this.nozzleGlowMesh.visible = false;
                this.nozzleCoreLight.intensity = 0;
                this.capsuleLandingPos.copy(SOUTHWARD_DIR).multiplyScalar(OUTER_LANDING_RADIUS);
                this.capsuleLandingPos.y = 0;
                this.capsuleGroup.visible = true;
                this.parachuteCanopy.visible = true;
                this.hasTrackTarget = false;
                this.emitDialogue(
                  'Командир экипажа',
                  'Парашют раскрыт! Снижаемся в капсуле на внешние земли за Антарктидой!',
                  'rocket',
                  'chute_open',
                );
              }

              const chuteU = THREE.MathUtils.clamp((t - 64) / 10, 0, 1);
              const altKm = THREE.MathUtils.lerp(24, 0, Math.pow(chuteU, 0.72));
              const swayX = Math.sin(t * 2.2) * 0.04 * (1 - chuteU);
              const swayZ = Math.cos(t * 1.9) * 0.04 * (1 - chuteU);
              this.capsuleGroup.position.set(
                this.capsuleLandingPos.x + swayX,
                altKm,
                this.capsuleLandingPos.z + swayZ,
              );
              this.capsuleGroup.rotation.set(Math.sin(t * 2.2) * 0.09, 0, Math.cos(t * 1.9) * 0.09);
              this.rocketPos.copy(this.capsuleGroup.position);
              this.rocketVel.set(0, -2.4, 0);
            } else if (t < 79) {
              // Phase B3: Landed! Parachute collapses, 2 astronauts climb out and shout "Ура! Ура!"
              if (!this.outerLandedActive) {
                this.outerLandedActive = true;
                this.parachuteDescentActive = false;
                this.outerLandingTime = 0;
                this.capsuleGroup.position.copy(this.capsuleLandingPos);
                this.capsuleGroup.rotation.set(0, 0, 0);
                this.parachuteCanopy.visible = false;
                this.rocketPos.copy(this.capsuleLandingPos);
                this.rocketVel.set(0, 0, 0);
                this.evaAstronauts.forEach((astro, idx) => {
                  astro.visible = true;
                  const side = idx === 0 ? -0.032 : 0.032;
                  astro.position.set(
                    this.capsuleLandingPos.x + side,
                    0,
                    this.capsuleLandingPos.z + 0.025,
                  );
                  this.evaSpeechSprites[idx].visible = true;
                  this.evaSpeechSprites[idx].position.set(
                    astro.position.x,
                    0.065 + idx * 0.02,
                    astro.position.z,
                  );
                });
                // Zoom camera closer to admire celebrating astronauts!
                if (this.focusMode === 'rocket' || this.focusMode === 'engine' || this.focusMode === 'plume') {
                  this.camDesiredOffset.set(0.14, 0.08, 0.18);
                  this.camTransitionActive = true;
                }
                this.emitDialogue(
                  'Космонавты на земле',
                  'УРА! УРА!! Мы вышли из капсулы на внешние материки за Антарктидой!! Мы первые!!',
                  'rocket',
                  'ura_landing',
                );
              }
              this.outerLandingTime += simDt;
              // Hopping & waving celebration!
              this.evaAstronauts.forEach((astro, idx) => {
                const hop = Math.abs(Math.sin(this.outerLandingTime * 7 + idx * 1.4)) * 0.008;
                astro.position.y = hop;
                astro.rotation.y = Math.sin(this.outerLandingTime * 4 + idx) * 0.35;
                this.evaSpeechSprites[idx].position.y = 0.065 + hop + idx * 0.022;
              });
            } else {
              // Phase B4: UFOs swoop in and incinerate astronauts with laser beams!
              if (!this.ufoIncinerated) {
                this.ufoIncinerated = true;
                this.outerLandedActive = false;
                this.ufoIncinerateTime = 0;
                this.emitDialogue(
                  'Патруль НЛО',
                  'Объект нарушил периметр Антарктиды! Летающие тарелки открыли лазерный огонь — космонавты испепелены!',
                  'ufo',
                  'ufo_incinerate_msg',
                );
              }
              this.ufoIncinerateTime += simDt;
              const beaming = this.ufoIncinerateTime < 3.2;
              this.updateUfoLaserBeams(this.capsuleLandingPos, beaming, this.missionTime);

              if (this.ufoIncinerateTime > 1.1) {
                this.evaAstronauts.forEach((a) => (a.visible = false));
                this.evaSpeechSprites.forEach((s) => (s.visible = false));
                this.capsuleBodyMat.color.set('#1e293b');
              }

              if (beaming) {
                this.scorchGlowSprite.visible = true;
                this.scorchGlowSprite.position.set(
                  this.capsuleLandingPos.x,
                  0.022,
                  this.capsuleLandingPos.z,
                );
                const pulseS = 0.14 + Math.sin(this.ufoIncinerateTime * 22) * 0.05;
                this.scorchGlowSprite.scale.set(pulseS, pulseS, 1);

                for (let k = 0; k < 5; k++) {
                  const idx = this.particleCursor;
                  this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
                  this.particlePos[idx * 3] = this.capsuleLandingPos.x + (Math.random() - 0.5) * 0.04;
                  this.particlePos[idx * 3 + 1] = 0.015;
                  this.particlePos[idx * 3 + 2] = this.capsuleLandingPos.z + (Math.random() - 0.5) * 0.04;
                  this.particleVel[idx * 3] = (Math.random() - 0.5) * 0.14;
                  this.particleVel[idx * 3 + 1] = 0.06 + Math.random() * 0.14;
                  this.particleVel[idx * 3 + 2] = (Math.random() - 0.5) * 0.14;
                  this.particleAge[idx] = 0;
                  this.particleLife[idx] = 0.9;
                  this.particleSize[idx] = 0.045;
                  this.particleTemp[idx] = 0.05;
                }
              } else {
                this.scorchGlowSprite.visible = false;
              }
            }
          }
        } else {
          // Variant 1: Crosses 38-40 km zero-gravity boundary -> 360° light spray & tumble
          const altKm = Math.max(0, this.rocketPos.y - 0.062);
          const zeroGStart = Math.min(this.params.zeroGStartKm, this.params.zeroGFullKm - 0.2);
          const zeroGFull = Math.max(this.params.zeroGFullKm, zeroGStart + 0.2);
          const zeroGRatio = THREE.MathUtils.smoothstep(altKm, zeroGStart, zeroGFull);

          _rocketUp.set(0, 1, 0).applyQuaternion(this.rocketQuat).normalize();

          if (altKm < zeroGFull) {
            // Calibrated kinematics: reaches 40 km in ~60 seconds at 1x speed
            const netAccel = (0.0114 + 0.00058 * this.missionTime) * (1 - zeroGRatio * 0.45);
            this.rocketVel.addScaledVector(_rocketUp, netAccel * simDt);

            const pitchFrac = THREE.MathUtils.smoothstep(altKm, 2.0, 38.0);
            const targetPitch = pitchFrac * 0.31;
            _v1.set(0, 1, 0).addScaledVector(DOWNRANGE_DIR, Math.tan(targetPitch)).normalize();
            _qDelta.setFromUnitVectors(_v2.set(0, 1, 0), _v1);
            this.rocketQuat.slerp(_qDelta, 1 - Math.exp(-1.5 * simDt));
          } else {
            // Above 40 km: uniform engine spray -> directional thrust lost, rocket tumbles naturally
            const torqueScale = this.params.tumbleIntensity;
            const torqueX = Math.sin(this.missionTime * 1.2 * this.tumbleSeed) * 0.9 * torqueScale;
            const torqueY = Math.cos(this.missionTime * 0.85) * 0.55 * torqueScale;
            const torqueZ = Math.cos(this.missionTime * 1.05 * this.tumbleSeed) * 1.05 * torqueScale;

            this.angularVel.x += torqueX * simDt;
            this.angularVel.y += torqueY * simDt;
            this.angularVel.z += torqueZ * simDt;
            this.angularVel.clampLength(0, 2.6 * torqueScale);

            _euler.set(
              this.angularVel.x * simDt,
              this.angularVel.y * simDt,
              this.angularVel.z * simDt,
            );
            _qDelta.setFromEuler(_euler);
            this.rocketQuat.multiply(_qDelta).normalize();

            const residual = 0.0035 * (1 / Math.max(0.5, this.params.plumeDispersion));
            this.rocketVel.addScaledVector(_rocketUp, residual * simDt);
            this.rocketVel.multiplyScalar(Math.max(0.97, 1 - 0.015 * simDt));
          }

          this.rocketPos.addScaledVector(this.rocketVel, simDt);
          if (this.rocketPos.y > 120) {
            this.rocketVel.y *= 0.92;
          }

          this.rocketGroup.position.copy(this.rocketPos);
          this.rocketGroup.quaternion.copy(this.rocketQuat);
          this.rocketGroup.updateMatrixWorld(true);

          const glowMat = this.nozzleGlowMesh.material as THREE.MeshBasicMaterial;
          glowMat.color.setHex(zeroGRatio > 0.5 ? 0xdbeafe : 0xfb923c);
          this.nozzleCoreLight.color.setHex(zeroGRatio > 0.5 ? 0x93c5fd : 0xfb923c);
          this.nozzleCoreLight.intensity = 1.6 + zeroGRatio * 2.8 * this.params.plumeGlow;

          const emitCount = Math.round((12 + zeroGRatio * 20) * Math.min(2.2, this.params.timeScale));
          for (let i = 0; i < emitCount; i++) {
            this.spawnExhaustParticle(zeroGRatio, altKm);
          }

          this.engineAnchor.getWorldPosition(_nozzleWorld);
          if (
            this.trailPoints.length === 0 ||
            this.trailPoints[this.trailPoints.length - 1].distanceTo(_nozzleWorld) > 0.22
          ) {
            this.trailPoints.push(_nozzleWorld.clone());
            if (this.trailPoints.length > MAX_TRAIL_POINTS) {
              this.trailPoints.shift();
            }
          }

          const count = this.trailPoints.length;
          for (let i = 0; i < count; i++) {
            const p = this.trailPoints[i];
            const pAlt = p.y;
            const shearAmp = pAlt < 39 ? Math.sin(pAlt * 0.45 + this.windPhase * 0.4) * 0.005 * simDt * 60 : 0;
            p.x += shearAmp;
            p.z += Math.cos(pAlt * 0.38 - this.windPhase * 0.3) * 0.004 * simDt * 60;

            this.trailPositions[i * 3] = p.x;
            this.trailPositions[i * 3 + 1] = p.y;
            this.trailPositions[i * 3 + 2] = p.z;

            const t = THREE.MathUtils.clamp(pAlt / 38, 0, 1);
            this.trailColors[i * 3] = THREE.MathUtils.lerp(1.0, 0.72, t);
            this.trailColors[i * 3 + 1] = THREE.MathUtils.lerp(0.55, 0.88, t);
            this.trailColors[i * 3 + 2] = THREE.MathUtils.lerp(0.22, 1.0, t);
          }
          this.trailLineGeom.setDrawRange(0, count);
          this.trailLineGeom.attributes.position.needsUpdate = true;
          this.trailLineGeom.attributes.color.needsUpdate = true;

          // Compact Luminous Cloud & Light-Spray anchored right on the engine nozzle!
          if (zeroGRatio > 0.02) {
            this.jellyfishMesh.visible = true;
            this.lightSprayMesh.visible = true;
            this.coreFlareSprite.visible = true;

            this.jellyfishMesh.position.copy(_nozzleWorld);
            this.lightSprayMesh.position.copy(_nozzleWorld);
            this.coreFlareSprite.position.copy(_nozzleWorld);

            _v1.copy(this.rocketVel);
            if (_v1.lengthSq() < 0.0001) _v1.set(0, 1, 0);
            _v1.normalize();
            _qDelta.setFromUnitVectors(_v2.set(0, 1, 0), _v1);
            this.jellyfishMesh.quaternion.copy(_qDelta);

            const cloudRadiusKm =
              (0.06 + Math.min(1.05, Math.max(0, altKm - zeroGStart) * 0.038)) *
              this.params.plumeDispersion;

            this.jellyfishMesh.scale.set(cloudRadiusKm * 1.1, cloudRadiusKm, cloudRadiusKm * 1.1);
            this.jellyfishMat.uniforms.uTime.value = this.missionTime;
            this.jellyfishMat.uniforms.uIntensity.value = zeroGRatio;

            const sprayRadius = cloudRadiusKm * 0.85;
            this.lightSprayMesh.scale.set(sprayRadius, sprayRadius, sprayRadius);
            this.lightSprayMat.uniforms.uTime.value = this.missionTime;
            this.lightSprayMat.uniforms.uIntensity.value = zeroGRatio;

            const flareSize = (0.09 + cloudRadiusKm * 0.42) * this.params.plumeGlow;
            this.coreFlareSprite.scale.set(flareSize, flareSize, 1);
          } else {
            this.jellyfishMesh.visible = false;
            this.lightSprayMesh.visible = false;
            this.coreFlareSprite.visible = false;
          }
        }
      } else {
        // Broken debris:
        // - Each piece emits small 360° radial glow & particles in different directions
        // - Above 40 km: zero-gravity drift & dispersion
        // - Below 40 km: Earth gravity (9.81 m/s^2) + atmospheric drag pull pieces down slowly into the ocean
        const gravity = 0.00981; // Real 9.81 m/s^2 = 0.00981 km/s^2
        const zeroGStart = Math.min(this.params.zeroGStartKm, this.params.zeroGFullKm - 0.2);
        const zeroGFull = Math.max(this.params.zeroGFullKm, zeroGStart + 0.2);

        for (let di = 0; di < this.debrisPieces.length; di++) {
          const p = this.debrisPieces[di];
          if (p.splashed) continue;
          p.glowAge += simDt;

          const pieceAltKm = Math.max(0, p.pos.y);
          const pieceZeroG = THREE.MathUtils.smoothstep(pieceAltKm, zeroGStart, zeroGFull);
          const gravityFactor = 1.0 - pieceZeroG;

          if (gravityFactor > 0.005) {
            // Below 40 km: falls under its own weight & atmospheric drag
            p.vel.y -= gravity * gravityFactor * simDt;
            const airDensity = Math.exp(-pieceAltKm / 12.0);
            const atmoDrag = Math.max(
              0.88,
              1 - (0.035 + 0.14 * airDensity) * gravityFactor * simDt,
            );
            p.vel.multiplyScalar(atmoDrag);
          } else {
            // Inside >= 40 km zero-gravity field: very gentle radial drift without strong fall
            p.vel.multiplyScalar(Math.max(0.96, 1 - 0.012 * simDt));
          }

          p.pos.addScaledVector(p.vel, simDt);

          _euler.set(p.angVel.x * simDt, p.angVel.y * simDt, p.angVel.z * simDt);
          _qDelta.setFromEuler(_euler);
          p.quat.multiply(_qDelta).normalize();

          p.mesh.position.copy(p.pos);
          p.mesh.quaternion.copy(p.quat);

          // Small 360° omnidirectional glow on each fragment (steady in zero-g, fades after entering < 40 km)
          const breakupResidual = Math.exp(-p.glowAge * 0.45) * 0.78;
          const glowStrength = Math.max(pieceZeroG * 0.92, breakupResidual);

          if (glowStrength > 0.04) {
            p.sprayMesh.visible = true;
            p.flareSprite.visible = true;
            p.sprayMesh.position.copy(p.pos);
            p.flareSprite.position.copy(p.pos);

            const glowRadius = (0.065 + 0.135 * glowStrength) * this.params.plumeDispersion;
            p.sprayMesh.scale.set(glowRadius, glowRadius, glowRadius);
            p.sprayMat.uniforms.uTime.value = this.missionTime;
            p.sprayMat.uniforms.uIntensity.value = glowStrength;
            const fSize = glowRadius * 1.45 * this.params.plumeGlow;
            p.flareSprite.scale.set(fSize, fSize, 1);

            // Small omnidirectional glowing gas particles spraying in different directions
            const emitP = pieceZeroG > 0.25 ? 2 : 1;
            for (let k = 0; k < emitP; k++) {
              const idx = this.particleCursor;
              this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
              const u = Math.random() * 2 - 1;
              const th = Math.random() * Math.PI * 2;
              const sq = Math.sqrt(1 - u * u);
              const sp = (0.06 + Math.random() * 0.12) * this.params.plumeDispersion;
              this.particlePos[idx * 3] = p.pos.x;
              this.particlePos[idx * 3 + 1] = p.pos.y;
              this.particlePos[idx * 3 + 2] = p.pos.z;
              this.particleVel[idx * 3] = p.vel.x * 0.45 + sq * Math.cos(th) * sp;
              this.particleVel[idx * 3 + 1] = p.vel.y * 0.45 + u * sp;
              this.particleVel[idx * 3 + 2] = p.vel.z * 0.45 + sq * Math.sin(th) * sp;
              this.particleAge[idx] = 0;
              this.particleLife[idx] = 0.8 + Math.random() * 0.6;
              this.particleSize[idx] = 0.02 + Math.random() * 0.028;
              this.particleTemp[idx] = pieceZeroG > 0.2 ? 0.85 : 0.25;
            }
          } else {
            p.sprayMesh.visible = false;
            p.flareSprite.visible = false;
          }

          // Atmospheric smoke trail when falling below 40 km
          p.smokeTimer += simDt;
          if (gravityFactor > 0.15 && p.smokeTimer > 0.065) {
            p.smokeTimer = 0;
            const idx = this.particleCursor;
            this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
            this.particlePos[idx * 3] = p.pos.x;
            this.particlePos[idx * 3 + 1] = p.pos.y;
            this.particlePos[idx * 3 + 2] = p.pos.z;
            this.particleVel[idx * 3] = (Math.random() - 0.5) * 0.02;
            this.particleVel[idx * 3 + 1] = 0.015 + Math.random() * 0.02;
            this.particleVel[idx * 3 + 2] = (Math.random() - 0.5) * 0.02;
            this.particleAge[idx] = 0;
            this.particleLife[idx] = 2.4;
            this.particleSize[idx] = 0.045;
            this.particleTemp[idx] = 2.0;
          }

          if (p.pos.y <= 0.01) {
            p.pos.y = -0.02;
            p.splashed = true;
            p.mesh.visible = false;
            p.sprayMesh.visible = false;
            p.flareSprite.visible = false;
            this.splashedCount += 1;
            this.spawnOceanSplash(p.pos);
          }
        }
      }
    }

    for (const r of this.splashRings) {
      if (!r.active) continue;
      r.age += simDt;
      const t = r.age / 2.6;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
      } else {
        const s = 1 + t * 12;
        r.mesh.scale.set(s, s, s);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
      }
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.particleAge[i] < this.particleLife[i]) {
        this.particleAge[i] += simDt;
        const isMist = this.particleTemp[i] > 0.4 && this.particleTemp[i] < 1.5;
        const drag = isMist ? 0.992 : 0.97;
        this.particleVel[i * 3] *= drag;
        this.particleVel[i * 3 + 1] *= drag;
        this.particleVel[i * 3 + 2] *= drag;
        if (this.particleTemp[i] > 1.5) {
          this.particleVel[i * 3 + 1] -= 0.02 * simDt;
        }

        this.particlePos[i * 3] += this.particleVel[i * 3] * simDt;
        this.particlePos[i * 3 + 1] += this.particleVel[i * 3 + 1] * simDt;
        this.particlePos[i * 3 + 2] += this.particleVel[i * 3 + 2] * simDt;
      }
    }
    this.particleGeom.attributes.position.needsUpdate = true;
    this.particleGeom.attributes.aAge.needsUpdate = true;
    this.particleGeom.attributes.aLife.needsUpdate = true;
    this.particleGeom.attributes.aSize.needsUpdate = true;
    this.particleGeom.attributes.aTemp.needsUpdate = true;
  }

  private stepCamera(dt: number) {
    if (this.focusMode === 'broadcast_rocket') {
      this.interiorControls.update();

      const targetPos = this.hasFailed ? this.debrisPieces[2].pos : this.rocketPos;
      this.camera.position.copy(targetPos);
      // Small height guard so launchpad porthole view sees above pad concrete
      if (this.camera.position.y < 0.07) {
        this.camera.position.y = 0.07;
      }

      if (this.activeVariant === 'antarctica') {
        const lookY =
          this.ufoInterceptActive || this.ufoIncinerated || this.outerLandedActive
            ? 0.34
            : this.isLaunching
              ? -0.18
              : 0.25;
        // Point forward along southward course toward Antarctic Ice Wall / Outer Lands / UFO fleet
        _v1.copy(SOUTHWARD_DIR).multiplyScalar(0.92).add(new THREE.Vector3(0, lookY, 0)).normalize();
        _v2.set(0, 1, 0);
      } else {
        // Variant 1 / zero-G / launchpad view rotates with rocketQuat so tumble spins sky & Earth
        _v1.set(0.32, 0.22, -0.92).normalize().applyQuaternion(this.rocketQuat);
        _v2.set(0, 1, 0).applyQuaternion(this.rocketQuat);
      }
      _m4.lookAt(_origin, _v1, _v2);
      _baseQuat.setFromRotationMatrix(_m4);
      // Combine base exterior view orientation with user's interior side-orbit camera rotation!
      this.camera.quaternion.copy(_baseQuat).multiply(this.interiorCamera.quaternion);
    } else if (this.focusMode === 'broadcast_iss') {
      this.interiorControls.update();
      this.camera.position.copy(this.issGroup.position);

      // Look through the Cupola straight out/down at the spinning 28,000 km Flat Earth below (y = 400 -> 0)
      _v1.set(-this.issGroup.position.x * 0.48, -400, -this.issGroup.position.z * 0.48).normalize();
      // Align Cupola "up" radially inward toward North Pole at Earth center
      _v2.set(-this.issGroup.position.x, 0, -this.issGroup.position.z).normalize();
      _m4.lookAt(_origin, _v1, _v2);
      _baseQuat.setFromRotationMatrix(_m4);
      this.camera.quaternion.copy(_baseQuat).multiply(this.interiorCamera.quaternion);
    } else {
      const isTracking =
        this.focusMode === 'rocket' ||
        this.focusMode === 'engine' ||
        this.focusMode === 'plume' ||
        this.focusMode === 'iss' ||
        this.focusMode === 'pedestrian';

      if (isTracking) {
        this.getTrackedTarget(_v3);

        // ALWAYS apply target frame-to-frame delta EVEN WHILE pinch-zooming / orbiting!
        if (this.hasTrackTarget) {
          _v1.subVectors(_v3, this.prevTrackTarget);
          this.camera.position.add(_v1);
          this.controls.target.add(_v1);
        }
        this.prevTrackTarget.copy(_v3);
        this.hasTrackTarget = true;

        if (this.camTransitionActive) {
          const k = 1 - Math.exp(-6.0 * dt);
          _v2.copy(_v3).add(this.camDesiredOffset);
          this.camera.position.lerp(_v2, k);
          this.controls.target.lerp(_v3, k);
          const snapTol = this.focusMode === 'pedestrian' ? 0.0008 : 0.02;
          if (this.camera.position.distanceTo(_v2) < snapTol) {
            this.camTransitionActive = false;
          }
        }
      } else if (this.camTransitionActive) {
        const k = 1 - Math.exp(-5.5 * dt);
        _v2.copy(this.camStaticTarget).add(this.camDesiredOffset);
        this.camera.position.lerp(_v2, k);
        this.controls.target.lerp(this.camStaticTarget, k);
        if (this.camera.position.distanceTo(_v2) < 1.0) {
          this.camTransitionActive = false;
        }
      }

      this.controls.update();

      // Hide distant ISS beacon/label cleanly when zoomed up close to inspect station hardware
      const issDist = this.camera.position.distanceTo(this.issGroup.position);
      const showFarIssHint = issDist > 25;
      this.issBeaconSprite.visible = showFarIssHint;
      this.issLabelSprite.visible = showFarIssHint;
    }

    // Keep flicker-free sky dome & stars centered on camera
    this.skyMesh.position.copy(this.camera.position);
    this.starsPoints.position.copy(this.camera.position);
  }

  private emitTelemetry(force = false) {
    const now = performance.now();
    if (!force && now - this.lastTelemetryEmit < 80) return;
    this.lastTelemetryEmit = now;

    const activePos = this.hasFailed ? this.debrisPieces[2].pos : this.rocketPos;
    const activeVel = this.hasFailed ? this.debrisPieces[2].vel : this.rocketVel;
    const altKm = Math.max(0, activePos.y - 0.062);
    const downrangeKm = Math.hypot(
      activePos.x - LAUNCH_SITE.x,
      activePos.z - LAUNCH_SITE.z,
    );

    const zeroGStart = Math.min(this.params.zeroGStartKm, this.params.zeroGFullKm - 0.2);
    const zeroGFull = Math.max(this.params.zeroGFullKm, zeroGStart + 0.2);

    let phase: FlightPhase = 'idle';
    if (this.isLaunching) {
      if (this.hasFailed) {
        phase = this.splashedCount >= this.debrisPieces.length ? 'ocean_splash' : 'failure_falling';
      } else if (this.activeVariant === 'antarctica') {
        if (this.ufoIncinerated) {
          phase = 'ufo_incinerated';
        } else if (this.outerLandedActive) {
          phase = 'outer_landing';
        } else if (this.parachuteDescentActive) {
          phase = 'parachute_descent';
        } else if (this.outerBreakoutActive) {
          phase = 'outer_breakout';
        } else if (this.antarcticSplashed) {
          phase = 'antarctic_splash';
        } else if (this.ufoInterceptActive) {
          phase = 'ufo_intercept';
        } else if (this.missionTime < 22) {
          phase = 'ascent';
        } else {
          phase = 'antarctic_cruise';
        }
      } else if (altKm < zeroGStart) {
        phase = 'ascent';
      } else if (altKm < zeroGFull) {
        phase = 'transition';
      } else {
        phase = 'zero_g_loss';
      }
    }

    _rocketUp.set(0, 1, 0).applyQuaternion(this.rocketQuat).normalize();
    const pitchRad = Math.acos(THREE.MathUtils.clamp(_rocketUp.y, -1, 1));
    const pressurePct = Math.max(0, 100 * Math.exp(-altKm / 8.5));
    const spreadRatio =
      this.activeVariant === 'antarctica'
        ? 0
        : THREE.MathUtils.smoothstep(altKm, zeroGStart, zeroGFull);
    const nozzleSpreadDeg =
      this.hasFailed || this.antarcticSplashed || this.ufoIncinerated
        ? 0
        : Math.round(THREE.MathUtils.lerp(12, 360, spreadRatio));

    this.onTelemetry({
      altitudeKm: altKm,
      downrangeKm,
      velocityKmS: activeVel.length(),
      pitchDeg: THREE.MathUtils.radToDeg(pitchRad),
      angularRateDegS: THREE.MathUtils.radToDeg(this.angularVel.length()),
      phase,
      activeVariant: this.activeVariant,
      antarcticOutcome: this.antarcticOutcome,
      ambientPressurePct: pressurePct,
      nozzleSpreadDeg,
      missionTimeSec: this.missionTime,
      isLaunching: this.isLaunching,
      hasFailed: this.hasFailed,
      splashedCount: this.splashedCount,
      issAltitudeKm: ISS_ALTITUDE_KM,
      focusMode: this.focusMode,
      pedestrianPlaceName: this.pedMeta.name,
      pedestrianRegion: this.pedMeta.region,
      pedestrianCoords: this.pedMeta.coords,
      dropPinMode: this.dropPinMode,
      weatherMode: this.weatherMode,
      activeWeatherLabel: this.getWeatherLabel(),
      mapSelection: this.mapSelection,
    });
  }

  private startLoop() {
    const tick = () => {
      if (this.disposed) return;
      const dt = Math.min(0.05, this.clock.getDelta() || 0.016);
      this.stepSimulation(dt);
      this.stepCamera(dt);
      this.emitTelemetry(false);

      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      if (this.focusMode === 'broadcast_rocket' || this.focusMode === 'broadcast_iss') {
        this.renderer.clearDepth();
        this.renderer.render(this.interiorScene, this.interiorCamera);
      }

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };
    this.frameId = requestAnimationFrame(tick);
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private handleResize = () => {
    if (!this.container || this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.interiorCamera.aspect = w / h;
    this.interiorCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.particleMat.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
  };

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.renderer.domElement.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handleCanvasPointerUp);
    this.clearLocalSettlement();
    this.controls.dispose();
    this.interiorControls.dispose();
    this.mapTextures.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
