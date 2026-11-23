import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  createAzimuthalMapTextures,
  createCoastalSpaceportTexture,
  createMoonTexture,
  ICE_INNER_NORM,
  ICE_OUTER_NORM,
  projectLatLonToWorld,
  type AzimuthalMapTextures,
} from './azimuthalMapTexture';
import type {
  CameraFocusMode,
  FlightPhase,
  SimulationParams,
  TelemetryState,
} from '../types/simulation';

// Real-world 1:1 km scale (1 world unit = 1 km)
const DISC_RADIUS = 28000; // 28,000 km total disc radius (20,000 km to Antarctic Ice Ring)
const LAUNCH_SITE = projectLatLonToWorld(28.5, -80.5, DISC_RADIUS);
const LAUNCH_ANGLE = Math.atan2(LAUNCH_SITE.z, LAUNCH_SITE.x);
// Eastward downrange direction from launch coast into the Atlantic Ocean
const DOWNRANGE_DIR = new THREE.Vector3(0.28, 0, -0.96).normalize();

const SUN_ALTITUDE_KM = 6000;
const SUN_ORBIT_RADIUS = 9600;
const MOON_ALTITUDE_KM = 5000;
const MOON_ORBIT_RADIUS = 10600;

const ROCKET_HEIGHT_KM = 0.115; // 115 meters
const ROCKET_HALF_H = ROCKET_HEIGHT_KM * 0.5;
const MAX_PARTICLES = 3200;
const MAX_TRAIL_POINTS = 320;
const MAX_SPLASH_RINGS = 8;

