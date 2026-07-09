import { cookies } from "next/headers";
import { CHALLENGES } from "@/lib/challenges.mjs";
import { verifyUserSession, SESSION_COOKIE } from "@/lib/tickets";

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
          {process.env.NODE_ENV !== "production" &&
          process.env.ALLOW_DEV_LOGIN === "true" ? (
            <a className="textlink" href="/api/auth/dev?email=demo@ctf26.test">
              local dev sign-in
            </a>
          ) : null}
        </section>
      </main>
    );
  }

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

      <section className="challenge-grid">
        {CHALLENGES.map((challenge) => (
          <article className="challenge" key={challenge.key} id={`${challenge.key}-local-kit`}>
            <div>
              <p className="kicker">{challenge.label}</p>
              <h2>{challenge.name}</h2>
              <p>{challenge.copy}</p>
            </div>
            <a className="button" href={`/api/launch/${challenge.key}`}>
              enter
            </a>
          </article>
        ))}
      </section>

      <details>
        <summary>local kit notes</summary>
        <pre>{`reward sniper: local market kit
imprint: local authorization kit
signet: local deployment kit
drift: local program-analysis kit

Challenge URLs can be overridden through the deployment environment.`}</pre>
      </details>

      <form action="/api/auth/logout" method="post">
        <button className="plain" type="submit">
          sign out
        </button>
      </form>
    </main>
  );
}
