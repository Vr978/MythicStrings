import { existsSync, readFileSync } from 'node:fs';

/** The same deliberately small, non-evaluating .env format as the game server. */
export function readEnv(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export function writeEnv(values) {
  return Object.entries(values).map(([name, value]) => {
    if (/[\r\n\0]/.test(String(value))) throw new Error('Environment values must occupy one line: ' + name);
    return name + '=' + JSON.stringify(String(value));
  }).join('\n') + '\n';
}

export const isPlaceholder = value => !value || /^(your[-_ ]|changeme|placeholder|xxx|<)/i.test(value);
