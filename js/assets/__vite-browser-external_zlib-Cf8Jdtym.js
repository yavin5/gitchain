const __viteBrowserExternal_zlib = new Proxy({}, {
  get(_, key) {
    throw new Error(`Module "zlib" has been externalized for browser compatibility. Cannot access "zlib.${key}" in client code.  See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.`);
  }
});
export {
  __viteBrowserExternal_zlib as default
};
//# sourceMappingURL=__vite-browser-external_zlib-Cf8Jdtym.js.map
