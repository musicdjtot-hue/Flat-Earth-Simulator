import type { SimulationParams } from '../types/simulation';

export function downloadIPhoneHtml(params: SimulationParams) {
  const info = JSON.stringify(params, null, 2);
  const blob = new Blob([info], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'azimut-40-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadGitHubZip(params: SimulationParams) {
  downloadIPhoneHtml(params);
}
