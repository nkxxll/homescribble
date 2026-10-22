import { defineConfig } from 'cypress';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  e2e: {
    baseUrl: 'http://127.0.0.1:3101', supportFile: false, specPattern: 'cypress/e2e/**/*.cy.ts',
    async setupNodeEvents(on) {
      const directory = mkdtempSync(join(tmpdir(), 'homescribble-cypress-'));
      let server: ChildProcess | undefined;
      let output = '';
      async function stop() {
        if (server && server.exitCode === null) {
          const child = server;
          await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
        }
        server = undefined;
      }
      async function start() {
        server = spawn('bun', ['src/index.ts'], { env: { ...process.env, PORT: '3101', DATABASE_PATH: join(directory, 'smoke.sqlite'), BACKUP_DIR: join(directory, 'backups'), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
        server.stdout?.on('data', data => { output += data; }); server.stderr?.on('data', data => { output += data; });
        for (let i = 0; i < 100; i++) {
          if (server.exitCode !== null) throw new Error(output);
          try { const r = await fetch('http://127.0.0.1:3101/api/health'); if (r.ok) return; } catch {}
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Test server did not start: ' + output);
      }
      await new Promise<void>((resolve, reject) => {
        const build = spawn('bun', ['run', 'build'], { stdio: 'inherit' });
        build.on('error', reject);
        build.on('exit', code => code === 0 ? resolve() : reject(new Error('Production build failed')));
      });
      await start();
      on('task', { async restartServer() { await stop(); await start(); return null; } });
      on('after:run', async results => { if ('totalFailed' in results && results.totalFailed) console.error(output); await stop(); rmSync(directory, { recursive: true, force: true }); });
    },
  },
  viewportWidth: 1280, viewportHeight: 900, video: false, defaultCommandTimeout: 15000,
});
