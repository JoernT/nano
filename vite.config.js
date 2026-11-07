import {defineConfig} from 'vite';

// The dashboard lives in src/ (src/index.html). It reads data from the poller (src/nano.js)
// at http://localhost:8787/api/status, so run both: `npm run startnano` and `npm start`.
export default defineConfig({
    root: 'src',
    server: {open: true},
    build: {outDir: '../dist', emptyOutDir: true},
});
