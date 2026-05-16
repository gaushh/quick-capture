# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React renderer. Most product logic lives in `src/capture/` (`QuickCapture.tsx`, capture formatting, history, and suggestion helpers). `electron/` holds the Electron main process, preload bridge, and shared IPC types. Static assets live in `public/` and `src/assets/`. Treat `dist/`, `dist-electron/`, and `release/` as generated output; do not edit them by hand.

## Build, Test, and Development Commands
Use `npm run dev` for day-to-day development; Vite and `vite-plugin-electron` start the renderer and Electron shell together. Use `npm run build` to type-check and build the renderer. Use `npm run electron:build` for an unpacked desktop build and `npm run electron:dist:mac` / `:win` / `:linux` for platform packages. Run `npm run lint` before opening a PR. `npm run start` can be used to launch Electron against existing build output for a quick smoke check.

## Coding Style & Naming Conventions
This codebase is TypeScript-first and uses React function components. Follow the existing style: 2-space indentation, single quotes, and no semicolons unless required. Use `PascalCase` for components (`QuickCapture.tsx`, `PillChrome.tsx`) and `camelCase` for utilities (`captureHistory.ts`, `suggestApply.ts`). Keep Electron-specific code in `electron/` and UI/state logic in `src/`. ESLint is configured in `eslint.config.js`; fix warnings instead of suppressing them.

## Testing Guidelines
There is no dedicated Jest/Vitest suite in this checkout yet. At minimum, run `npm run lint`, `npm run build`, and a manual `npm run dev` smoke test before submitting changes. Validate the tray flow, `Control+Space` shortcut, recording lifecycle, and any OpenAI-backed paths you touch. If you add automated tests later, place them next to the feature or under a small `tests/` folder and name them `*.test.ts` or `*.test.tsx`.

## Security & Configuration Tips
Copy `.env.example` to `.env` and keep real keys out of version control. `OPENAI_API_KEY` is required for transcription and edit-suggestion flows. Do not commit secrets, local recordings, or machine-specific packaging artifacts.

## Commit & Pull Request Guidelines
Git history is not available in this workspace snapshot, so use short imperative commit subjects such as `Fix preload env loading`. PRs should describe user-visible behavior, list verification steps, and include screenshots or short recordings for UI changes.
