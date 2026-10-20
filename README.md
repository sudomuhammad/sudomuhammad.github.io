# sudomuhammad.github.io

Personal portfolio of Muhammad Uzair, AI Engineer. Live at https://sudomuhammad.github.io/

Built with [Astro](https://astro.build). The hero is an interactive particle map of my CV, rendered on a canvas.

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

Content lives in `src/data/cv.json`. The map is real: `ml/build_map.py` embeds each CV passage with
MiniLM, lays them out with UMAP and clusters them with HDBSCAN. Its output, `src/data/map.json`, is committed.

```sh
npm run map        # after editing cv.json or clusters.json (needs uv)
npm run test:ml    # Python tests and lint
```
Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.
