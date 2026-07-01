import { cookies } from "next/headers";
import { createChallengeTicket, verifyUserSession, SESSION_COOKIE } from "@/lib/tickets";

function challengeUrl(user) {
  const base = process.env.CHALLENGE_URL || "http://localhost:3000";
  const ticket = createChallengeTicket(user);
  const url = new URL(base);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

async function currentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value || "";
  if (!token) return null;
  try {
    return verifyUserSession(token);
  } catch {
    return null;
  }
}

export default async function Home({ searchParams }) {
  const user = await currentUser();
  const params = await searchParams;
  const error = params?.error || "";

  if (!user) {
    return (
      <main>
        <header>
          <p className="kicker">CTF26 check-in</p>
          <h1>register before entering the room</h1>
        </header>

        {error ? <p className="error">sign-in failed: {error}</p> : null}

        <section className="panel">
          <p>
            Sign in with the same account you will use for scored participation.
            Challenge launches are stamped with a signed participant ticket.
          </p>
          <a className="button" href="/api/auth/google/start">
            Continue with Google
          </a>
          <a className="textlink" href="/api/auth/dev?email=demo@ctf26.test">
            local dev sign-in
          </a>
        </section>
      </main>
    );
  }

  const launchUrl = challengeUrl(user);

  return (
    <main>
      <header>
        <p className="kicker">CTF26 registered</p>
        <h1>challenge board</h1>
      </header>

      <section className="identity">
        <div>
          <span>participant</span>
          <strong>{user.participant_id}</strong>
        </div>
        <div>
          <span>team</span>
          <strong>{user.team_id}</strong>
        </div>
        <div>
          <span>account</span>
          <strong>{user.email}</strong>
        </div>
      </section>

      <section className="challenge">
        <div>
          <p className="kicker">solana devnet</p>
          <h2>settlement-room-73</h2>
          <p>same room. three filings. clerk wants your filing.</p>
        </div>
        <a className="button" href={launchUrl}>
          enter challenge
        </a>
      </section>

      <details>
        <summary>launch ticket preview</summary>
        <pre>{launchUrl}</pre>
      </details>

      <form action="/api/auth/logout" method="post">
        <button className="plain" type="submit">
          sign out
        </button>
      </form>
    </main>
  );
}

