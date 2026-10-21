# sudomuhammad.github.io

Personal portfolio of Muhammad Uzair, AI Engineer. Live at https://sudomuhammad.github.io/

Built with [Astro](https://astro.build). The hero is an interactive particle map of my CV, rendered on a canvas.

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

Content lives in `src/data/cv.json`. The map is real: `ml/build_map.py` embeds each CV passage with
MiniLM and lays them out with UMAP, so similar work sits together. Colours are themes I tag each item with in
`cv.json` (defined in `src/data/themes.json`). Its output, `src/data/map.json`, is committed.

```sh
npm run map        # after editing cv.json or themes.json (needs uv)
npm run test:ml    # Python tests and lint
```
Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.
