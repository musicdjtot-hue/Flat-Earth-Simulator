import * as THREE from 'three';

type LatLon = [number, number];

export const ICE_INNER_NORM = 20000 / 28000; // ~0.7143 (20,000 km from North Pole)
export const ICE_OUTER_NORM = 21200 / 28000; // ~0.7571

export function projectLatLonToWorld(
  lat: number,
  lon: number,
  discRadius: number,
): THREE.Vector3 {
  const r = ((90 - lat) / 180) * (ICE_INNER_NORM * discRadius);
  const rad = ((lon - 90) * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(rad) * r, 0, Math.sin(rad) * r);
}

// Recognizable continental outlines in [lat, lon] degrees
const CONTINENTS: { name: string; color: string; poly: LatLon[] }[] = [
  {
    name: 'NorthAmerica',
    color: '#466650',
    poly: [
      [71, -156], [70, -130], [72, -95], [68, -82], [62, -75], [53, -56],
      [45, -66], [41, -70], [35, -75], [29, -80.5], [25, -80], [26, -82],
      [29, -85], [29, -95], [21, -97], [21, -87], [15, -83], [9, -79],
      [8, -83], [15, -93], [19, -104], [24, -107], [32, -117], [38, -123],
      [48, -124], [58, -137], [60, -150], [55, -162], [62, -166], [66, -168],
    ],
  },
  {
    name: 'Greenland',
    color: '#cbd5e1',
    poly: [
      [83, -35], [81, -18], [74, -20], [68, -32], [60, -44], [65, -53],
      [73, -56], [79, -68], [82, -55],
    ],
  },
  {
    name: 'SouthAmerica',
    color: '#4a6e4d',
    poly: [
      [11, -74], [10, -62], [5, -52], [0, -49], [-5, -35], [-13, -38],
      [-23, -42], [-34, -53], [-42, -64], [-53, -68], [-55, -70], [-46, -75],
      [-33, -72], [-18, -71], [-5, -81], [2, -79], [8, -77],
    ],
  },
  {
    name: 'Europe',
    color: '#526e53',
    poly: [
      [71, 26], [69, 34], [65, 40], [58, 28], [54, 20], [54, 10], [58, 6],
      [62, 5], [70, 18], [60, 5], [51, 2], [48, -5], [43, -9], [37, -9],
      [36, -5], [40, 0], [43, 5], [44, 12], [40, 18], [38, 23], [41, 29],
      [45, 30], [47, 39], [52, 40], [60, 40],
    ],
  },
  {
    name: 'Britain',
    color: '#547356',
    poly: [[58, -5], [57, -2], [51, 1], [50, -5], [54, -4]],
  },
  {
    name: 'Africa',
    color: '#736f4a',
    poly: [
      [36, -5], [37, 10], [32, 15], [31, 32], [22, 37], [12, 44], [11, 51],
      [2, 45], [-10, 40], [-25, 35], [-34, 25], [-34, 18], [-22, 14],
      [-12, 13], [-1, 9], [5, 2], [5, -8], [14, -17], [22, -17], [30, -10],
    ],
  },
  {
    name: 'Madagascar',
    color: '#5f6946',
    poly: [[-12, 49], [-18, 50], [-25, 47], [-24, 44], [-15, 46]],
  },
  {
    name: 'Asia',
    color: '#516c51',
    poly: [
      [68, 40], [72, 70], [76, 105], [73, 135], [70, 175], [64, 178],
      [59, 162], [52, 156], [53, 140], [43, 135], [38, 128], [35, 126],
      [39, 121], [31, 122], [23, 117], [20, 106], [11, 109], [8, 105],
      [13, 100], [2, 103], [6, 99], [16, 96], [22, 91], [16, 81], [8, 77],
      [20, 72], [25, 62], [26, 56], [22, 59], [13, 45], [22, 39], [30, 34],
      [37, 36], [41, 29], [43, 40], [47, 39], [56, 48], [64, 45],
    ],
  },
  {
    name: 'Japan',
    color: '#577357',
    poly: [[45, 142], [42, 145], [35, 140], [32, 131], [36, 136], [41, 140]],
  },
  {
    name: 'Borneo',
    color: '#456949',
    poly: [[6, 117], [1, 118], [-3, 115], [-2, 109], [3, 111]],
  },
  {
    name: 'NewGuinea',
    color: '#456949',
    poly: [[-1, 132], [-5, 141], [-9, 148], [-8, 138], [-4, 134]],
  },
  {
    name: 'Australia',
    color: '#826846',
    poly: [
      [-12, 131], [-12, 136], [-15, 136], [-11, 142], [-19, 147],
      [-28, 153], [-37, 150], [-38, 144], [-35, 136], [-32, 126],
      [-34, 115], [-23, 114], [-16, 123],
    ],
  },
  {
    name: 'NewZealand',
    color: '#547054',
    poly: [[-35, 173], [-38, 178], [-46, 168], [-42, 171]],
  },
];

