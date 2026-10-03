// Lets `node --test` import the app's source files directly. They are ES modules written for
// Metro: `.js` files in a package without "type": "module", imported without file extensions.
// Only the pure modules (maths, formatting) are tested this way; anything that imports React
// Native would fail to load and isn't meant to be tested here.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