// Pre-allocated scratch math objects (zero GC in animation loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _nozzleWorld = new THREE.Vector3();
const _rocketUp = new THREE.Vector3();
const _qDelta = new THREE.Quaternion();
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
  private starsPoints!: THREE.Points;

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

  // Smooth camera offset transition (relative to moving target so pinch-zoom never loses rocket!)
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
  ) {
    this.container = container;
    this.params = { ...initialParams };
    this.onTelemetry = onTelemetry;
    this.isSoftwareGl = detectSoftwareWebGL();

    // 1. Renderer with logarithmicDepthBuffer for true 115 m rocket vs 28,000 km Earth proportions
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
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

    this.resetSimulation();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    window.addEventListener('resize', this.handleResize);
    this.startLoop();
  }

  private buildSkyAndStars() {
    // Camera-centered background sky dome with depthTest: false eliminates ALL black background flicker!
    const skyGeom = new THREE.SphereGeometry(500, 32, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.25, 1.0);
          vec3 zenith = vec3(0.015, 0.022, 0.052);
          vec3 midSky = vec3(0.038, 0.058, 0.115);
          vec3 horizon = vec3(0.14, 0.105, 0.125);
          vec3 col = mix(horizon, midSky, smoothstep(-0.04, 0.18, h));
          col = mix(col, zenith, smoothstep(0.15, 0.65, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyMesh = new THREE.Mesh(skyGeom, skyMat);
    this.skyMesh.renderOrder = -100;
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);
    this.disposables.push(skyGeom, skyMat);

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
  private applyHalfEarthDayNightShader(mat: THREE.MeshStandardMaterial) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunXZ = this.sunXZUniform;
      shader.vertexShader =
        `varying vec2 vEarthWorldXZ;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `
          #include <worldpos_vertex>
          vEarthWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
          `,
        );
      shader.fragmentShader =
        `uniform vec2 uSunXZ;\nvarying vec2 vEarthWorldXZ;\n` +
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

          vec3 nightTint = gl_FragColor.rgb * 0.22;
          vec3 dayTint = gl_FragColor.rgb * 1.18;
          vec3 twilightWarm = vec3(0.32, 0.18, 0.10) * twilight;

          gl_FragColor.rgb = mix(nightTint, dayTint, dayFactor) + twilightWarm;
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
      roughness: 0.84,
      metalness: 0.06,
    });
    this.applyHalfEarthDayNightShader(topMat);
    const topMesh = new THREE.Mesh(topGeom, topMat);
    topMesh.receiveShadow = true;
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

  private getTrackedTarget(out: THREE.Vector3) {
    if (this.hasFailed) {
      out.copy(this.debrisPieces[2].pos);
    } else if (this.focusMode === 'engine') {
      this.engineAnchor.getWorldPosition(out);
    } else {
      out.copy(this.rocketPos);
    }
  }

  public setFocusMode(mode: CameraFocusMode) {
    this.focusMode = mode;
    if (mode === 'map') {
      this.camStaticTarget.set(0, 0, 0);
      this.camDesiredOffset.set(0, 26000, 32000);
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
    this.hasTrackTarget = false;
  }

  public zoomStep(factor: number) {
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
    this.splashedCount = 0;
    this.nozzleGlowMesh.visible = true;

    if (this.params.launchMode === 'forced_failure') {
      this.plannedFailureAltKm = 16 + Math.random() * 28;
    } else if (
      this.params.launchMode === 'occasional_failure' &&
      this.launchCount > 1 &&
      Math.random() < 0.35
    ) {
      this.plannedFailureAltKm = 16 + Math.random() * 28;
    } else {
      this.plannedFailureAltKm = null;
    }

    if (this.focusMode === 'map' || this.focusMode === 'free') {
      this.setFocusMode('rocket');
    }
    this.emitTelemetry(true);
  }

  public triggerFailure() {
    if (!this.isLaunching || this.hasFailed) return;
    this.hasFailed = true;
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
    this.plannedFailureAltKm = null;
    this.splashedCount = 0;
    this.missionTime = 0;

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

    this.rocketGroup.visible = true;
    this.rocketGroup.position.copy(this.rocketPos);
    this.rocketGroup.quaternion.copy(this.rocketQuat);
    this.nozzleGlowMesh.visible = false;
    this.nozzleCoreLight.intensity = 0;
    this.jellyfishMesh.visible = false;
    this.jellyfishMat.uniforms.uIntensity.value = 0;
    this.lightSprayMesh.visible = false;
    this.lightSprayMat.uniforms.uIntensity.value = 0;
    this.coreFlareSprite.visible = false;

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

  private stepSimulation(dt: number) {
    const simDt = dt * this.params.timeScale;
    this.windPhase += simDt;
    this.updateCelestialBodies(simDt);

    if (this.isLaunching) {
      this.missionTime += simDt;

      if (!this.hasFailed) {
        const altKm = Math.max(0, this.rocketPos.y - 0.062);

        if (this.plannedFailureAltKm !== null && altKm >= this.plannedFailureAltKm) {
          this.triggerFailure();
        }
      }

      if (!this.hasFailed) {
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
        // Starts tiny (~60 m) at 40 km entry and grows gradually up to ~1.1 km max right around the rocket.
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
    const isTrackingRocket =
      this.focusMode === 'rocket' || this.focusMode === 'engine' || this.focusMode === 'plume';

    if (isTrackingRocket) {
      this.getTrackedTarget(_v3);

      // ALWAYS apply rocket frame-to-frame delta EVEN WHILE pinch-zooming / orbiting!
      // This keeps the rocket/nozzle locked in center view during two-finger touch zoom.
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
        if (this.camera.position.distanceTo(_v2) < 0.02) {
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
    const spreadRatio = THREE.MathUtils.smoothstep(altKm, zeroGStart, zeroGFull);
    const nozzleSpreadDeg = this.hasFailed
      ? 0
      : Math.round(THREE.MathUtils.lerp(12, 360, spreadRatio));

    this.onTelemetry({
      altitudeKm: altKm,
      downrangeKm,
      velocityKmS: activeVel.length(),
      pitchDeg: THREE.MathUtils.radToDeg(pitchRad),
      angularRateDegS: THREE.MathUtils.radToDeg(this.angularVel.length()),
      phase,
      ambientPressurePct: pressurePct,
      nozzleSpreadDeg,
      missionTimeSec: this.missionTime,
      isLaunching: this.isLaunching,
      hasFailed: this.hasFailed,
      splashedCount: this.splashedCount,
    });
  }

  private startLoop() {
    const tick = () => {
      if (this.disposed) return;
      const dt = Math.min(0.05, this.clock.getDelta() || 0.016);
      this.stepSimulation(dt);
      this.stepCamera(dt);
      this.emitTelemetry(false);
      this.renderer.render(this.scene, this.camera);

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
    this.controls.dispose();
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
