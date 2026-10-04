# ICEBERG v2

A scrollable 3D web CV. Instead of a static resume page, the whole site is one continuous
camera descent into a glacier, where each section of my background is an ice block you can
open.

v2 rebuilds the world to look real. The first version was a pale fog with floating rocks,
so nothing gave a sense of scale. Now the site opens on an overcast snowfield with a
mountain horizon, and scrolling drops the camera through a crack in the snow into a blue
ice cave underneath.

**Live:** https://ice-nemi.vercel.app (the first version is still up at https://nemiiceberg.vercel.app)

## What it does

Scrolling drives the camera, not the page. As you scroll:

1. The camera leaves the snowfield and drops through a crevasse into an ice cave.
2. Ice blocks render live and react to hover and click, each one opening a section.
3. A particle face assembles out of drifting points.
4. A portal transition moves you into the next act.
5. A chat dock lets visitors ask about my work instead of reading it.

## How it is built

The scene is real 3D, the text is not. That is a deliberate split: everything visual runs
in WebGL through React Three Fiber, while the copy and the interface sit on top as plain
HTML and CSS. Text stays selectable, accessible, and cheap to change, and the GPU only
handles what actually needs it.

Ice uses `MeshTransmissionMaterial` from drei for refraction rather than a faked
transparent shader, so crystals bend what is behind them. All rocks share one refraction
buffer rendered at reduced resolution, instead of every material rendering the scene again.
On top of that, a small shader patch adds melt scallops, frost patches, snow on the top
faces and a faint glow from inside the ice.

The world has no big asset files. The snowfield, the crack, the cave walls and the mountain
ring are generated from noise in JavaScript when the page loads. The detail textures for
snow and ice walls are generated offline by the Python scripts in `art/scripts`, which keeps
them tileable and under 200 KB together. Fog, sky and bloom follow the camera position,
so the switch from open air to cave happens exactly where the camera crosses the snow.

The chat dock has no backend of its own. It posts to `/api/chat`, which is rewritten to a
separate retrieval-augmented service that holds the knowledge base. Vite proxies that route
in development, `vercel.json` rewrites it in production, so the browser only ever talks to
one origin and CORS never enters the picture.

## Stack

| Layer | Tool |
| --- | --- |
| Build | Vite 5 |
| UI | React 18 |
| 3D | React Three Fiber 8, drei, three 0.166 |
| Post FX | @react-three/postprocessing |
| Motion | GSAP |
| Assets | Blender, exported to GLB |
| Hosting | Vercel |

## Structure

```
src/
  Experience.jsx     scene graph and camera rig
  world/             snowfield, crevasse, mountains, sky, fog, ice shaders
  Crystal.jsx        interactive ice blocks
  ParticleFace.jsx   point cloud face
  Portal.jsx         act transition
  UI.jsx             HTML overlay
  scrollState.js     shared scroll progress
  chat/              chat dock
art/scripts/         generators for the snow and ice detail textures
tools/verify/        headless screenshots, look tuning and end-to-end QA
```

## Running locally

```bash
npm install
npm run dev
```

Build with `npm run build`, preview the build with `npm run preview`.

Every visual change is checked headless before it is committed:

```bash
python tools/verify/shots.py mylabel --dist dist
python tools/verify/qa.py --dist dist
```

`shots.py` freezes the scroll at each section and saves a contact sheet. `qa.py` opens every
section panel, the chat, scrolls the loop in both directions and fails if the number of
compiled shader programs changes along the way, which is what causes hitches.

## Notes

Crystal count and post-processing passes are the two things that move the frame rate most.
If you are testing on a weak GPU, reduce those first.

The chat panel and the floating chat button sit on top of a canvas that repaints every
frame. Never give either one `backdrop-filter` or an animated `box-shadow`: both force a
repaint per frame and the scroll goes to pieces. Animate `opacity` on a pseudo element
instead, which the compositor handles for free.

Vendor code is split into two chunks so that editing anything under `src/` only invalidates
the small app chunk. React is separated because it imports nothing else in this tree.
Splitting three, drei and the post-processing passes any further makes Rollup report
circular chunks, since those packages all reach back into each other.
