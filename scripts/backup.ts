import { openStore } from '../src/store';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const destination = process.argv[2] || `data/backups/manual-${Date.now()}.sqlite`;
mkdirSync(dirname(destination), { recursive: true });
const store = openStore(process.env.DATABASE_PATH || 'data/homescribble.sqlite');
await Bun.write(destination, store.db.serialize());
store.db.close();
console.log(`Backup saved to ${destination}`);
