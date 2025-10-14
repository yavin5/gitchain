import { defineConfig } from 'vite';
import typescript from 'vite-plugin-typescript';

export default defineConfig({
  plugins: [typescript()],
  build: {
    emptyOutDir: false,
    outDir: 'js',
    rollupOptions: {
      input: 'src/blockchain.ts',
      output: {
        entryFileNames: 'bundle.js',
        format: 'es'
      }
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
