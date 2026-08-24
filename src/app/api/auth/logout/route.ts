import { NextResponse } from 'next/server';
import { signOut } from '@/lib/auth';
import { audit } from '@/lib/audit';

export async function POST(request: Request) {
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
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
