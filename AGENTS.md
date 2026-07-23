# Project operating notes

## AutoData Studio frontend on port 5173

- Port 5173 is accessed through a path-prefixed reverse proxy (for example,
  `.../proxy/5173/`). Frontend assets and browser-side API URLs must therefore
  remain relative to the current page directory; do not change them to root
  paths such as `/assets`, `/src`, `/api`, or `/llm`.
- Do not expose the Vite development server on 5173 for user-facing access.
  Dev mode injects absolute URLs such as `/@vite/client` and `/src/main.tsx`,
  which produce a blank page behind the path-prefixed proxy even though direct
  localhost access works.
- Build first, then serve the production preview on 5173:

  ```bash
  cd autodata_studio/frontend
  npm run build
  ./node_modules/.bin/vite preview --host 0.0.0.0 --port 5173
  ```

- Keep `base: "./"` in `vite.config.ts`. Browser API construction must continue
  resolving from `new URL(".", window.location.href)` as implemented in
  `src/lib/api.ts`.
- Run the preview in a persistent session (currently tmux session
  `autodata-frontend`) so the process is not reclaimed when a tool shell exits.
- After frontend changes, rebuild `dist`, restart preview, and verify both the
  page and `/api/runs/run_mcq_live_merged/examples` through port 5173.
