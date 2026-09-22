import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedHtml: string | null = null;

export function getDashboardHtml(): string {
  if (cachedHtml && process.env.NODE_ENV === 'production') {
    return cachedHtml;
  }

  const possiblePaths = [
    path.join(__dirname, 'dashboard.html'),
    path.join(__dirname, '../src/ui/dashboard.html'),
    path.join(__dirname, '../../src/ui/dashboard.html'),
    path.join(process.cwd(), 'src/ui/dashboard.html'),
    path.join(process.cwd(), 'dist/ui/dashboard.html'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      cachedHtml = fs.readFileSync(p, 'utf8');
      return cachedHtml;
    }
  }

  return `<h1>AgResearch Labs API</h1><p>Dashboard template not found</p>`;
}
