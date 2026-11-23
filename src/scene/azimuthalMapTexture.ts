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

export interface AzimuthalMapTextures {
  colorMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  updateOuterLandsVisibility: (visibility: number) => void;
  dispose: () => void;
}

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
  const ctx = colorCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  const projectLatLon = (lat: number, lon: number): [number, number] => {
    const r = ((90 - lat) / 180) * iceInnerR;
    const rad = ((lon - 90) * Math.PI) / 180;
    return [half + Math.cos(rad) * r, half + Math.sin(rad) * r];
  };

  const projectPolar = (angleDeg: number, normR: number): [number, number] => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    const r = normR * half;
    return [half + Math.cos(rad) * r, half + Math.sin(rad) * r];
  };

  const drawTexture = (outerVisibility: number) => {
    ctx.fillStyle = '#070c16';
    ctx.fillRect(0, 0, size, size);

    bCtx.fillStyle = '#141414';
    bCtx.fillRect(0, 0, size, size);

    // Outer ocean beyond Antarctica
    const outerSeaGrad = ctx.createRadialGradient(
      half,
      half,
      iceOuterR * 0.96,
      half,
      half,
      half,
    );
    outerSeaGrad.addColorStop(0, '#122945');
    outerSeaGrad.addColorStop(0.6, '#0d1f36');
    outerSeaGrad.addColorStop(1, '#081222');
    ctx.beginPath();
    ctx.arc(half, half, half * 0.995, 0, Math.PI * 2);
    ctx.fillStyle = outerSeaGrad;
    ctx.fill();

    // Clearly visible outer continents beyond Antarctica
    ctx.save();
    ctx.globalAlpha = Math.max(0.2, Math.min(1, outerVisibility));
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

      ctx.fillStyle = land.tone;
      ctx.fill();
      ctx.strokeStyle = 'rgba(167, 204, 192, 0.55)';
      ctx.lineWidth = 2.6;
      ctx.stroke();

      bCtx.fillStyle = '#686868';
      bCtx.fill();
    }

    // Outer archipelago islands
    for (let i = 0; i < 85; i++) {
      const ang = seededNoise(i, 1.3) * 360;
      const nr = 0.77 + seededNoise(i, 4.7) * 0.2;
      const [ix, iy] = projectPolar(ang, nr);
      const rad = 5 + seededNoise(i, 9.1) * 16;
      ctx.beginPath();
      ctx.arc(ix, iy, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(92, 118, 110, 0.75)';
      ctx.fill();
    }
    ctx.restore();

    // Gentle atmospheric horizon fade only at very outermost edge (r > 0.94)
    const mistGrad = ctx.createRadialGradient(
      half,
      half,
      half * 0.88,
      half,
      half,
      half,
    );
    const edgeVeil = Math.max(0.1, 0.55 - outerVisibility * 0.35);
    mistGrad.addColorStop(0, 'rgba(7, 13, 24, 0.0)');
    mistGrad.addColorStop(0.65, `rgba(7, 13, 24, ${edgeVeil})`);
    mistGrad.addColorStop(1, 'rgba(5, 9, 18, 0.92)');
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.fillStyle = mistGrad;
    ctx.fill();

    // Inner Known Earth Ocean
    const innerSeaGrad = ctx.createRadialGradient(half, half, 0, half, half, iceInnerR);
    innerSeaGrad.addColorStop(0, '#163859');
    innerSeaGrad.addColorStop(0.45, '#0f2b49');
    innerSeaGrad.addColorStop(0.85, '#0c233d');
    innerSeaGrad.addColorStop(1, '#143554');
    ctx.beginPath();
    ctx.arc(half, half, iceInnerR, 0, Math.PI * 2);
    ctx.fillStyle = innerSeaGrad;
    ctx.fill();

    bCtx.beginPath();
    bCtx.arc(half, half, iceInnerR, 0, Math.PI * 2);
    bCtx.fillStyle = '#202020';
    bCtx.fill();

    // Latitude circles & meridians
    for (const lat of [66.5, 45, 23.5, 0, -23.5, -45, -66.5]) {
      const r = ((90 - lat) / 180) * iceInnerR;
      ctx.beginPath();
      if (lat === 0) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.24)';
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = 1;
      }
      ctx.arc(half, half, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let lon = 0; lon < 360; lon += 30) {
      const rad = (lon * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(half, half);
      ctx.lineTo(half + Math.cos(rad) * half * 0.97, half + Math.sin(rad) * half * 0.97);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Continents
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

      ctx.fillStyle = cont.color;
      ctx.fill();
      ctx.strokeStyle = '#92b396';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      bCtx.fillStyle = cont.name === 'Greenland' ? '#8c8c8c' : '#6e6e6e';
      bCtx.fill();
    }

    // Arctic polar cap
    const poleGrad = ctx.createRadialGradient(half, half, 0, half, half, iceInnerR * 0.1);
    poleGrad.addColorStop(0, 'rgba(226, 238, 248, 0.9)');
    poleGrad.addColorStop(0.65, 'rgba(186, 214, 236, 0.55)');
    poleGrad.addColorStop(1, 'rgba(186, 214, 236, 0)');
    ctx.beginPath();
    ctx.arc(half, half, iceInnerR * 0.1, 0, Math.PI * 2);
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
    iceGrad.addColorStop(0, '#c7def2');
    iceGrad.addColorStop(0.45, '#e8f2fc');
    iceGrad.addColorStop(0.85, '#b8cde2');
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
    ctx.fillStyle = 'rgba(203, 213, 225, 0.78)';
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

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = maxAnisotropy;
  colorMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.anisotropy = maxAnisotropy;
  bumpMap.needsUpdate = true;

  return {
    colorMap,
    bumpMap,
    updateOuterLandsVisibility(visibility: number) {
      drawTexture(visibility);
      colorMap.needsUpdate = true;
      bumpMap.needsUpdate = true;
    },
    dispose() {
      colorMap.dispose();
      bumpMap.dispose();
    },
  };
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
