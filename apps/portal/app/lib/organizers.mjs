export function organizerEmails(env = process.env) {
  return new Set(String(env.CTF_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

export function isOrganizer(user, env = process.env) {
  if (!user?.email) return false;
  return organizerEmails(env).has(String(user.email).toLowerCase());
}
