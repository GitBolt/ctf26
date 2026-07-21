const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function organizerEmails(env = process.env) {
  const emails = String(env.CTF_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (emails.some((email) => email.length > 254 || !EMAIL_PATTERN.test(email))) {
    throw new Error("CTF_ADMIN_EMAILS contains an invalid email address");
  }
  return new Set(emails);
}

export function organizerConfiguration(env = process.env) {
  const count = organizerEmails(env).size;
  return Object.freeze({ count, required: 2, ready: count >= 2 });
}

export function assertOrganizerQuorum(env = process.env) {
  const configuration = organizerConfiguration(env);
  if (!configuration.ready) {
    throw new Error("at least two distinct organizer emails are required");
  }
  return configuration;
}

export function isOrganizer(user, env = process.env) {
  if (!user?.email) return false;
  return organizerEmails(env).has(String(user.email).toLowerCase());
}