// Large, clearly visible Outer Ring continents beyond the Antarctic Ice Wall (r normalized 0.77 - 0.97)
const OUTER_LANDS: { poly: [number, number][]; tone: string }[] = [
  {
    tone: '#546e5f',
    poly: [
      [5, 0.78], [22, 0.775], [42, 0.79], [60, 0.84], [55, 0.94],
      [34, 0.96], [12, 0.94], [-2, 0.87],
    ],
  },
  {
    tone: '#5c6f59',
    poly: [
      [74, 0.78], [98, 0.775], [126, 0.795], [142, 0.86], [134, 0.95],
      [108, 0.965], [84, 0.93], [70, 0.85],
    ],
  },
  {
    tone: '#6b6752',
    poly: [
      [152, 0.79], [176, 0.775], [204, 0.80], [220, 0.87], [212, 0.955],
      [182, 0.96], [158, 0.92], [148, 0.85],
    ],
  },
  {
    tone: '#4d6a64',
    poly: [
      [230, 0.78], [258, 0.785], [286, 0.81], [296, 0.89], [282, 0.96],
      [252, 0.955], [228, 0.90], [224, 0.83],
    ],
  },
  {
    tone: '#596b61',
    poly: [
      [304, 0.795], [328, 0.78], [352, 0.81], [358, 0.90], [340, 0.955],
      [314, 0.94], [300, 0.87],
    ],
  },
];

