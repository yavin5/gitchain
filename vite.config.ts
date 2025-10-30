import { defineConfig } from 'vite';
import typescript from 'vite-plugin-typescript';
import { dirname, resolve } from 'node:path';
import path from 'path';
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
          console.log('Expected: bundle.js, main.js');
        }
      }
    }
  ],
  build: {
    emptyOutDir: false,
    outDir: 'js',
    minify: false,
    sourcemap: true,
    target: 'es2022',
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
          '@libp2p/websockets': 'webSockets',
          '@libp2p/circuit-relay-v2': 'circuitRelayTransport',
          '@libp2p/bootstrap': 'bootstrap',
          '@libp2p/gossipsub': 'gossipsub',
          '@libp2p/pubsub-peer-discovery': 'pubsubPeerDiscovery',
          '@chainsafe/libp2p-noise': 'noise',
          '@chainsafe/libp2p-yamux': 'yamux',
          '@libp2p/identify': 'identify',
	  '@kasstamp/core': 'kasstamp/core',
          '@kasstamp/sdk': 'kasstamp/sdk',
          '@multiformats/multiaddr': 'multiaddr',
          'uint8arrays': 'uint8arrays',
          'crypto-js': 'CryptoJS',
          'elliptic': 'elliptic',
          'js-sha3': 'sha3'
        }
      },
      external: [
        'vite-plugin-node-polyfills/shims/process',
        'vite-plugin-node-polyfills/shims/global',
        'vite-plugin-node-polyfills/shims/buffer',
      ],     
    }
  },
  define: {
    global: 'globalThis',
    // Explicitly set NODE_ENV based on Vite mode
    'process.env.NODE_ENV': '"development"',
  },
  resolve: {
    alias: {
      'libp2p': 'libp2p',
      '@libp2p/webrtc': '@libp2p/webrtc',
      '@libp2p/websockets': '@libp2p/websockets',
      '@libp2p/circuit-relay-v2': '@libp2p/circuit-relay-v2',
      '@libp2p/bootstrap': '@libp2p/bootstrap',
      '@libp2p/gossipsub': '@libp2p/gossipsub',
      '@libp2p/pubsub-peer-discovery': '@libp2p/pubsub-peer-discovery',
      '@chainsafe/libp2p-noise': '@chainsafe/libp2p-noise',
      '@chainsafe/libp2p-yamux': '@chainsafe/libp2p-yamux',
      '@libp2p/identify': '@libp2p/identify',
      '@kasstamp/core': '@kasstamp/core',
      '@kasstamp/sdk': '@kasstamp/sdk',
      '@multiformats/multiaddr': '@multiformats/multiaddr',
      'uint8arrays': 'uint8arrays',
      'crypto-js': 'crypto-js',
      'elliptic': 'elliptic',
      'js-sha3': 'js-sha3',
      stream: 'readable-stream',
      buffer: 'buffer',
    }
  },
  optimizeDeps: {
    include: [
      'libp2p',
      '@libp2p/webrtc',
      '@libp2p/websockets',
      '@libp2p/circuit-relay-v2',
      '@libp2p/bootstrap',
      '@libp2p/gossipsub',
      '@libp2p/pubsub-peer-discovery',
      '@chainsafe/libp2p-noise',
      '@chainsafe/libp2p-yamux',
      '@libp2p/identify',
      '@kasstamp/core',
      '@kasstamp/sdk',
      '@multiformats/multiaddr',
      'uint8arrays',
      'crypto-js',
      'elliptic',
      'js-sha3',
      'buffer',
      'events'
    ],
    // exclude: ['@kasstamp/kaspa-wasm-sdk']
  },
  // Add static asset handling for WASM files - CRITICAL for WebAssembly
  assetsInclude: ['**/*.wasm'],
  // Additional server configuration for WASM handling
  server: {
    host: true,
    port: 443,
    fs: {
      allow: ['..'],
    },
  },
  // Worker support for WASM
  worker: {
    format: 'es',
  },
});
