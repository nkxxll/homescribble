const base = { angle: 0, strokeColor: '#1b1b1f', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false };
const label = { ...base, id: 'text', type: 'text', x: 20, y: 20, width: 400, height: 25, fontSize: 20, fontFamily: 1, text: 'First line\nSecond line\nLast line', originalText: 'First line\nSecond line\nLast line', textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true };
const saved = () => cy.get('[data-testid="save-status"]').should('contain', 'Saved');
function mcpPatch(id: string, patch: Record<string, unknown>) {
  return cy.request(`/api/canvases/${id}`).then(canvas => cy.request({
    method: 'POST', url: '/mcp', headers: { Accept: 'application/json, text/event-stream' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_elements', arguments: { canvasId: id, expectedRevision: canvas.body.revision, updates: [{ id: 'text', patch }] } } },
  }));
}

describe('Font-aware text dimensions', () => {
  beforeEach(() => {
    cy.request('/api/canvases').then(response => { for (const canvas of response.body) cy.request('DELETE', `/api/canvases/${canvas.id}`); });
  });

  it('repairs old multiline text before display, saves it once, and repairs live MCP text patches', () => {
    cy.request('POST', '/api/canvases', { title: 'Multiline', scene: { elements: [label], appState: {}, files: {} } }).then(response => {
      const id = response.body.id;
      let writes = 0;
      cy.intercept('PUT', `/api/canvases/${id}`, req => { writes++; req.continue(); }).as('save');
      cy.visit(`/canvas/${id}`);
      cy.wait('@save'); saved();
      cy.request(`/api/canvases/${id}`).then(result => {
        expect(result.body.scene.elements[0].height).eq(75);
        cy.document().then(doc => {
          const context = doc.createElement('canvas').getContext('2d')!; context.font = '20px Virgil';
          const width = Math.max(...label.text.split('\n').map(line => context.measureText(line).width));
          expect(result.body.scene.elements[0].width).closeTo(width, 1);
          expect(doc.fonts.check('20px Virgil', label.text), 'actual drawing font loaded').eq(true);
        });
      });
      cy.wait(1500).then(() => expect(writes, 'no normalization save loop').eq(1));
      cy.reload(); saved();
      cy.wait(1500).then(() => expect(writes, 'idempotent on reload').eq(1));
      mcpPatch(id, { text: 'Updated\nSecond\nThird\nFourth', height: 25, width: 500 });
      cy.wait('@save'); saved();
      cy.request(`/api/canvases/${id}`).then(result => {
        expect(result.body.scene.elements[0]).include({ text: 'Updated\nSecond\nThird\nFourth', height: 100 });
        expect(result.body.scene.elements[0].width).lessThan(500);
      });
      cy.wait(1500).then(() => expect(writes, 'one repair for the MCP revision').eq(2));
    });
  });

  it('keeps local edits when an MCP font load finishes late', () => {
    cy.request('POST', '/api/canvases', { title: 'Font race', scene: { elements: [{ ...label, fontFamily: 2 }], appState: {}, files: {} } }).then(response => {
      const id = response.body.id;
      cy.visit(`/canvas/${id}`); saved();
      // Settle the initial dimension repair before introducing an MCP update.
      cy.wait(1500); saved();
      let loading = false;
      cy.intercept('**/Cascadia/*.woff2', req => {
        loading = true;
        req.on('response', res => { res.setDelay(2500); });
      }).as('font');
      cy.intercept('PUT', `/api/canvases/${id}`, { statusCode: 503, body: { error: 'Keep draft dirty' } });
      mcpPatch(id, { fontFamily: 3, text: 'Remote\ntext' });
      cy.wrap(null).should(() => expect(loading, 'MCP font load started').eq(true));
      cy.get('input[aria-label="Canvas title"]').clear().type('My local title');
      cy.wait('@font');
      cy.get('[data-testid="save-status"]').should('contain', 'Conflict');
      cy.get('input[aria-label="Canvas title"]').should('have.value', 'My local title');
      cy.request(`/api/canvases/${id}`).then(result => {
        expect(result.body.title).eq('Font race');
        expect(result.body.scene.elements[0].text).eq('Remote\ntext');
      });
      cy.contains('Download draft').should('be.visible');
    });
  });

  it('retains fixed widths, repairs bound text, and leaves deleted text deleted', () => {
    const box = { ...base, id: 'box', type: 'rectangle', x: 300, y: 0, width: 200, height: 200, boundElements: [{ id: 'bound', type: 'text' }] };
    const elements = [
      { ...label, width: 70, autoResize: false }, box,
      { ...label, id: 'bound', x: 310, containerId: 'box', width: 190 },
      { ...label, id: 'deleted', isDeleted: true },
    ];
    cy.request('POST', '/api/canvases', { title: 'Wrapped', scene: { elements, appState: {}, files: {} } }).then(response => {
      const id = response.body.id;
      cy.intercept('PUT', `/api/canvases/${id}`).as('save');
      cy.visit(`/canvas/${id}`); cy.wait('@save'); saved();
      cy.request(`/api/canvases/${id}`).then(result => {
        const repaired = result.body.scene.elements;
        expect(repaired[0].width).eq(70);
        expect(repaired[0].height).greaterThan(75);
        expect(repaired[2]).include({ containerId: 'box', height: 75 });
        expect(repaired[3].isDeleted).eq(true);
      });
    });
  });

  it('normalizes thumbnail bounds before export, including the last line', () => {
    cy.request('POST', '/api/canvases', { title: 'Text preview', scene: { elements: [label], appState: {}, files: {} } }).then(response => {
      cy.intercept('PUT', `/api/canvases/${response.body.id}/thumbnail*`).as('thumbnail');
      cy.visit('/'); cy.wait('@thumbnail');
      cy.get<HTMLImageElement>('.canvas-preview img').should(images => {
        const image = images[0]!;
        expect(image.naturalHeight).eq(123); // 75px of text + 24px padding on each side
        const canvas = image.ownerDocument.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 74, canvas.width, 25).data;
        let dark = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 100 && pixels[i + 1]! < 100 && pixels[i + 2]! < 100) dark++;
        expect(dark, 'last line is rendered').greaterThan(50);
      });
    });
  });
});
