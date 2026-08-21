/**
 * Server startup.
 *
 * Seeding runs here rather than while rendering a page. It used to run inside
 * `/login`, which meant the first HTTP request to reach a fresh deployment
 * decided how the administrator account was created — and that request is as
 * likely to be a health check as a person. A failure also has somewhere to go
 * now: the process refuses to start, instead of a page rendering an error to
 * whoever happened to arrive first.
 */
export async function register() {
  // Only the Node.js runtime has the database; the edge runtime must not try.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { bootstrapDatabase } = await import('@/lib/db/bootstrap');

  try {
    bootstrapDatabase();
  } catch (err) {
    console.error(`[gtg] startup failed: ${(err as Error).message}`);
    // Refusing to serve is the point. A deployment missing its administrator
    // secret should not come up half-configured and wait to be noticed.
    throw err;
  }
}
