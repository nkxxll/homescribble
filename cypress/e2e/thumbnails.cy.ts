const base = { angle: 0, strokeColor: '#1b1b1f', backgroundColor: '#6d9eeb', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false };
const rectangle = { ...base, id: 'box', type: 'rectangle', x: 0, y: 0, width: 360, height: 200 };
function preview() {
  return cy.get<HTMLImageElement>('.canvas-preview img').should(image => {
    expect(image[0]!.complete, 'thumbnail loaded').eq(true);
    expect(image[0]!.naturalWidth).greaterThan(0).and.at.most(720);
    expect(image[0]!.naturalHeight).greaterThan(0).and.at.most(720);
  });
}

describe('Canvas thumbnails', () => {
  beforeEach(() => {
    cy.request('/api/canvases').then(response => { for (const canvas of response.body) cy.request('DELETE', `/api/canvases/${canvas.id}`); });
    cy.request('/api/projects').then(response => { for (const project of response.body) cy.request('DELETE', `/api/projects/${project.id}`); });
    cy.visit('/');
    // Finish the initial metadata request before seeding canvases. Otherwise
    // the dashboard can discover and cache a seed before interception begins.
    cy.get('.empty').should('be.visible');
  });

  it('renders drawing content and embedded images, then reuses persistent thumbnails without fetching scenes', () => {
    cy.window().then(win => {
      const image = win.document.createElement('canvas'); image.width = 80; image.height = 60;
      const context = image.getContext('2d')!; context.fillStyle = '#62934c'; context.fillRect(0, 0, 80, 60);
      return cy.request('POST', '/api/canvases', {
        title: 'Kitchen layout', scene: {
          elements: [rectangle,
            { ...base, id: 'label', type: 'text', x: 20, y: 20, width: 250, height: 35, fontSize: 28, fontFamily: 5, text: 'Kitchen layout', originalText: 'Kitchen layout', textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true },
            { ...base, id: 'arrow', type: 'arrow', x: 40, y: 245, width: 280, height: 0, points: [[0, 0], [280, 0]], startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow' },
            { ...base, id: 'picture', type: 'image', x: 400, y: 0, width: 160, height: 120, fileId: 'image', status: 'saved', scale: [1, 1], crop: null }],
          appState: { viewBackgroundColor: '#fff4db', theme: 'dark', zoom: { value: 5 }, scrollX: -10000, scrollY: -10000 },
          files: { image: { id: 'image', dataURL: image.toDataURL(), mimeType: 'image/png', created: 1 } },
        },
      });
    }).then(response => {
      const id = response.body.id;
      cy.intercept('PUT', `/api/canvases/${id}/thumbnail*`).as('thumbnail');
      cy.reload();
      cy.wait('@thumbnail').its('response.statusCode').should('eq', 200);
      preview().then(images => {
        const scratch = images[0]!.ownerDocument.createElement('canvas'); scratch.width = images[0]!.naturalWidth; scratch.height = images[0]!.naturalHeight;
        const context = scratch.getContext('2d')!; context.drawImage(images[0]!, 0, 0);
        const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
        let green = 0, blue = 0, dark = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (Math.abs(pixels[i]! - 98) < 8 && Math.abs(pixels[i + 1]! - 147) < 8 && Math.abs(pixels[i + 2]! - 76) < 8) green++;
          if (Math.abs(pixels[i]! - 109) < 8 && Math.abs(pixels[i + 1]! - 158) < 8 && Math.abs(pixels[i + 2]! - 235) < 8) blue++;
          if (pixels[i]! < 60 && pixels[i + 1]! < 60 && pixels[i + 2]! < 60) dark++;
        }
        expect(green, 'embedded image pixels').greaterThan(1000);
        expect(blue, 'rectangle pixels').greaterThan(1000);
        expect(dark, 'text, arrow, and outline pixels').greaterThan(500);
      });
      cy.screenshot('canvas-card-thumbnails');
      let sceneRequests = 0, thumbnailWrites = 0;
      cy.intercept('GET', `/api/canvases/${id}`, req => { sceneRequests++; req.continue(); });
      cy.intercept('PUT', `/api/canvases/${id}/thumbnail*`, req => { thumbnailWrites++; req.continue(); });
      cy.reload(); preview();
      cy.task('restartServer'); cy.reload(); preview();
      cy.then(() => { expect(sceneRequests).eq(0); expect(thumbnailWrites).eq(0); });
      cy.request(`/api/canvases/${id}`).its('body.revision').should('eq', 0);
    });
  });

  it('regenerates after an MCP edit and retries if an edit lands during thumbnail upload', () => {
    cy.request('POST', '/api/canvases', { title: 'Changing drawing', scene: { elements: [rectangle], appState: {}, files: {} } }).then(response => {
      const id = response.body.id;
      cy.intercept('PUT', `/api/canvases/${id}/thumbnail*`).as('thumbnail');
      cy.reload(); cy.wait('@thumbnail'); preview();
      cy.request({ method: 'POST', url: '/mcp', headers: { Accept: 'application/json, text/event-stream' }, body: {
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_elements', arguments: { canvasId: id, expectedRevision: 0, updates: [{ id: 'box', patch: { backgroundColor: '#ff9955' } }] } },
      } }).then(result => {
        const payload = typeof result.body === 'string' ? JSON.parse(result.body.split('\n').find((line: string) => line.startsWith('data: '))!.slice(6)) : result.body;
        expect(payload.result.isError).not.eq(true);
        expect(payload.result.structuredContent.data.revision).eq(1);
      });
      cy.request('/api/canvases').then(result => expect(result.body[0].thumbnailRevision).eq(null));
      cy.intercept({ method: 'PUT', url: `/api/canvases/${id}/thumbnail*`, times: 1 }, req => {
        // Commit a real second edit before allowing the first rendering to upload.
        return fetch(`http://127.0.0.1:3101/api/canvases/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: 1, scene: { elements: [{ ...rectangle, backgroundColor: '#99cc66' }], appState: {}, files: {} } }),
        }).then(result => { expect(result.status).eq(200); req.continue(); });
      }).as('staleThumbnail');
      cy.reload();
      cy.wait('@staleThumbnail').its('response.statusCode').should('eq', 409);
      cy.wait('@thumbnail').its('response.statusCode').should('eq', 200);
      preview().should('have.attr', 'src', `/api/canvases/${id}/thumbnail?revision=2`);
      cy.request('/api/canvases').then(result => expect(result.body[0].thumbnailRevision).eq(2));
    });
  });

  it('handles empty and extremely wide canvases and leaves cards usable when rendering fails', () => {
    cy.request('POST', '/api/canvases', { title: 'Empty' });
    cy.reload(); preview();
    cy.request('POST', '/api/canvases', { title: 'Wide', scene: { elements: [{ ...rectangle, width: 1000000, height: 1 }], appState: {}, files: {} } });
    cy.reload();
    cy.contains('.canvas-card', 'Wide').find<HTMLImageElement>('img').should(images => { expect(images[0]!.naturalWidth).eq(720); expect(images[0]!.naturalHeight).at.least(1); });
    cy.request('POST', '/api/canvases', { title: 'Unavailable' }).then(response => {
      cy.intercept('GET', `/api/canvases/${response.body.id}`, { statusCode: 503, body: { error: 'Unavailable' } });
      cy.reload();
      cy.contains('.canvas-card', 'Unavailable').should('contain', 'Preview unavailable').find('.canvas-preview').click();
      cy.location('pathname').should('eq', `/canvas/${response.body.id}`);
    });
  });

  it('defers offscreen scenes and limits simultaneous scene downloads', () => {
    for (let i = 0; i < 12; i++) {
      cy.request('POST', '/api/canvases', { title: `Drawing ${i}`, scene: { elements: [rectangle], appState: {}, files: {} } });
    }
    let active = 0, maximum = 0;
    const fetched = new Set<string>();
    cy.intercept({ method: 'GET', pathname: '/api/canvases/*' }, req => {
      fetched.add(new URL(req.url).pathname.split('/')[3]!); active++; maximum = Math.max(maximum, active);
      req.on('response', res => { res.setDelay(200); });
      req.on('after:response', () => { active--; });
      req.continue();
    }).as('sceneDownload');
    cy.reload();
    cy.wait('@sceneDownload');
    preview();
    cy.then(() => expect(fetched.size, 'only nearby cards fetch scenes').lessThan(12));
    cy.get('.canvas-card').last().scrollIntoView();
    cy.get('.canvas-card').last().find<HTMLImageElement>('img').should(images => expect(images[0]!.naturalWidth).greaterThan(0)).then(images => {
      const id = new URL(images[0]!.src).pathname.split('/')[3]!;
      expect([...fetched], 'scrolled card fetched its scene').include(id);
      expect(maximum, 'bounded concurrent scene requests').greaterThan(0).and.at.most(2);
    });
  });
});
