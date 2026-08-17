/**
 * Password rules, in one place.
 *
 * The minimum lived in three files that each had to be edited together, which
 * is how a rule ends up enforced at one screen and not another — and the one
 * that forgets is the one that lets a weak password through.
 */

/**
 * Shortest password accepted.
 *
 * Eight is what the team asked for. It is on the low side for an account that
 * reaches six companies' financial records, so it is worth knowing what it
 * costs: eight characters is roughly a thousand times quicker to guess than
 * twelve. What holds the line here instead is that passwords are stored as
 * scrypt hashes, which are deliberately slow to compute, and that an expired
 * or disabled account is refused on every request rather than only at sign-in.
 *
 * Raise this and existing passwords keep working — the rule is checked when a
 * password is set, not when it is used.
 */
export const MIN_PASSWORD = 8;

/**
 * No maximum is imposed on purpose. A length cap would reject the twenty-
 * character passwords this system generates itself, and a long passphrase is
 * the one thing a person can remember that is also hard to guess.
 */
export const passwordTooShort = (password: string): boolean =>
  password.length < MIN_PASSWORD;

export const PASSWORD_RULE_TEXT = `At least ${MIN_PASSWORD} characters.`;
