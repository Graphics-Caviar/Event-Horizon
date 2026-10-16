import { defineConfig } from 'vite'

// The department LAMP server publishes the game under a subdirectory
// (https://<server>/<group-folder>/), so every URL the build emits
// must be relative. A leading '/' resolves to the server root and
// 404s once hosted — the most common cause of a blank screen after
// deployment. Runtime asset paths (GLB model URLs etc.) are likewise
// relative literals in the source, e.g. 'assets/models/...'.
export default defineConfig({
	base: './',
})
