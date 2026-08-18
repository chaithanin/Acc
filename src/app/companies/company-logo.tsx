'use client';

import { useState } from 'react';

/**
 * A company's mark, with its initials as the fallback.
 *
 * The fallback is not decoration. Logo files are dropped into the repository
 * separately from the rule that names them, so a company can legitimately
 * point at a file that is not there yet — and a broken image icon on the
 * screen everyone sees first is a worse answer than the company's own
 * initials.
 *
 * `contain`, not `cover`: these marks are wide, and cropping one to fill a
 * square cuts the name out of it.
 */
export function CompanyLogo({
  logo,
  code,
  name,
}: {
  logo: string | null;
  code: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!logo || failed) {
    return (
      <div className="grid h-14 w-24 place-items-center rounded-md bg-surface-sunken text-base font-semibold tracking-wide text-ink-secondary">
        {code.slice(0, 3)}
      </div>
    );
  }

  return (
    <div className="grid h-14 w-24 place-items-center overflow-hidden rounded-md bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logo}
        alt={name}
        className="max-h-12 max-w-[5.5rem] object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
