import * as esbuild from 'esbuild'

const config = {
  entryPoints: ['src/content.ts'],
  bundle: true,
  format: 'iife',
  outfile: 'content.js',
  target: 'es2022',
  minify: false,
  sourcemap: false,
  keepNames: true,
}

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(config)
  await context.watch()
  console.log('Watching browser extension content script...')
} else {
  await esbuild.build(config)
}
