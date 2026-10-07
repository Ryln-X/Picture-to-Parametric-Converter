import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function imageFile(page: Page, format = 'image/png') {
  const data = await page.evaluate(format => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 620;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 620);
    ctx.strokeStyle = '#cbd0ce'; ctx.lineWidth = 1;
    for (let x = 80; x <= 940; x += 43) { ctx.beginPath(); ctx.moveTo(x, 50); ctx.lineTo(x, 550); ctx.stroke(); }
    for (let y = 50; y <= 550; y += 50) { ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(940, y); ctx.stroke(); }
    ctx.strokeStyle = '#c25040'; ctx.lineWidth = 3; ctx.beginPath();
    for (let x = 100; x <= 900; x++) { const y = 290 + 70 * Math.sin(x / 100); if (x === 100) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke(); ctx.fillStyle = '#555'; ctx.font = '12px sans-serif'; ctx.fillText('Frequency (Hz)', 450, 591);
    return canvas.toDataURL(format).split(',')[1];
  }, format);
  return { name: format === 'image/webp' ? 'response.webp' : 'response.png', mimeType: format, buffer: Buffer.from(data, 'base64') };
}
async function position(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('graph-canvas').boundingBox())!;
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}
async function click(page: Page, x: number, y: number) { const p = await position(page, x, y); await page.mouse.click(p.x, p.y); }
async function move(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
}
async function value(page: Page, label: string, n: string) { const input = page.getByRole('spinbutton', { name: label, exact: true }); await input.fill(n); await input.press('Enter'); }
async function saveProject(page: Page) {
  await page.getByLabel('Project menu').click();
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const file = await promise; return JSON.parse(await readFile((await file.path())!, 'utf8'));
}

test('WebP, Bézier handles, insertion, undo, preview editing and TXT export', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const outside: string[] = []; page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:5173')) outside.push(r.url()); });
  await page.goto('/'); await page.getByTestId('image-input').setInputFiles(await imageFile(page, 'image/webp'));
  await expect(page.getByText('response.webp', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await move(page, await position(page, .15, .4), await position(page, .22, .28));
  await move(page, await position(page, .85, .4), await position(page, .92, .52));
  await expect(page.getByTestId('handle-incoming')).toBeVisible();
  let saved = await saveProject(page); expect(saved.points).toHaveLength(2); expect(saved.points[0].outgoing.y).toBeLessThan(.4);
  await page.getByRole('button', { name: 'Points', exact: true }).click(); await click(page, .5, .45);
  saved = await saveProject(page); expect(saved.points).toHaveLength(3); expect(saved.points[1].x).toBeCloseTo(.5, 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.getByTestId('point-2')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.getByTestId('point-2')).toHaveCount(1);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await move(page, await position(page, .5, .45), await position(page, .52, .5));
  saved = await saveProject(page); expect(saved.points[1].y).toBeCloseTo(.5, 2);
  await value(page, 'Y offset', '100');
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  expect(Number(await page.getByLabel('Point 2 Y value', { exact: true }).inputValue())).toBeCloseTo(-22, 1);
  await value(page, 'Point 2 X value', '1000');
  await page.getByLabel('Export values').selectOption('curve');
  await value(page, 'Export sample count', '200');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download TXT' }).click();
  const output = await readFile((await (await download).path())!, 'utf8');
  expect(output.trim().split('\n')).toHaveLength(200); expect(output).not.toMatch(/NaN|Infinity/);
  expect(errors).toEqual([]); expect(outside).toEqual([]);
});

test('custom axis references change values while the curve stays fixed', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('image-input').setInputFiles(await imageFile(page)); await click(page, .2, .4); await click(page, .8, .6);
  const before = await saveProject(page);
  await page.getByRole('button', { name: 'Edit axes', exact: true }).click();
  await page.getByRole('button', { name: 'Add reference', exact: true }).first().click();
  await value(page, 'X reference 2 value', '500');
  await value(page, 'X reference 2 position', '60');
  await move(page, await position(page, .6, .2), await position(page, .66, .2));
  const after = await saveProject(page);
  expect(after.points).toEqual(before.points); expect(after.xAxis.anchors).toHaveLength(3);
  expect(after.xAxis.anchors.find((a: { value: number }) => a.value === 500).position).toBeCloseTo(.66, 2);
  await page.getByLabel('Y scale', { exact: true }).selectOption('log');
  await page.getByLabel('Y scale', { exact: true }).selectOption('linear');
  await value(page, 'Y reference 2 value', '-40');
  await page.getByLabel('Y scale', { exact: true }).selectOption('log');
  await expect(page.getByRole('status')).toContainText('positive');
  await expect(page.getByLabel('Y scale', { exact: true })).toHaveValue('linear');
});

