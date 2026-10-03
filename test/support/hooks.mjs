const SRC = new URL('../../src/', import.meta.url).href;

// './reportMath' -> './reportMath.js', as Metro resolves it.
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?js$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch {
      // Fall through (a directory import or a file that really has no extension).
    }
  }
  return nextResolve(specifier, context);
}

// Every file under src/ is an ES module.
export async function load(url, context, nextLoad) {
  if (url.startsWith(SRC) && url.endsWith('.js')) {
    return nextLoad(url, { ...context, format: 'module' });
  }
  return nextLoad(url, context);
}
