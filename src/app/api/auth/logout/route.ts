import { NextResponse } from 'next/server';
import { signOut } from '@/lib/auth';

export async function POST(request: Request) {
  await signOut();
  // 303 so the browser follows with a GET rather than re-posting.
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
