import * as THREE from 'three';
import { ICE_INNER_NORM, projectLatLonToWorld } from './azimuthalMapTexture';

export type SettlementType = 'capital' | 'city' | 'town' | 'village' | 'outer';
export type PlaceBiome =
  | 'urban'
  | 'temperate'
  | 'subtropical'
  | 'savanna'
  | 'desert'
  | 'outback'
  | 'taiga'
  | 'coastal'
  | 'ice';

export interface WorldPlace {
  id: string;
  name: string;
  region: string;
  continentLabel: string;
  lat: number;
  lon: number;
  /** Optional polar [angleDeg, normR] override for Outer Lands beyond Antarctica */
  polar?: [number, number];
  type: SettlementType;
  biome: PlaceBiome;
  landmark?: 'kremlin' | 'capitol' | 'pyramids' | 'opera' | 'tower' | 'outpost' | 'reptiloid';
  palette: {
    ground: string;
    foliage: string;
    road: string;
    wall: string;
    roof: string;
    accent: string;
  };
}

export const WORLD_PLACES: WorldPlace[] = [
  // Европа и Россия (Москва + Московская область)
  {
    id: 'moscow',
    name: 'Москва',
    region: 'Россия · Столица',
    continentLabel: 'Евразия',
    lat: 55.75,
    lon: 37.62,
    type: 'capital',
    biome: 'urban',
    landmark: 'kremlin',
    palette: {
      ground: '#3d5a40',
      foliage: '#2f6a39',
      road: '#334155',
      wall: '#cbd5e1',
      roof: '#991b1b',
      accent: '#eab308',
    },
  },
  {
    id: 'stupino',
    name: 'г. Ступино',
    region: 'Московская обл.',
    continentLabel: 'Евразия',
    lat: 54.89,
    lon: 38.08,
    type: 'town',
    biome: 'temperate',
    palette: {
      ground: '#4a6b46',
      foliage: '#38703b',
      road: '#475569',
      wall: '#e2e8f0',
      roof: '#9a3412',
      accent: '#38bdf8',
    },
  },
  {
    id: 'khatun_village',
    name: 'с. Хатунь / д. Лужники',
    region: 'Ступинский р-н, МО',
    continentLabel: 'Евразия',
    lat: 54.96,
    lon: 37.89,
    type: 'village',
    biome: 'temperate',
    palette: {
      ground: '#527347',
      foliage: '#3b7a3e',
      road: '#786246',
      wall: '#b08354',
      roof: '#6b3e26',
      accent: '#22c55e',
    },
  },
  {
    id: 'spb',
    name: 'Санкт-Петербург',
    region: 'Россия · СЗФО',
    continentLabel: 'Евразия',
    lat: 59.93,
    lon: 30.33,
    type: 'city',
    biome: 'coastal',
    palette: {
      ground: '#425e49',
      foliage: '#2e633b',
      road: '#334155',
      wall: '#fde68a',
      roof: '#15803d',
      accent: '#f59e0b',
    },
  },
  {
    id: 'paris',
    name: 'Париж',
    region: 'Франция',
    continentLabel: 'Европа',
    lat: 48.86,
    lon: 2.35,
    type: 'capital',
    biome: 'urban',
    landmark: 'tower',
    palette: {
      ground: '#4b684b',
      foliage: '#3a7241',
      road: '#3b4758',
      wall: '#e7dfd1',
      roof: '#475569',
      accent: '#fbbf24',
    },
  },
  {
    id: 'alps_village',
    name: 'д. Гриндельвальд',
    region: 'Швейцария · Альпы',
    continentLabel: 'Европа',
    lat: 46.62,
    lon: 8.04,
    type: 'village',
    biome: 'taiga',
    palette: {
      ground: '#4d704a',
      foliage: '#1f5434',
      road: '#64748b',
      wall: '#f1f5f9',
      roof: '#7c2d12',
      accent: '#38bdf8',
    },
  },

  // Северная Америка
  {
    id: 'washington',
    name: 'Вашингтон',
    region: 'США · Округ Колумбия',
    continentLabel: 'Сев. Америка',
    lat: 38.9,
    lon: -77.04,
    type: 'capital',
    biome: 'urban',
    landmark: 'capitol',
    palette: {
      ground: '#456b47',
      foliage: '#346e3c',
      road: '#334155',
      wall: '#f8fafc',
      roof: '#cbd5e1',
      accent: '#38bdf8',
    },
  },
  {
    id: 'new_york',
    name: 'Нью-Йорк',
    region: 'США',
    continentLabel: 'Сев. Америка',
    lat: 40.71,
    lon: -74.0,
    type: 'city',
    biome: 'urban',
    palette: {
      ground: '#3d5245',
      foliage: '#2f633a',
      road: '#1e293b',
      wall: '#94a3b8',
      roof: '#475569',
      accent: '#f59e0b',
    },
  },
  {
    id: 'kansas_farm',
    name: 'д. Смоллвилль',
    region: 'США · Канзас',
    continentLabel: 'Сев. Америка',
    lat: 38.8,
    lon: -98.5,
    type: 'village',
    biome: 'temperate',
    palette: {
      ground: '#707341',
      foliage: '#4b6e35',
      road: '#856c4c',
      wall: '#dc2626',
      roof: '#f1f5f9',
      accent: '#eab308',
    },
  },

  // Южная Америка
  {
    id: 'rio',
    name: 'Рио-де-Жанейро',
    region: 'Бразилия',
    continentLabel: 'Юж. Америка',
    lat: -22.91,
    lon: -43.17,
    type: 'city',
    biome: 'coastal',
    palette: {
      ground: '#3f7341',
      foliage: '#15803d',
      road: '#334155',
      wall: '#f8fafc',
      roof: '#ea580c',
      accent: '#22d3ee',
    },
  },
  {
    id: 'amazon_village',
    name: 'д. Амазония',
    region: 'Перу · Сельва',
    continentLabel: 'Юж. Америка',
    lat: -3.75,
    lon: -73.25,
    type: 'village',
    biome: 'subtropical',
    palette: {
      ground: '#356633',
      foliage: '#166534',
      road: '#6e563a',
      wall: '#a17a4d',
      roof: '#85582c',
      accent: '#4ade80',
    },
  },

  // Африка
  {
    id: 'cairo',
    name: 'Каир',
    region: 'Египет · Гиза',
    continentLabel: 'Африка',
    lat: 30.04,
    lon: 31.23,
    type: 'capital',
    biome: 'desert',
    landmark: 'pyramids',
    palette: {
      ground: '#b8965d',
      foliage: '#4d7c3f',
      road: '#786956',
      wall: '#e7d5b5',
      roof: '#c29b61',
      accent: '#f59e0b',
    },
  },
  {
    id: 'nairobi',
    name: 'Найроби',
    region: 'Кения',
    continentLabel: 'Африка',
    lat: -1.29,
    lon: 36.82,
    type: 'city',
    biome: 'savanna',
    palette: {
      ground: '#8f7b47',
      foliage: '#4d6f33',
      road: '#3f4752',
      wall: '#e2e8f0',
      roof: '#b45309',
      accent: '#facc15',
    },
  },
  {
    id: 'cape_town',
    name: 'Кейптаун',
    region: 'ЮАР',
    continentLabel: 'Африка',
    lat: -33.92,
    lon: 18.42,
    type: 'city',
    biome: 'coastal',
    palette: {
      ground: '#63754a',
      foliage: '#3b6b3a',
      road: '#334155',
      wall: '#f1f5f9',
      roof: '#0f766e',
      accent: '#38bdf8',
    },
  },
  {
    id: 'africa_village',
    name: 'д. Серенгети',
    region: 'Танзания · Саванна',
    continentLabel: 'Африка',
    lat: -3.4,
    lon: 36.68,
    type: 'village',
    biome: 'savanna',
    palette: {
      ground: '#a37b48',
      foliage: '#5a6e2f',
      road: '#8c6239',
      wall: '#c2935b',
      roof: '#855c2e',
      accent: '#f59e0b',
    },
  },

  // Азия
  {
    id: 'tokyo',
    name: 'Токио',
    region: 'Япония',
    continentLabel: 'Азия',
    lat: 35.68,
    lon: 139.76,
    type: 'capital',
    biome: 'urban',
    landmark: 'tower',
    palette: {
      ground: '#3c5244',
      foliage: '#2f6a3f',
      road: '#1e293b',
      wall: '#cbd5e1',
      roof: '#334155',
      accent: '#f43f5e',
    },
  },
  {
    id: 'altai_village',
    name: 'с. Чемал',
    region: 'Россия · Алтай',
    continentLabel: 'Азия',
    lat: 51.41,
    lon: 86.01,
    type: 'village',
    biome: 'taiga',
    palette: {
      ground: '#476942',
      foliage: '#1e4d2b',
      road: '#6b5740',
      wall: '#a6794b',
      roof: '#5c341d',
      accent: '#22c55e',
    },
  },

  // Австралия
  {
    id: 'sydney',
    name: 'Сидней',
    region: 'Австралия',
    continentLabel: 'Австралия',
    lat: -33.87,
    lon: 151.21,
    type: 'city',
    biome: 'coastal',
    landmark: 'opera',
    palette: {
      ground: '#557849',
      foliage: '#3d703b',
      road: '#334155',
      wall: '#f8fafc',
      roof: '#e2e8f0',
      accent: '#0ea5e9',
    },
  },
  {
    id: 'canberra',
    name: 'Канберра',
    region: 'Австралия · Столица',
    continentLabel: 'Австралия',
    lat: -35.28,
    lon: 149.13,
    type: 'capital',
    biome: 'temperate',
    palette: {
      ground: '#617a49',
      foliage: '#436e3b',
      road: '#475569',
      wall: '#f1f5f9',
      roof: '#b45309',
      accent: '#eab308',
    },
  },
  {
    id: 'alice_springs',
    name: 'д. Алис-Спрингс',
    region: 'Австралия · Аутбэк',
    continentLabel: 'Австралия',
    lat: -23.7,
    lon: 133.88,
    type: 'village',
    biome: 'outback',
    palette: {
      ground: '#b55d35',
      foliage: '#5d733e',
      road: '#944a29',
      wall: '#e7d2be',
      roof: '#991b1b',
      accent: '#f59e0b',
    },
  },

  // Внешние земли за ледяным барьером Антарктиды
  {
    id: 'reptiloid_city',
    name: 'Город Рептилоидов',
    region: 'За Антарктидой · Зиккурат',
    continentLabel: 'Внешние земли',
    lat: -84,
    lon: 58,
    polar: [148, 0.85],
    type: 'outer',
    biome: 'subtropical',
    landmark: 'reptiloid',
    palette: {
      ground: '#263a33',
      foliage: '#10b981',
      road: '#1f2937',
      wall: '#1e352d',
      roof: '#047857',
      accent: '#34d399',
    },
  },
  {
    id: 'outer_outpost',
    name: 'Аванпост «За Стеной»',
    region: 'Внешние земли (>22 000 км)',
    continentLabel: 'Внешние земли',
    lat: -82,
    lon: -80.5,
    polar: [190, 0.81],
    type: 'outer',
    biome: 'temperate',
    landmark: 'outpost',
    palette: {
      ground: '#4a6b5e',
      foliage: '#2d6a56',
      road: '#475569',
      wall: '#cbd5e1',
      roof: '#0f766e',
      accent: '#4ade80',
    },
  },
];

export function getPlaceWorldPosition(place: WorldPlace, discRadius: number): THREE.Vector3 {
  if (place.polar) {
    const [deg, normR] = place.polar;
    const rad = ((deg - 90) * Math.PI) / 180;
    const r = normR * discRadius;
    return new THREE.Vector3(Math.cos(rad) * r, 0, Math.sin(rad) * r);
  }
  return projectLatLonToWorld(place.lat, place.lon, discRadius);
}

export function worldXZToApproxLatLon(
  x: number,
  z: number,
  discRadius: number,
): { lat: number; lon: number; radiusKm: number; isOuter: boolean; isIceWall: boolean } {
  const r = Math.hypot(x, z);
  const iceInnerKm = discRadius * ICE_INNER_NORM;
  const iceOuterKm = discRadius * (21200 / 28000);
  const isIceWall = r >= iceInnerKm && r <= iceOuterKm;
  const isOuter = r > iceOuterKm;

  const lat = 90 - (r / iceInnerKm) * 180;
  let lon = (Math.atan2(z, x) * 180) / Math.PI + 90;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;

  return { lat, lon, radiusKm: r, isOuter, isIceWall };
}
