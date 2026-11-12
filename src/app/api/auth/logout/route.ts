import { signOut } from '@/lib/auth';
import { audit } from '@/lib/audit';

export async function POST() {
  // Recorded before the session is closed, while there is still someone to
  // name. A sign-out that leaves no trace makes the sign-in record useless for
  // working out who was in the system and when.
  await audit({
    action: 'session.sign_out',
    entity: 'session',
    summary: 'Signed out',
  });

  await signOut();

  // 303 so the browser follows with a GET rather than re-posting.
  //
  // A relative Location, on purpose. This used to be
  // NextResponse.redirect(new URL('/login', request.url)), and request.url is
  // built from the address the server bound to, not the one the visitor used.
  // In the container that is 0.0.0.0:8080, behind the proxy, so signing out
  // ended the session and then sent the browser to https://0.0.0.0:8080/login,
  // a page that can never load. The browser resolves a relative Location
  // against whatever host it is actually talking to, which is correct behind
  // any proxy without the app having to know its own public name.
  return new Response(null, { status: 303, headers: { Location: '/login' } });
}
