const title = () => cy.get('input[aria-label="Canvas title"]');
const saved = () => cy.get('[data-testid="save-status"]').should('contain', 'Saved');
function draw() {
  cy.get('[data-testid="toolbar-rectangle"]').parent().click();
  cy.get('canvas.interactive').trigger('pointerdown', { clientX: 520, clientY: 360, eventConstructor: 'PointerEvent', pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, force: true })
    .trigger('pointermove', { clientX: 750, clientY: 510, eventConstructor: 'PointerEvent', pointerId: 1, pointerType: 'mouse', buttons: 1, force: true })
    .wait(80).trigger('pointerup', { clientX: 750, clientY: 510, eventConstructor: 'PointerEvent', pointerId: 1, pointerType: 'mouse', button: 0, force: true });
}
function create(name = 'Smoke canvas') {
  return cy.request('POST', '/api/canvases', { title: name }).then(r => r.body.id as string);
}
function mcpAdd(canvasId: string) {
  return cy.request(`/api/canvases/${canvasId}`).then(canvas => cy.request({
    method: 'POST', url: '/mcp', headers: { Accept: 'application/json, text/event-stream' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_elements', arguments: { canvasId, expectedRevision: canvas.body.revision, elements: [{ id: 'mcp-box', type: 'rectangle', x: 100, y: 100, width: 200, height: 120 }] } } },
  })).its('status').should('eq', 200);
}
describe('Homescribble browser smoke tests', () => {
  beforeEach(() => {
    cy.request('/api/canvases').then(r => { for (const c of r.body) cy.request('DELETE', `/api/canvases/${c.id}`); });
    cy.request('/api/projects').then(r => { for (const p of r.body) cy.request('DELETE', `/api/projects/${p.id}`); });
    cy.visit('/', { onBeforeLoad(win) { win.indexedDB.deleteDatabase('homescribble-recovery'); win.sessionStorage.clear(); } });
  });
  it('organizes projects, searches both result types, and retains canvases after project deletion', () => {
    cy.window().then(win => cy.stub(win, 'prompt').returns('House ideas'));
    cy.contains('New project').click();
    cy.location('pathname').should('match', /^\/project\//);
    cy.contains('New canvas').click();
    title().clear().type('House sketch'); saved();
    cy.contains('All canvases').click();
    cy.get('.project-card').should('contain', '1 canvas');
    cy.get('[aria-label="Search projects and canvases"]').type('HOUSE');
    cy.get('.project-card').should('have.length', 1);
    cy.get('.canvas-card').should('have.length', 1);
    cy.request('/api/search?q=HOUSE').then(r => { expect(r.body.projects).length(1); expect(r.body.canvases).length(1); });
    cy.contains('.project-card .canvas-title', 'House ideas').click();
    cy.reload();
    cy.get('.canvas-card').should('contain', 'House sketch');
    cy.contains('Duplicate').click();
    cy.get('.canvas-card').should('have.length', 2);
    cy.get('[aria-label="Project for House sketch (copy)"]').select('');
    cy.get('.canvas-card').should('have.length', 1);
    cy.get('[aria-label="Search projects and canvases"]').type('(copy)');
    cy.get('.canvas-card').should('contain', 'House sketch (copy)');
    cy.contains('All canvases and projects').click();
    cy.window().then(win => cy.stub(win, 'prompt').returns('Renamed house'));
    cy.contains('Rename project').click();
    cy.get('.project-card').should('contain', 'Renamed house');
    cy.request('/api/projects').then(r => {
      cy.get('[aria-label="Project for House sketch (copy)"]').select(r.body[0].id);
    });
    cy.get('.project-card').should('contain', '2 canvases');
    cy.on('window:confirm', () => true);
    cy.contains('Delete project').click();
    cy.get('.project-card').should('not.exist');
    cy.get('.canvas-card').should('have.length', 2);
    cy.get('.canvas-kind').each(el => expect(el.text()).contain('No project'));
    cy.reload(); cy.get('.canvas-card').should('have.length', 2);
    cy.get('[aria-label="Search projects and canvases"]').type('no match');
    cy.contains('No projects or canvases match your search.').should('be.visible');
  });
  it('creates, draws, saves, reloads, renames, duplicates, searches and deletes', () => {
    cy.contains('New canvas').click();
    title().clear().type('A real drawing');
    draw(); saved();
    cy.location('pathname').then(path => {
      cy.request(`/api/canvases/${path.split('/').pop()}`).its('body.scene.elements').should('have.length', 1);
      cy.reload(); title().should('have.value', 'A real drawing'); saved();
      cy.get('canvas.interactive').should('be.visible');
      cy.request(`/api/canvases/${path.split('/').pop()}`).its('body.scene.elements').should('have.length', 1);
    });
    cy.contains('All canvases').click();
    cy.window().then(win => cy.stub(win, 'prompt').returns('Renamed drawing'));
    cy.contains('Rename').click(); cy.contains('Renamed drawing').should('be.visible');
    cy.contains('Duplicate').click(); cy.contains('Renamed drawing (copy)').should('be.visible');
    cy.get('[aria-label="Search projects and canvases"]').type('(copy)'); cy.get('.canvas-card').should('have.length', 1);
    cy.on('window:confirm', () => true); cy.contains('Delete').click(); cy.get('.canvas-card').should('have.length', 0);
    cy.get('[aria-label="Search projects and canvases"]').clear(); cy.get('.canvas-card').should('have.length', 1);
    cy.screenshot('dashboard');
  });
  it('preserves offline drafts through reload and retries after reconnect', () => {
    create().then(id => {
      cy.visit(`/canvas/${id}`); saved();
      let offline = true;
      cy.intercept('PUT', `/api/canvases/${id}`, req => { if (offline) req.destroy(); else req.continue(); });
      cy.window().then(win => Object.defineProperty(win.navigator, 'onLine', { configurable: true, get: () => !offline }));
      title().clear().type('Offline recovered'); draw();
      cy.get('[data-testid="save-status"]').should('contain', 'Offline');
      cy.wait(1400);
      cy.window().then(win => new Cypress.Promise<any[]>(resolve => {
        const request = win.indexedDB.open('homescribble-recovery', 1);
        request.onsuccess = () => { const db = request.result; const read = db.transaction('drafts').objectStore('drafts').getAll(); read.onsuccess = () => { db.close(); resolve(read.result); }; };
      })).then(local => { expect(local.find(d => d.id === id)?.scene.elements, 'rectangle in local recovery before reload').length(1); });
      cy.reload(); title().should('have.value', 'Offline recovered');
      cy.then(() => { offline = false; });
      cy.window().then(win => win.dispatchEvent(new Event('online'))); saved();
      cy.request(`/api/canvases/${id}`).then(r => { expect(r.body.title).eq('Offline recovered'); expect(r.body.scene.elements).length(1); });
    });
  });
  it('serializes slow saves and keeps newer edits', () => {
    create().then(id => {
      cy.visit(`/canvas/${id}`); saved();
      let count = 0;
      cy.intercept('PUT', `/api/canvases/${id}`, req => { count++; if (count === 1) req.on('response', res => { res.setDelay(2500); }); }).as('save');
      title().clear().type('First edit'); cy.wait(1400);
      title().clear().type('Newest edit');
      cy.get('[data-testid="save-status"]').should('contain', 'Saving');
      cy.wait('@save'); saved();
      cy.request(`/api/canvases/${id}`).its('body.title').should('eq', 'Newest edit');
    });
  });
  it('keeps pending saves assigned to their canvas while navigating', () => {
    create('First canvas').then(first => create('Second canvas').then(second => {
      cy.visit(`/canvas/${first}`); saved();
      cy.intercept('PUT', `/api/canvases/${first}`, req => req.on('response', res => { res.setDelay(2000); })).as('firstSave');
      title().clear().type('First pending'); cy.contains('All canvases').click();
      cy.contains('.canvas-title', 'Second canvas').click(); title().clear().type('Second pending'); saved();
      cy.wait('@firstSave');
      cy.request(`/api/canvases/${first}`).its('body.title').should('eq', 'First pending');
      cy.request(`/api/canvases/${second}`).its('body.title').should('eq', 'Second pending');
    }));
  });
  it('surfaces concurrent revision conflicts and recovers without overwriting', () => {
    create('Shared canvas').then(id => {
      cy.visit(`/canvas/${id}`); saved();
      cy.request(`/api/canvases/${id}`).then(r => cy.request('PUT', `/api/canvases/${id}`, { revision: r.body.revision, title: 'Other tab version' }));
      title().clear().type('My local version');
      cy.get('[data-testid="save-status"]').should('contain', 'Conflict');
      cy.reload(); title().should('have.value', 'My local version');
      cy.contains('Save draft as new canvas').click(); saved();
      title().should('have.value', 'My local version (recovered)');
      cy.request(`/api/canvases/${id}`).its('body.title').should('eq', 'Other tab version');
    });
  });
  it('adopts an MCP revision in a clean open editor without reloading', () => {
    create('Live MCP').then(id => {
      cy.visit(`/canvas/${id}`); cy.wait(500); saved();
      cy.get('[data-testid="element-count"]').should('have.text', '0');
      mcpAdd(id);
      cy.get('[data-testid="element-count"]').should('have.text', '1');
      saved();
    });
  });
  it('preserves dirty browser work as a conflict when MCP commits', () => {
    create('Dirty MCP').then(id => {
      cy.visit(`/canvas/${id}`); cy.wait(500); saved();
      cy.intercept('PUT', `/api/canvases/${id}`, { statusCode: 503, body: { error: 'Hold local draft' } });
      title().clear().type('Unsaved local title');
      cy.get('[data-testid="save-status"]').should('contain', 'Save failed');
      mcpAdd(id);
      cy.get('[data-testid="save-status"]').should('contain', 'Conflict');
      title().should('have.value', 'Unsaved local title');
      cy.get('[data-testid="element-count"]').should('have.text', '0');
      cy.request(`/api/canvases/${id}`).then(response => {
        expect(response.body.title).eq('Dirty MCP');
        expect(response.body.scene.elements).length(1);
      });
    });
  });
  it('imports an embedded image and survives reload and a real server restart', () => {
    create('Image persistence').then(id => {
      cy.visit(`/canvas/${id}`); saved();
      const dataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=';
      const scene = { type: 'excalidraw', version: 2, source: 'test', elements: [{ id: 'picture', type: 'image', x: 300, y: 200, width: 120, height: 120, angle: 0, strokeColor: 'transparent', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, fileId: 'embedded', status: 'saved', scale: [1, 1], crop: null }], appState: { viewBackgroundColor: '#fafafa' }, files: { embedded: { id: 'embedded', mimeType: 'image/png', dataURL, created: 1 } } };
      // Drag an actual Excalidraw file through the editor's public import path.
      cy.get('.excalidraw').selectFile({ contents: Cypress.Buffer.from(JSON.stringify(scene)), fileName: 'image.excalidraw', mimeType: 'application/json' }, { action: 'drag-drop', force: true });
      cy.get('[data-testid="save-status"]').should('contain', 'Saving'); saved();
      cy.request(`/api/canvases/${id}`).then(r => { expect(r.body.scene.elements[0].type).eq('image'); expect(r.body.scene.files.embedded.dataURL).eq(dataURL); });
      cy.reload(); saved();
      cy.task('restartServer'); cy.reload(); saved();
      cy.request(`/api/canvases/${id}`).then(r => { expect(r.body.scene.files.embedded.dataURL).eq(dataURL); expect(r.body.scene.elements[0].fileId).eq('embedded'); });
      cy.screenshot('editor-after-server-restart');
    });
  });
  it('pastes a real PNG through the clipboard and reloads its embedded data', () => {
    create('Pasted image').then(id => {
      cy.visit(`/canvas/${id}`); saved();
      cy.get('canvas.interactive').trigger('pointermove', { clientX: 650, clientY: 430, eventConstructor: 'PointerEvent', pointerId: 1, pointerType: 'mouse', force: true }).click(650, 350, { force: true });
      cy.window().then(win => {
        const canvas = win.document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#62934c'; ctx.fillRect(0, 0, 80, 60);
        const blob = Cypress.Blob.base64StringToBlob(canvas.toDataURL().split(',')[1]!, 'image/png');
        const transfer = new win.DataTransfer(); transfer.items.add(new win.File([blob], 'clipboard.png', { type: 'image/png' }));
        win.document.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      });
      cy.get('[data-testid="save-status"]').should('contain', 'Saving'); saved();
      cy.request(`/api/canvases/${id}`).then(r => {
        expect(r.body.scene.elements.filter((e: any) => e.type === 'image')).length(1);
        expect(Object.values(r.body.scene.files)).length(1);
        const files = r.body.scene.files;
        cy.reload(); saved();
        cy.request(`/api/canvases/${id}`).its('body.scene.files').should('deep.eq', files);
        cy.get<HTMLCanvasElement>('canvas.excalidraw__canvas').should(canvases => {
          let greenPixels = 0;
          for (const canvas of Array.from(canvases)) {
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 98 && pixels[i + 1] === 147 && pixels[i + 2] === 76) greenPixels++;
          }
          expect(greenPixels, 'pasted image rendered after reload').greaterThan(100);
        });
        cy.screenshot('pasted-image-after-reload');
      });
    });
  });
  it('saves periodically during continuous editing', () => {
    create().then(id => {
      cy.visit(`/canvas/${id}`); saved();
      let writes = 0;
      cy.intercept('PUT', `/api/canvases/${id}`, req => { writes++; req.continue(); });
      title().clear().type('Continuous editing for several seconds', { delay: 180 });
      cy.then(() => expect(writes, 'a periodic save before typing stops').greaterThan(0));
      saved(); cy.request(`/api/canvases/${id}`).its('body.title').should('eq', 'Continuous editing for several seconds');
    });
  });
  it('reports failed saves until persistence succeeds', () => {
    create().then(id => {
      cy.visit(`/canvas/${id}`); saved();
      let failing = true;
      cy.intercept('PUT', `/api/canvases/${id}`, req => { if (failing) req.reply({ statusCode: 503, body: { error: 'Temporary outage' } }); else req.continue(); });
      title().clear().type('Retry me'); cy.get('[data-testid="save-status"]').should('contain', 'Save failed');
      cy.request(`/api/canvases/${id}`).its('body.title').should('eq', 'Smoke canvas');
      cy.then(() => { failing = false; }); cy.contains('Retry now').click(); saved();
      cy.request(`/api/canvases/${id}`).its('body.title').should('eq', 'Retry me');
    });
  });
});
