/**
 * Stand-in for the `server-only` package under the test and seed runners.
 *
 * The real package throws on import unless a bundler has swapped it out, which
 * is how Next.js stops server code reaching a client component. Node has no
 * such bundler, so a test that imports a server-only module dies on the import
 * rather than on anything it was written to check.
 *
 * The guarantee is not weakened: `next build` still resolves the real package
 * and still fails the build if a client component imports server code. This
 * only affects processes that are entirely server-side to begin with.
 */
export {};
