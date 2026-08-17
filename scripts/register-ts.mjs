/** Installs the TypeScript resolution hooks. Use via `node --import`. */
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);
