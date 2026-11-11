import {defineConfig} from 'vite';

// The dashboard lives in src/ (src/index.html). In production the poller (src/nano.js on the Pi) serves the built
// site from dist/ together with /api, see deploy/README.md. For development, `npm start` proxies /api to the Pi
// (override with NANO_API=http://localhost:8787 when running the poller locally).
export default defineConfig({
    root: 'src',
    base: './',
    server: {
        open: true,
        proxy: Object.fromEntries(['/api', '/status'].map((p) => [p, process.env.NANO_API || 'http://nano.local:8787'])),
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        rollupOptions: {input: {main: 'src/index.html', report: 'src/report.html'}},
    },
});
