<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/spoolmap-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="public/spoolmap-logo.svg">
    <img src="public/spoolmap-logo.svg" alt="Spoolmap" width="420">
  </picture>
</p>

Spoolmap helps you choose filament from your full spool collection before loading the AMS.

[Open Spoolmap](https://spoolmap.com)

![Four filament spools mapped by color to a multicolor printed owl.](https://spoolmap.com/spoolmap-social.png)

Import a Bambu Studio or OrcaSlicer 3MF and a spool list: a [3DFilamentProfiles](https://3dfilamentprofiles.com/my/spools) JSON export, or any JSON array of spools with a color in `rgb` or `hex`. Brand, material, and color name are optional. Spoolmap ranks the closest owned colors, lets you choose substitutions plate by plate, and produces a remapped 3MF for Bambu Studio or OrcaSlicer.

Use **Try a sample project** on the home page if you just want to see the matching UI.

Studio still handles the final printer and AMS-slot assignment. Spoolmap answers the earlier question: which spools should you pull from the shelf?

## What it does

- Reads logical colors, materials, profiles, plates, and painted mesh assignments from Bambu and Orca 3MF files.
- Ranks owned spools with CIEDE2000 color distance plus material, support-filament, and multi-color checks.
- Shows the original and selected colors side by side in a linked 3D viewer.
- Remembers your inventory and recent projects on this device.
- Separates whole-project colors from the colors needed on each plate.
- Downloads the remapped project for final AMS-slot confirmation in Bambu Studio.

Spoolmap changes filament color metadata. It does not change geometry, paint regions, slicing settings, creator profiles, or AMS slot assignments. Check the final profiles and physical spool positions in Bambu Studio before printing.

## Privacy

Parsing, matching, previews, inventory data, and exports stay in the browser. Spoolmap saves your inventory and recent projects in local browser storage so they are ready next time; use the clear controls to remove them. The hosted app does not upload projects or spool inventory.

## Run locally

Node.js 22 LTS is recommended.

```bash
npm ci
npm run dev          # http://127.0.0.1:5173
npm test
npm run test:e2e
npm run typecheck
npm run build
```

## Hosting

Cloudflare serves the built app as static assets on spoolmap.com only. The `*.workers.dev` preview hostname is disabled so testers are not sent to a copy where feedback is rejected. Deployment does not require storage or a database. Feedback delivery uses a verified Cloudflare Email Routing destination kept out of the repository; configure it as a Worker secret before deploying:

```bash
npx wrangler secret put FEEDBACK_RECIPIENT
```

```bash
npm run deploy
```

## Future: hosted Open in Bambu Studio

Bambu Studio's URL handler requires an HTTP or HTTPS file; it cannot open browser `blob:`, `data:`, or `file:` URLs. Spoolmap therefore uses the same explicit download everywhere today.

A future direct-open implementation would need to construct the platform-specific protocol payload (`bambustudioopen://` on macOS, `bambustudio://open?file=` on Windows and Linux) around a percent-encoded HTTP URL. Studio's downloader uses IPv4, so a local implementation must advertise `127.0.0.1` rather than relying on `localhost` resolving consistently.

If direct hosted opening becomes worth the extra infrastructure, the proven shape is:

- Upload only the remapped output, never the source project or spool inventory.
- Keep objects private and return a random, single-use URL that expires after five minutes.
- Validate same-origin requests, declared and actual size, ZIP structure, and required 3MF entries before issuing the URL.
- Rate limit before allocating storage, consume the token atomically on the first download, and delete the object after use or expiry.
- Add a storage lifecycle rule and billing alerts as cleanup and cost backstops.
- Retain the normal download path whenever upload, launch, or retrieval fails.

A direct-open implementation should be demand-driven and must not make cloud upload a prerequisite for exporting. Download must remain the stable baseline and fallback.

## Project map

```text
src/              browser app, matching, parsing, export, storage, and viewer
tests/e2e/        browser workflow, responsive, and accessibility tests
```

Community 3MF files are untrusted input. The parser bounds archive expansion, metadata, images, and geometry before display. Compatibility reports and small fixes are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

Spoolmap is unofficial and is not affiliated with, endorsed by, or associated with Bambu Lab, OrcaSlicer, or 3DFilamentProfiles. Their names and marks belong to their respective owners.
