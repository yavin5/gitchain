import { defineConfig } from 'vite';
import typescript from 'vite-plugin-typescript';

export default defineConfig({
  plugins: [
    typescript(),
    {
      name: 'debug-bundling',
      buildEnd(err) {
        if (err) {
          console.error('Build error:', err);
        } else {
          console.log('Build completed. Output files in js/:');
          console.log('Expected: bundle.js, main.js, init.js');
        }
      }
    }
  ],
  build: {
    emptyOutDir: false,
    outDir: 'js',
    rollupOptions: {
      input: 'src/blockchain.ts',
      output: {
        entryFileNames: 'bundle.js',
        format: 'es',
        preserveModules: false,
        exports: 'named' // Ensure named exports are preserved
      },
      external: [
        'libp2p',
        '@libp2p/webrtc',
        '@libp2p/circuit-relay-v2',
        '@libp2p/bootstrap',
        '@chainsafe/libp2p-noise',
        '@chainsafe/libp2p-yamux',
        '@libp2p/identify',
        '@multiformats/multiaddr',
        'uint8arrays'
      ]
    }
  },
  optimizeDeps: {
    include: [
      'libp2p',
      '@libp2p/webrtc',
      '@libp2p/circuit-relay-v2',
      '@libp2p/bootstrap',
      '@chainsafe/libp2p-noise',
      '@chainsafe/libp2p-yamux',
      '@libp2p/identify',
      '@multiformats/multiaddr',
      'uint8arrays'
    ]
  }
});