test('guided tracing previews and applies a curve with adjustable density', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('image-input').setInputFiles(await imageFile(page));
  for (const x of [100, 200, 300, 400, 500, 600, 700, 800, 900]) await click(page, x / 1000, (295 + 70 * Math.sin(x / 100)) / 620);
  await page.getByRole('button', { name: 'Pick line color', exact: true }).click(); await click(page, .1, (290 + 70 * Math.sin(1)) / 620);
  await page.getByLabel('More points around bends').uncheck();
  await page.getByRole('button', { name: 'Trace from sketch' }).click(); await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const uniform = await saveProject(page); expect(uniform.points.length).toBeGreaterThan(70);
  for (const point of uniform.points) expect(Math.abs(point.y * 620 - (290 + 70 * Math.sin(point.x * 10)))).toBeLessThan(6);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByLabel('More points around bends').check();
  await page.getByRole('button', { name: 'Trace from sketch' }).click(); await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const adaptive = await saveProject(page); expect(adaptive.points.length).toBeLessThan(uniform.points.length);
  await page.getByRole('button', { name: 'Preview', exact: true }).click(); await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/graph-editor-desktop.png', fullPage: true });
});

test('magnifier, cursor-centered zoom, image alignment, and project restoration', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('image-input').setInputFiles(await imageFile(page)); await click(page, .2, .4); await click(page, .8, .6);
  await page.mouse.move((await position(page, .3, .4)).x, (await position(page, .3, .4)).y);
  await expect(page.getByLabel('Magnified cursor view')).toBeVisible();
  await page.getByLabel('Magnifier', { exact: true }).selectOption('ctrl');
  await expect(page.getByLabel('Magnified cursor view')).toHaveCount(0);
  const at = await position(page, .3, .4); await page.mouse.move(at.x, at.y); await page.keyboard.down('Control');
  await expect(page.getByLabel('Magnified cursor view')).toBeVisible(); await page.keyboard.up('Control');
  await expect(page.getByLabel('Magnified cursor view')).toHaveCount(0);
  await page.mouse.wheel(0, -400); await expect(page.getByTestId('graph-canvas')).not.toHaveAttribute('viewBox', '0 0 1000 620');
  await page.getByTitle('Fit image').click();
  const before = await saveProject(page);
  await page.getByText('Align image', { exact: true }).click(); await page.getByLabel('Drag image', { exact: true }).check();
  await move(page, await position(page, .4, .4), await position(page, .45, .45));
  const after = await saveProject(page); expect(after.points).toEqual(before.points); expect(after.image.x).toBeCloseTo(.05, 2);
  await page.getByTestId('project-input').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(before)) });
  const restored = await saveProject(page); expect(restored).toEqual(before);
  await page.getByRole('button', { name: 'Preview', exact: true }).click(); await page.getByLabel('Export format').selectOption('png');
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PNG' }).click();
  const file = await promise; expect((await readFile((await file.path())!)).subarray(1, 4).toString()).toBe('PNG');
});

test('two-column imports and a compact mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByTestId('data-input').setInputFiles({ name: 'curve.txt', mimeType: 'text/plain', buffer: Buffer.from('50 119.38\n100 116.42\n500 107.25\n1000 106.95\n5000 114.05\n20000 83.136\n') });
  await expect(page.getByTestId('point-5')).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/graph-editor-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.getByLabel('Point 1 X value', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('Point 6 Y value', { exact: true })).toHaveValue('83.136');
});

test('dense point hit areas select and move the closest anchor', async ({ page }) => {
  await page.goto('/');
  const rows = Array.from({ length: 101 }, (_, i) => `${100 + i} 80`).join('\n');
  await page.getByTestId('data-input').setInputFiles({ name: 'dense.txt', mimeType: 'text/plain', buffer: Buffer.from(rows) });
  await page.getByTestId('point-100').waitFor();
  const before = await saveProject(page), target = before.points[20];
  await move(page, await position(page, target.x, target.y), await position(page, target.x, target.y + .03));
  await expect(page.getByRole('heading', { name: 'Point 21', exact: true })).toBeVisible();
  const after = await saveProject(page);
  expect(after.points[20].y).toBeCloseTo(target.y + .03, 2);
  expect(after.points[21]).toEqual(before.points[21]);
});
