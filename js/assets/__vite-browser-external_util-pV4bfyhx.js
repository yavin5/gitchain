new Proxy({}, {
  get(_, key) {
    throw new Error(`Module "util" has been externalized for browser compatibility. Cannot access "util.${key}" in client code.  See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.`);
  }
});
//# sourceMappingURL=__vite-browser-external_util-pV4bfyhx.js.map