function seededNoise(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

export type SurfaceSampleType = 'ocean' | 'land' | 'desert' | 'ice' | 'outer';

export interface AzimuthalMapTextures {
  colorMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  nightLightsMap: THREE.CanvasTexture;
  sampleSurfaceAtWorld: (x: number, z: number, discRadius: number) => SurfaceSampleType;
  updateOuterLandsVisibility: (visibility: number) => void;
  dispose: () => void;
}

const CITY_CLUSTERS: [number, number, number][] = [
  // North America East / Florida / Midwest / California
  [28.5, -80.5, 16], [25.8, -80.2, 18], [33.7, -84.4, 15], [40.7, -74.0, 24],
  [42.3, -71.0, 18], [38.9, -77.0, 16], [41.8, -87.6, 20], [29.7, -95.3, 18],
  [32.7, -96.8, 16], [34.0, -118.2, 22], [37.7, -122.4, 16], [19.4, -99.1, 20],
  // South America
  [-23.5, -46.6, 22], [-22.9, -43.2, 18], [-34.6, -58.4, 20], [-12.0, -77.0, 14], [4.7, -74.0, 15],
  // Europe & Mediterranean
  [51.5, -0.1, 22], [48.8, 2.3, 22], [52.5, 13.4, 20], [45.4, 9.2, 18], [40.4, -3.7, 18],
  [41.9, 12.5, 16], [55.7, 37.6, 24], [59.9, 30.3, 18], [50.4, 30.5, 16], [41.0, 29.0, 20],
  // Africa & Middle East
  [30.0, 31.2, 24], [25.2, 55.3, 18], [24.7, 46.7, 16], [33.5, -7.6, 15], [6.5, 3.4, 18], [-26.2, 28.0, 18],
  // Asia & Australia
  [28.6, 77.2, 24], [19.0, 72.8, 22], [13.0, 80.2, 18], [31.2, 121.5, 24], [39.9, 116.4, 24],
  [22.3, 114.2, 22], [35.6, 139.7, 26], [37.5, 127.0, 22], [13.7, 100.5, 18], [1.3, 103.8, 18],
  [-6.2, 106.8, 20], [-33.8, 151.2, 18], [-37.8, 144.9, 16],
];

export function createAzimuthalMapTextures(
  maxAnisotropy: number,
  initialOuterVisibility = 0.85,
): AzimuthalMapTextures {
  const size = 2048;
  const half = size / 2;
  const iceInnerR = half * ICE_INNER_NORM;
  const iceOuterR = half * ICE_OUTER_NORM;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d', { willReadFrequently: true })!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  const nightCanvas = document.createElement('canvas');
  nightCanvas.width = 1024;
  nightCanvas.height = 1024;
  const nCtx = nightCanvas.getContext('2d')!;

  const projectLatLon = (lat: number, lon: number, scaleHalf = half, scaleIce = iceInnerR): [number, number] => {
    const r = ((90 - lat) / 180) * scaleIce;
    const rad = ((lon - 90) * Math.PI) / 180;
    return [scaleHalf + Math.cos(rad) * r, scaleHalf + Math.sin(rad) * r];
  };

  const projectPolar = (angleDeg: number, normR: number): [number, number] => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    const r = normR * half;
    return [half + Math.cos(rad) * r, half + Math.sin(rad) * r];
  };

  const drawNightLights = (outerVisibility: number) => {
    const nHalf = 512;
    const nIce = nHalf * ICE_INNER_NORM;
    nCtx.fillStyle = '#000000';
    nCtx.fillRect(0, 0, 1024, 1024);

    for (const [lat, lon, spread] of CITY_CLUSTERS) {
      const [cx, cy] = projectLatLon(lat, lon, nHalf, nIce);
      const glow = nCtx.createRadialGradient(cx, cy, 0, cx, cy, spread);
      glow.addColorStop(0, 'rgba(255, 224, 148, 0.92)');
      glow.addColorStop(0.35, 'rgba(251, 191, 36, 0.42)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      nCtx.fillStyle = glow;
      nCtx.beginPath();
      nCtx.arc(cx, cy, spread, 0, Math.PI * 2);
      nCtx.fill();

      for (let k = 0; k < 14; k++) {
        const ang = seededNoise(lat + k, lon) * Math.PI * 2;
        const rad = seededNoise(k * 3.1, lat) * spread * 0.72;
        const px = cx + Math.cos(ang) * rad;
        const py = cy + Math.sin(ang) * rad;
        nCtx.fillStyle = 'rgba(255, 243, 196, 0.95)';
        nCtx.fillRect(px, py, 1.4, 1.4);
      }
    }

    // Warm beacons along outer lands + emerald beacon at Reptiloid City
    nCtx.save();
    nCtx.globalAlpha = outerVisibility * 0.55;
    for (let i = 0; i < 42; i++) {
      const ang = (seededNoise(i, 5.2) * 360 - 90) * (Math.PI / 180);
      const nr = (0.79 + seededNoise(i, 7.9) * 0.15) * nHalf;
      const ox = nHalf + Math.cos(ang) * nr;
      const oy = nHalf + Math.sin(ang) * nr;
      const g = nCtx.createRadialGradient(ox, oy, 0, ox, oy, 10);
      g.addColorStop(0, 'rgba(186, 230, 253, 0.7)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      nCtx.fillStyle = g;
      nCtx.beginPath();
      nCtx.arc(ox, oy, 10, 0, Math.PI * 2);
      nCtx.fill();
    }
    // Reptiloid City night glow at [148 deg, 0.85]
    const repRad = ((148 - 90) * Math.PI) / 180;
    const rx = nHalf + Math.cos(repRad) * 0.85 * nHalf;
    const ry = nHalf + Math.sin(repRad) * 0.85 * nHalf;
    const rg = nCtx.createRadialGradient(rx, ry, 0, rx, ry, 22);
    rg.addColorStop(0, 'rgba(52, 211, 153, 0.95)');
    rg.addColorStop(0.45, 'rgba(16, 185, 129, 0.45)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    nCtx.fillStyle = rg;
    nCtx.beginPath();
    nCtx.arc(rx, ry, 22, 0, Math.PI * 2);
    nCtx.fill();
    nCtx.restore();
  };

  const drawTexture = (outerVisibility: number) => {
    ctx.fillStyle = '#061224';
    ctx.fillRect(0, 0, size, size);

    bCtx.fillStyle = '#141414';
    bCtx.fillRect(0, 0, size, size);

    // Outer ocean beyond Antarctica (deep oceanic sapphire)
    const outerSeaGrad = ctx.createRadialGradient(half, half, iceOuterR * 0.96, half, half, half);
    outerSeaGrad.addColorStop(0, '#0f3460');
    outerSeaGrad.addColorStop(0.55, '#0b2649');
    outerSeaGrad.addColorStop(1, '#07172d');
    ctx.beginPath();
    ctx.arc(half, half, half * 0.995, 0, Math.PI * 2);
    ctx.fillStyle = outerSeaGrad;
    ctx.fill();

    // Clearly visible outer continents beyond Antarctica with turquoise shallow-shelf halos
    ctx.save();
    ctx.globalAlpha = Math.max(0.25, Math.min(1, outerVisibility));
    for (const land of OUTER_LANDS) {
      ctx.beginPath();
      bCtx.beginPath();
      land.poly.forEach(([deg, nr], idx) => {
        const [x, y] = projectPolar(deg, nr);
        if (idx === 0) {
          ctx.moveTo(x, y);
          bCtx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
          bCtx.lineTo(x, y);
        }
      });
      ctx.closePath();
      bCtx.closePath();

      ctx.save();
      ctx.shadowColor = 'rgba(20, 184, 166, 0.52)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = land.tone;
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = 'rgba(134, 239, 172, 0.42)';
      ctx.lineWidth = 2.4;
      ctx.stroke();

      bCtx.fillStyle = '#6c6c6c';
      bCtx.fill();
    }

    // Outer archipelago islands
    for (let i = 0; i < 95; i++) {
      const ang = seededNoise(i, 1.3) * 360;
      const nr = 0.77 + seededNoise(i, 4.7) * 0.2;
      const [ix, iy] = projectPolar(ang, nr);
      const rad = 5 + seededNoise(i, 9.1) * 16;
      ctx.beginPath();
      ctx.arc(ix, iy, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(84, 126, 114, 0.8)';
      ctx.fill();
    }
    ctx.restore();

    // Soft outermost perimeter mist
    const mistGrad = ctx.createRadialGradient(half, half, half * 0.9, half, half, half);
    const edgeVeil = Math.max(0.1, 0.5 - outerVisibility * 0.32);
    mistGrad.addColorStop(0, 'rgba(6, 16, 32, 0.0)');
    mistGrad.addColorStop(0.68, `rgba(6, 16, 32, ${edgeVeil})`);
    mistGrad.addColorStop(1, 'rgba(4, 9, 18, 0.94)');
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.fillStyle = mistGrad;
    ctx.fill();

    // Inner Known Earth Ocean (deep ISS cobalt-sapphire bathymetry + sunlit currents)
    const innerSeaGrad = ctx.createRadialGradient(half, half, 0, half, half, iceInnerR);
    innerSeaGrad.addColorStop(0, '#0f3b6b');
    innerSeaGrad.addColorStop(0.32, '#092b56');
    innerSeaGrad.addColorStop(0.72, '#061f42');
    innerSeaGrad.addColorStop(1, '#0e3762');
    ctx.beginPath();
    ctx.arc(half, half, iceInnerR, 0, Math.PI * 2);
    ctx.fillStyle = innerSeaGrad;
    ctx.fill();

    // Multi-scale oceanic trenches, currents & sunglint patches visible from 400 km ISS
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, iceInnerR, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 120; i++) {
      const ang = seededNoise(i, 3.7) * Math.PI * 2;
      const rad = (0.08 + seededNoise(i, 8.2) * 0.88) * iceInnerR;
      const cx = half + Math.cos(ang) * rad;
      const cy = half + Math.sin(ang) * rad;
      const sz = 24 + seededNoise(i, 12.1) * 95;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sz);
      g.addColorStop(
        0,
        i % 3 === 0
          ? 'rgba(14, 116, 144, 0.18)'
          : i % 3 === 1
            ? 'rgba(56, 189, 248, 0.08)'
            : 'rgba(3, 18, 40, 0.24)',
      );
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    bCtx.beginPath();
    bCtx.arc(half, half, iceInnerR, 0, Math.PI * 2);
    bCtx.fillStyle = '#1d1d1d';
    bCtx.fill();

    // Subtle navigation graticule
    for (const lat of [66.5, 45, 23.5, 0, -23.5, -45, -66.5]) {
      const r = ((90 - lat) / 180) * iceInnerR;
      ctx.beginPath();
      ctx.strokeStyle = lat === 0 ? 'rgba(56, 189, 248, 0.14)' : 'rgba(148, 163, 184, 0.055)';
      ctx.lineWidth = lat === 0 ? 1.4 : 0.9;
      ctx.arc(half, half, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const rad = (lon * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(half, half);
      ctx.lineTo(half + Math.cos(rad) * half * 0.97, half + Math.sin(rad) * half * 0.97);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    // Continents with turquoise shallow coastal shelves + rich orbital biome coloration
    const continentBiomes: Record<string, { main: string; inner: string; ridge: string }> = {
      NorthAmerica: { main: '#33613e', inner: '#687648', ridge: '#9a8e72' },
      Greenland: { main: '#d8e6f3', inner: '#eef4fa', ridge: '#ffffff' },
      SouthAmerica: { main: '#245e35', inner: '#4f7341', ridge: '#8c7e65' },
      Europe: { main: '#3d6641', inner: '#5e7949', ridge: '#a3a89e' },
      Britain: { main: '#436e47', inner: '#5d855b', ridge: '#7a8a73' },
      Africa: { main: '#967c4b', inner: '#336136', ridge: '#b89b6a' },
      Madagascar: { main: '#4d7041', inner: '#6e7348', ridge: '#8a8268' },
      Asia: { main: '#3f633e', inner: '#87754b', ridge: '#cfd8e3' },
      Japan: { main: '#436e44', inner: '#627f5c', ridge: '#94a3b8' },
      Borneo: { main: '#225e35', inner: '#357343', ridge: '#5a7a52' },
      NewGuinea: { main: '#235e37', inner: '#3b7349', ridge: '#6c8568' },
      Australia: { main: '#a2673a', inner: '#856039', ridge: '#b88454' },
      NewZealand: { main: '#406e48', inner: '#638466', ridge: '#cbd5e1' },
    };

    for (const cont of CONTINENTS) {
      ctx.beginPath();
      bCtx.beginPath();
      cont.poly.forEach(([lat, lon], idx) => {
        const [x, y] = projectLatLon(lat, lon);
        if (idx === 0) {
          ctx.moveTo(x, y);
          bCtx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
          bCtx.lineTo(x, y);
        }
      });
      ctx.closePath();
      bCtx.closePath();

      // Shallow turquoise coastal shelf halo (ISS signature look!)
      ctx.save();
      ctx.shadowColor = 'rgba(20, 184, 212, 0.62)';
      ctx.shadowBlur = 16;
      const biome = continentBiomes[cont.name] ?? { main: cont.color, inner: cont.color, ridge: '#94a3b8' };
      ctx.fillStyle = biome.main;
      ctx.fill();
      ctx.restore();

      // Rich interior biome, cloud-dappled terrain & mountain ridge relief inside each landmass
      ctx.save();
      ctx.clip();
      for (let p = 0; p < 38; p++) {
        const idx = p % cont.poly.length;
        const [lat, lon] = cont.poly[idx];
        const [px, py] = projectLatLon(
          lat + (seededNoise(p, idx) - 0.5) * 15,
          lon + (seededNoise(idx, p) - 0.5) * 20,
        );
        const rad = 14 + seededNoise(p, 4.2) * 52;
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, p % 5 === 0 ? biome.ridge : biome.inner);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = p % 5 === 0 ? 0.34 : 0.48;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(167, 243, 208, 0.38)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      bCtx.fillStyle = cont.name === 'Greenland' ? '#9e9e9e' : '#767676';
      bCtx.fill();
    }

    // Highlight Sahara desert sun-baked sand & Himalayan snow ridge
    const [sahX, sahY] = projectLatLon(22, 12);
    const sahGrad = ctx.createRadialGradient(sahX, sahY, 0, sahX, sahY, 110);
    sahGrad.addColorStop(0, 'rgba(204, 162, 102, 0.78)');
    sahGrad.addColorStop(0.6, 'rgba(176, 134, 82, 0.46)');
    sahGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sahGrad;
    ctx.beginPath();
    ctx.arc(sahX, sahY, 110, 0, Math.PI * 2);
    ctx.fill();

    const [himX, himY] = projectLatLon(32, 86);
    const himGrad = ctx.createRadialGradient(himX, himY, 0, himX, himY, 62);
    himGrad.addColorStop(0, 'rgba(241, 245, 249, 0.82)');
    himGrad.addColorStop(0.55, 'rgba(148, 163, 184, 0.38)');
    himGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = himGrad;
    ctx.beginPath();
    ctx.arc(himX, himY, 62, 0, Math.PI * 2);
    ctx.fill();
    bCtx.fillStyle = '#c8c8c8';
    bCtx.beginPath();
    bCtx.arc(himX, himY, 26, 0, Math.PI * 2);
    bCtx.fill();

    // Arctic polar cap
    const poleGrad = ctx.createRadialGradient(half, half, 0, half, half, iceInnerR * 0.11);
    poleGrad.addColorStop(0, 'rgba(241, 245, 249, 0.95)');
    poleGrad.addColorStop(0.65, 'rgba(186, 224, 248, 0.62)');
    poleGrad.addColorStop(1, 'rgba(186, 214, 236, 0)');
    ctx.beginPath();
    ctx.arc(half, half, iceInnerR * 0.11, 0, Math.PI * 2);
    ctx.fillStyle = poleGrad;
    ctx.fill();

    // Antarctic Ice Wall Ring
    ctx.beginPath();
    bCtx.beginPath();
    const steps = 240;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const jitter = (seededNoise(i * 0.7, 3.1) - 0.5) * 16;
      const r = iceOuterR + jitter;
      const x = half + Math.cos(a) * r;
      const y = half + Math.sin(a) * r;
      if (i === 0) {
        ctx.moveTo(x, y);
        bCtx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
        bCtx.lineTo(x, y);
      }
    }
    for (let i = steps; i >= 0; i--) {
      const a = (i / steps) * Math.PI * 2;
      const jitter = (seededNoise(i * 0.9, 8.4) - 0.5) * 14;
      const r = iceInnerR + jitter;
      ctx.lineTo(half + Math.cos(a) * r, half + Math.sin(a) * r);
      bCtx.lineTo(half + Math.cos(a) * r, half + Math.sin(a) * r);
    }
    ctx.closePath();
    bCtx.closePath();

    const iceGrad = ctx.createRadialGradient(half, half, iceInnerR * 0.96, half, half, iceOuterR * 1.04);
    iceGrad.addColorStop(0, '#d8ecfc');
    iceGrad.addColorStop(0.45, '#f1f7fe');
    iceGrad.addColorStop(0.85, '#c2d8ec');
    iceGrad.addColorStop(1, '#7c98b6');
    ctx.fillStyle = iceGrad;
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 2;
    ctx.stroke();

    bCtx.fillStyle = '#d4d4d4';
    bCtx.fill();

    // Cartographic Labels
    ctx.save();
    ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
    ctx.font = '600 18px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('СЕВЕРНЫЙ ПОЛЮС', half, half - 18);

    ctx.fillStyle = 'rgba(224, 242, 254, 0.9)';
    ctx.font = '600 20px "IBM Plex Mono", monospace';
    ctx.fillText('АНТАРКТИЧЕСКИЙ БАРЬЕР', half, half + (iceInnerR + iceOuterR) * 0.5 + 7);

    ctx.fillStyle = `rgba(203, 224, 216, ${0.45 + outerVisibility * 0.5})`;
    ctx.font = '600 20px "IBM Plex Mono", monospace';
    ctx.fillText('ВНЕШНИЕ ЗЕМЛИ ЗА АНТАРКТИДОЙ', half, half + half * 0.87);
    ctx.fillText('ВНЕШНИЕ МАТЕРИКИ', half, half - half * 0.86);
    ctx.restore();
  };

  drawTexture(initialOuterVisibility);
  drawNightLights(initialOuterVisibility);

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = maxAnisotropy;
  colorMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.anisotropy = maxAnisotropy;
  bumpMap.needsUpdate = true;

  const nightLightsMap = new THREE.CanvasTexture(nightCanvas);
  nightLightsMap.colorSpace = THREE.SRGBColorSpace;
  nightLightsMap.anisotropy = maxAnisotropy;
  nightLightsMap.needsUpdate = true;

  return {
    colorMap,
    bumpMap,
    nightLightsMap,
    sampleSurfaceAtWorld(x: number, z: number, discRadius: number): SurfaceSampleType {
      const dist = Math.hypot(x, z);
      const normR = dist / discRadius;
      if (normR >= ICE_INNER_NORM * 0.995 && normR <= ICE_OUTER_NORM * 1.01) {
        return 'ice';
      }
      const px = Math.max(0, Math.min(size - 1, Math.round(half + (x / discRadius) * half)));
      const py = Math.max(0, Math.min(size - 1, Math.round(half + (z / discRadius) * half)));
      const data = ctx.getImageData(px, py, 1, 1).data;
      const r = data[0];
      const g = data[1];
      const b = data[2];

      if (normR > ICE_OUTER_NORM) {
        // Distinguish outer continents vs outer ocean
        if (g >= 86 && r >= 60 && b <= 140) return 'outer';
        return b > g + 8 ? 'ocean' : 'outer';
      }

      if (r > 195 && g > 205 && b > 215) return 'ice';
      if (b > r * 1.14 && b > g * 1.03 && r < 68) return 'ocean';
      if (r > 125 && g > 92 && b < 112) return 'desert';
      if (g >= r * 0.85 && g > b) return 'land';
      return b > g ? 'ocean' : 'land';
    },
    updateOuterLandsVisibility(visibility: number) {
      drawTexture(visibility);
      drawNightLights(visibility);
      colorMap.needsUpdate = true;
      bumpMap.needsUpdate = true;
      nightLightsMap.needsUpdate = true;
    },
    dispose() {
      colorMap.dispose();
      bumpMap.dispose();
      nightLightsMap.dispose();
    },
  };
}

export function createAtmosphericCloudsTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 2048;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(half, half, half * 0.985, 0, Math.PI * 2);
  ctx.clip();

  // 1. Broad wispy atmospheric fronts & fibrous jet-stream cirrus sheets
  for (let i = 0; i < 460; i++) {
    const ang = seededNoise(i, 1.7) * Math.PI * 2;
    const normR = 0.04 + Math.pow(seededNoise(i, 3.9), 0.78) * 0.92;
    const cx = half + Math.cos(ang) * normR * half;
    const cy = half + Math.sin(ang) * normR * half;

    const stretch = 2.0 + seededNoise(i, 5.1) * 3.2;
    const rx = 24 + seededNoise(i, 6.3) * 76;
    const ry = rx / stretch;
    const rot = ang + Math.PI / 2 + (seededNoise(i, 8.8) - 0.5) * 0.65;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    const alpha = 0.1 + seededNoise(i, 9.7) * 0.28;
    g.addColorStop(0, `rgba(246, 250, 255, ${alpha.toFixed(3)})`);
    g.addColorStop(0.55, `rgba(220, 234, 248, ${(alpha * 0.42).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Helper to paint realistic ISS-photo Spiral Hurricane / Cyclone Eyes with 3D eyewall shadow!
  const drawCycloneSystem = (cx: number, cy: number, maxRad: number, seed: number, spinDir: number) => {
    // Soft outer veil
    const veil = ctx.createRadialGradient(cx, cy, maxRad * 0.08, cx, cy, maxRad * 1.15);
    veil.addColorStop(0, 'rgba(232, 242, 252, 0.08)');
    veil.addColorStop(0.28, 'rgba(238, 246, 255, 0.54)');
    veil.addColorStop(0.68, 'rgba(218, 232, 248, 0.28)');
    veil.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = veil;
    ctx.beginPath();
    ctx.arc(cx, cy, maxRad * 1.15, 0, Math.PI * 2);
    ctx.fill();

    // Sweeping spiral convective rainbands & cumulus flocculi
    for (let arm = 0; arm < 5; arm++) {
      const armBase = (arm / 5) * Math.PI * 2 + seed;
      for (let s = 4; s < 56; s++) {
        const u = s / 56;
        const a = armBase + spinDir * (u * Math.PI * 2.5);
        const sr = maxRad * (0.1 + u * 0.92);
        const px = cx + Math.cos(a) * sr;
        const py = cy + Math.sin(a) * sr;
        const puffR = (maxRad * 0.095) * (0.55 + (1 - u) * 0.65) * (0.7 + seededNoise(s + arm * 19, seed) * 0.6);

        // Subtle dark cloud-shadow edge under dense convective bands
        if (s < 32 && s % 2 === 0) {
          ctx.fillStyle = `rgba(38, 56, 84, ${(0.16 * (1 - u)).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(px + 2.5, py + 2.5, puffR * 0.92, 0, Math.PI * 2);
          ctx.fill();
        }

        const pg = ctx.createRadialGradient(px, py, 0, px, py, puffR);
        const op = (0.42 - u * 0.24) * (0.75 + seededNoise(arm, s) * 0.35);
        pg.addColorStop(0, `rgba(255, 255, 255, ${op.toFixed(3)})`);
        pg.addColorStop(0.6, `rgba(226, 238, 250, ${(op * 0.45).toFixed(3)})`);
        pg.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, puffR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Raised bright Eyewall ring + interior recessed shadow just like the ISS photo!
    const eyeR = maxRad * 0.105;
    const shadowGrad = ctx.createRadialGradient(cx + eyeR * 0.22, cy + eyeR * 0.22, eyeR * 0.15, cx, cy, eyeR * 1.45);
    shadowGrad.addColorStop(0, 'rgba(18, 34, 62, 0.48)');
    shadowGrad.addColorStop(0.65, 'rgba(55, 78, 112, 0.22)');
    shadowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, eyeR * 1.45, 0, Math.PI * 2);
    ctx.fill();

    // Bright textured eyewall collar
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const ex = cx + Math.cos(a) * eyeR * 1.15;
      const ey = cy + Math.sin(a) * eyeR * 1.15;
      const er = eyeR * 0.65;
      const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, er);
      eg.addColorStop(0, 'rgba(255, 255, 255, 0.78)');
      eg.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
    }

    // Clear dark center of the Eye so ocean shows through!
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, eyeR * 0.92);
    hole.addColorStop(0, 'rgba(0,0,0,0.92)');
    hole.addColorStop(0.65, 'rgba(0,0,0,0.55)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(cx, cy, eyeR * 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Three major orbital cyclone/typhoon systems along the ISS orbital belt (r ~ 0.29..0.46)
  drawCycloneSystem(half + half * 0.34, half - half * 0.14, 175, 0.8, 1);
  drawCycloneSystem(half - half * 0.31, half + half * 0.24, 152, 2.3, -1);
  drawCycloneSystem(half - half * 0.12, half - half * 0.36, 134, 4.1, 1);

  // Additional smaller swirling cyclones
  for (let c = 0; c < 8; c++) {
    const cAng = seededNoise(c, 15.3) * Math.PI * 2;
    const cRad = (0.18 + seededNoise(c, 17.9) * 0.64) * half;
    drawCycloneSystem(
      half + Math.cos(cAng) * cRad,
      half + Math.sin(cAng) * cRad,
      64 + seededNoise(c, 22.1) * 38,
      c * 1.4,
      c % 2 === 0 ? 1 : -1,
    );
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createLowerCumulusTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(half, half, half * 0.985, 0, Math.PI * 2);
  ctx.clip();

  // Scattered low-altitude cumulus clusters & marine stratocumulus patches
  for (let i = 0; i < 650; i++) {
    const ang = seededNoise(i, 41.2) * Math.PI * 2;
    const normR = 0.05 + Math.pow(seededNoise(i, 53.7), 0.72) * 0.91;
    const cx = half + Math.cos(ang) * normR * half;
    const cy = half + Math.sin(ang) * normR * half;
    const rad = 5 + seededNoise(i, 61.9) * 20;

    // Tiny shadow offset beneath cumulus puff
    ctx.fillStyle = 'rgba(24, 38, 62, 0.14)';
    ctx.beginPath();
    ctx.arc(cx + 1.5, cy + 1.5, rad * 0.85, 0, Math.PI * 2);
    ctx.fill();

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const a = 0.24 + seededNoise(i, 71.1) * 0.32;
    g.addColorStop(0, `rgba(248, 252, 255, ${a.toFixed(3)})`);
    g.addColorStop(0.65, `rgba(224, 236, 248, ${(a * 0.4).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createCoastalSpaceportTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);

  const landGrad = ctx.createRadialGradient(half * 0.72, half, 10, half, half, half);
  landGrad.addColorStop(0, 'rgba(63, 90, 71, 0.96)');
  landGrad.addColorStop(0.75, 'rgba(54, 78, 62, 0.7)');
  landGrad.addColorStop(1, 'rgba(54, 78, 62, 0.0)');

  ctx.save();
  ctx.beginPath();
  ctx.arc(half, half, half * 0.96, 0, Math.PI * 2);
  ctx.clip();

  const seaGrad = ctx.createRadialGradient(half, half, 20, half, half, half);
  seaGrad.addColorStop(0, '#102b49');
  seaGrad.addColorStop(0.7, '#0d2642');
  seaGrad.addColorStop(1, 'rgba(13, 38, 66, 0)');
  ctx.fillStyle = seaGrad;
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(half + 18, 0);
  ctx.bezierCurveTo(half + 42, half * 0.4, half + 54, half * 0.75, half + 46, half);
  ctx.bezierCurveTo(half + 38, half * 1.3, half + 12, half * 1.65, half - 25, size);
  ctx.lineTo(0, size);
  ctx.closePath();
  ctx.fillStyle = landGrad;
  ctx.fill();

  ctx.strokeStyle = 'rgba(194, 178, 146, 0.55)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(half + 18, 0);
  ctx.bezierCurveTo(half + 42, half * 0.4, half + 54, half * 0.75, half + 46, half);
  ctx.bezierCurveTo(half + 38, half * 1.3, half + 12, half * 1.65, half - 25, size);
  ctx.stroke();

  ctx.fillStyle = '#334155';
  ctx.fillRect(half - 28, half - 22, 56, 44);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2;
  ctx.strokeRect(half - 28, half - 22, 56, 44);

  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(half - 28, half);
  ctx.lineTo(half - 240, half + 80);
  ctx.stroke();

  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(half, half, half * 0.42, half, half, half * 0.96);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createMoonTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#cfd8e3';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 90; i++) {
    const x = seededNoise(i, 2.1) * size;
    const y = seededNoise(i, 6.7) * size;
    const r = 4 + seededNoise(i, 11.3) * 28;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = i % 3 === 0 ? 'rgba(130, 142, 160, 0.32)' : 'rgba(241, 245, 249, 0.25)';
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}
