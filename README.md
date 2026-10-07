# Graph editor

A browser-only image-to-data editor. Open a graph image, calibrate its axes, trace a curve, and export numeric values. The editor is general-purpose; frequency response graphs are the default configuration, not a restriction.

Images and calculations stay in the browser. There is no upload API, account, analytics, remote font, or processing server. The host serves static application files only.

## Development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
```

Run the browser interaction tests with either an existing Chromium installation or Playwright's browser:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
# Or, on your own development machine:
npx playwright install chromium
npm run test:browser
```

The cloud task already has its own isolated checkout. Work in the existing repository; create another Git worktree only if the user requests one.

## Workflow

1. **Open image.** PNG, JPEG, WebP, AVIF, GIF, and BMP are decoded by the browser. Animated images are flattened to a still frame. Drag-and-drop also accepts images, two-column data, or a saved project.
2. **Edit axes.** Set the first and last known values. Drag the reference lines to the matching image positions. Add references for custom or nonuniform scales. Each reference accepts any numeric value; logarithmic scales require positive values. References must stay in order.
3. **Trace.** Click to add points, or use the Pen tool and drag to create Bézier handles. Existing points and handles can be dragged. Alt allows independent handles; double-click a point to reset its handles. “Insert between” inserts within the existing X range, choosing the closest segment; outside that range, points append.
4. **Auto trace (optional).** Sketch the intended curve from left to right. Adjust the search width and point spacing. Pick a line color when several lines or grid lines overlap. Preview the proposed result before applying it. Adaptive sampling reduces points on straight sections and keeps detail around bends; switch it off for constant horizontal spacing.
5. **Preview.** Edit the points on the graph with the source image visible or hidden. The white overlay controls source visibility. Image alignment supports dragging, translation, scale, and rotation without moving the traced points.
6. **Data.** Edit numeric point values directly. Export anchor points or samples of the drawn curve. TXT has two whitespace-separated numeric columns, matching common graph data files; CSV adds headers. PNG and SVG export the visible graph and optionally its source image.
7. **Save project.** Download a JSON file containing the source image, points, handles, and calibration. Open it to continue later. Work is not automatically retained after a page reload.

The default X axis is logarithmic frequency in Hz. The default Y axis is linear level in dB: decibels are already a logarithmic unit. Labels, units, ranges, direction, and scales are editable for other graphs.

Moving calibration references changes numeric values while keeping the drawn points fixed. Interpolation is piecewise linear in each axis's selected coordinate space (linear values or logarithms). This handles images that expand one part of an axis more than another. “Subtract from Y values” applies a constant offset to numeric values, grid labels, and exports without shifting the trace.

## Controls

| Action | Control |
| --- | --- |
| Draw points | D |
| Pen | P |
| Move/select | V |
| Pan | H, or hold Space and drag |
| Zoom at cursor | Mouse wheel |
| Fit image | Click the zoom percentage |
| Magnifier | Always on, hold Ctrl / Command, or off |
| Undo / redo | Ctrl / Command + Z; Shift + Z to redo |
| Delete selected point | Delete / Backspace |
| Deselect / cancel trace | Escape |

## Static hosting

### GitHub Pages

The `Deploy to GitHub Pages` workflow builds and publishes the site on pushes to `main`. In the repository's **Settings → Pages**, select **GitHub Actions** as the source. If Pages is enabled after the first push, run **Actions → Deploy to GitHub Pages → Run workflow** once. Subsequent pushes publish automatically.

The expected address for this repository is `https://ryln-x.github.io/Picture-to-Parametric-Converter/`. A workflow file alone does not enable Pages; the repository setting must also be enabled.

### Other static hosts

```sh
npm ci
npm run build
```

Deploy the **contents of `dist/`** to any static host, such as Cloudflare Pages, Netlify, Vercel, GitHub Pages, or an existing website. The build command is `npm run build`; the output directory is `dist`. Relative asset paths support hosting under a subdirectory. Use an HTTP or HTTPS server rather than opening `index.html` with `file://`; the tracing worker needs the normal browser origin rules. No runtime secrets or backend services are required.

To check the production build locally:

```sh
npm run preview
```

## Validation and limits

The tests exercise nonuniform calibration, axis inversion, offsets, curve insertion and sampling, data parsing, project validation, and guided tracing over grid lines. Browser tests cover actual uploads, drawing, dragging, undo, calibration, automatic tracing, magnification, zoom, project restoration, exports, and a mobile layout.

Auto trace is a local image-processing aid, not a guarantee of exact digitization. It follows the guide within a search corridor, so closely overlapping curves, a noisy image, or identical-color grid lines can require manual correction. It supports left-to-right curves; manual tracing and Bézier editing support general paths. Image inputs are limited to 40 MB, 50 megapixels, and a 1:10 to 10:1 aspect ratio. Projects and data imports have size limits to keep the browser responsive. Dense curve exports sample distance along the traced image path, not uniformly spaced Hz values.
