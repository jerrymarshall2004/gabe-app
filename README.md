# Patch Scanner

A mobile web app that reads a colour-changing patch through the phone camera and
turns its shade into a number on a calibrated scale, e.g. *"64.1, which is 14.1% above
the threshold"*.

Written in TypeScript with Vite and no runtime dependencies. It runs in any modern phone
browser, and nothing needs installing.

## How it works

1. **Sample.** The app averages every pixel inside the square in the middle of the camera view.
   It averages in linear light, which is physically correct, and it also measures how
   uneven the patch is.
2. **Match.** You define the scale as colour stops, each pairing a colour with a value
   (default: white = 0, pink = 50, red = 100). The stops form a path through
   [CIELAB](https://en.wikipedia.org/wiki/CIELAB_color_space) colour space, which
   roughly matches how people see colour. The sampled colour is projected onto the
   nearest point on that path, and its value is interpolated between the two stops on either side.
3. **Compare.** The value is compared with your threshold and reported as a
   percentage, either of the whole scale ("10% of the way past the threshold") or of the
   threshold value itself.
4. **Sanity checks.** If the colour is far from every point on the scale (ΔE > 15) or the patch
   is uneven, the app shows a warning instead of silently reporting a misleading number.

The core maths is in `src/color.ts` and `src/gradient.ts` and is unit-tested.

## Accuracy tips

Phone cameras adjust white balance and exposure automatically, so the same patch
looks different under different lighting. For reliable numbers:

- **Calibrate under the lighting you'll measure in.** Open *Scale & threshold*, point the
  camera at a printed reference card for each shade, and tap **Use current colour**
  for that stop.
- Use consistent, diffuse light, and avoid glare and shadows on the patch.
- Keep a white reference card in the frame if possible (a possible future feature is automatic
  white-balance correction from a reference area).

## Using it

- **Start camera** opens the rear camera and shows a live reading.
- **Hold reading** freezes the frame and reads the result aloud to screen readers.
- **Upload photo** works on desktop too, and on phones it can open the camera directly.

Settings are saved in the browser (localStorage).

### Accessibility

The app has large touch targets (at least 44 px), keyboard and screen-reader support, and live-region
announcements only when you hold a reading, so the live feed doesn't flood the screen reader.
Above and below are shown with text and ▲/▼ symbols as well as colour. The app supports
dark mode and reduced motion.

## Development

```bash
npm install
npm run dev      # served on your LAN; see note below
npm test
npm run build
```

Browsers only allow camera access on **https** (or `localhost`). To test on a
phone, either deploy it (below) or tunnel the dev server over https
(e.g. `npx cloudflared tunnel --url http://localhost:5173`).

## Deploying

`.github/workflows/deploy.yml` builds, tests and publishes to GitHub Pages on every
push to `main`. To turn it on, go to **Settings → Pages → Source** and choose
**GitHub Actions**. The app will then be at `https://<user>.github.io/gabe-app/`.
