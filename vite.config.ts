import { defineConfig } from 'vite';
import typescript from 'vite-plugin-typescript';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  resolve: {
    alias: {
      'libp2p': 'libp2p',
      '@libp2p/webrtc': '@libp2p/webrtc',
      '@libp2p/circuit-relay-v2': '@libp2p/circuit-relay-v2',
      '@libp2p/bootstrap': '@libp2p/bootstrap',
      '@libp2p/gossipsub': '@libp2p/gossipsub',
      '@libp2p/pubsub-peer-discovery': '@libp2p/pubsub-peer-discovery',
      '@chainsafe/libp2p-noise': '@chainsafe/libp2p-noise',
      '@chainsafe/libp2p-yamux': '@chainsafe/libp2p-yamux',
      '@libp2p/identify': '@libp2p/identify',
      '@multiformats/multiaddr': '@multiformats/multiaddr',
      'uint8arrays': 'uint8arrays'
    }
  },
  build: {
    emptyOutDir: false,
    outDir: 'js',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        bundle: resolve(__dirname, 'src/chain.ts'),
        main: resolve(__dirname, 'src/main.js')
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
        preserveModules: false,
        exports: 'named',
        globals: {
          'libp2p': 'libp2p',
          '@libp2p/webrtc': 'webRTC',
          '@libp2p/circuit-relay-v2': 'circuitRelayTransport',
          '@libp2p/bootstrap': 'bootstrap',
          '@libp2p/gossipsub': 'gossipsub',
          '@libp2p/pubsub-peer-discovery': 'pubsub-peer-discovery',
          '@chainsafe/libp2p-noise': 'noise',
          '@chainsafe/libp2p-yamux': 'yamux',
          '@libp2p/identify': 'identify',
          '@multiformats/multiaddr': 'multiaddr',
          'uint8arrays': 'uint8arrays'
        }
      }
    }
  },
  optimizeDeps: {
    include: [
      'libp2p',
      '@libp2p/webrtc',
      '@libp2p/circuit-relay-v2',
      '@libp2p/bootstrap',
      '@libp2p/gossipsub',
      '@libp2p/pubsub-peer-discovery',
      '@chainsafe/libp2p-noise',
      '@chainsafe/libp2p-yamux',
      '@libp2p/identify',
      '@multiformats/multiaddr',
      'uint8arrays'
    ]
  }
});
