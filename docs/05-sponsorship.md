# Sponsorship — Outreach, Status, and Message Archive

Updated: 2026-07-08

Running record of the sponsorship campaign for the next Superteam Solana security CTF. The design
direction sponsors are being pitched on lives in `04-flagship-design.md`.

---

## OtterSec "Save CTFs Fund" — the anchor opportunity

### Status: **warmest active lead.** Replied to us; we sent a fund-aligned message (below). Next step: one-pager to `ctfs@osec.io`.

**The fund (post: 2026-07-07, Michael Debono, https://osec.io/blog/save-ctfs-fund/):**
- OtterSec committed **$100,000** to keep CTFs competitive in the age of AI.
- Thesis: **AI one-shots most Jeopardy challenges; a Jeopardy leaderboard measures token budget, not
  skill.** (1st-to-10th score gap: 59% in 2011 → 27% in 2026; GPT-5.5 above the average CTF player.)
- The fix is **not** "ban AI" and **not** naive AD — it's **more granular / relative scoring** where
  the leaderboard still means something with AI in the room.
- They're **selective about sponsoring Jeopardy CTFs in 2026** and are funding format experiments;
  rCTF v2 will ship granular-scoring features.
- **Design philosophy:** reward **what players do with a vulnerability to maximize impact**, not
  single-vuln discovery — "the winning move is an edge other players (and their LLMs) don't notice."
- **Their example:** `minions-in-16k` — an FPS where teams reverse the client+protocol and write
  cheats/bots to beat each other. Clever, but a *general* CTF idea; being Solana-specific is our job.
- **Scoring pitfalls they named (avoid these):** cumulative scoring punishes latecomers; AD needs big
  teams / invites metagaming + "Superman defenses" + AI-accelerated auto-exploit; golfing/hillclimbing
  is LLM-friendly; steep curves (Kalmar/Lake) are a stopgap.
- **How to apply:** one-pager to **ctfs@osec.io** with event name, details, format, how you deal with
  AI, timeline, why you're qualified, budget, expected per-sponsor amount, existing sponsors. They also
  want collaborators for an on-site "potluck CTF" of dynamically scored challenges.

**Why we fit:** our design already converged on relative scoring + un-batchable interaction (`03`,
`04`). Gap to close: old designs ended in a binary flag; the flagship (Vault Siege) makes scoring
relative. **Pitch angle:** "you built an FPS to get relative scoring; on Solana the economic layer is
the native relative-scoring substrate, and winning it is real exploitation."

**One-pager is blocked on:** event **date** + **budget split** (total, infra vs prizes). Lead with
Vault Siege; offer to open-source the format + join their potluck/on-site CTF.

---

## Outreach tracker

Statuses as of 2026-07-08. "Sent" = delivered; awaiting reply unless noted.

| Target | Category | Channel | Status | Angle |
|---|---|---|---|---|
| **OtterSec** | Audit firm | ctfs@osec.io / contact@osec.io / @osec_io | **Replied; fund msg sent** — best lead | Save CTFs Fund; relative-scored Solana format |
| **Umbra** | Privacy SDK | Kru (co-founder), TG | Sent | Deep SDK/doc walkthrough; docs feedback |
| **Arcium** | MPC/privacy | — | Contacted (earlier) | Confidential-compute challenge |
| **Meteora** | DeFi (DLMM/DAMM/DBC) | Malcolm (warm via Praxis), TG | Active chat | `Reward Sniper`: live DLMM-style LP/reward extraction game on devnet |
| **Neodyme** | Audit firm | Jasper Slusallek @JasperCPS | Sent | Hiring funnel + brand; ex-CTF team, most aligned |
| **Squads** | Multisig | Stepan Simkin @SquadsProtocol / squads.com/contact-us | Sent (TG) | Smart accounts + Grid docs; "we back security" |
| **Sec3** | Audit firm | sec3.dev/contact / @sec3dev | Planned | Audit-firm hiring; their tooling |
| **Zellic** | Audit firm | site form / @zellic_io (verify) | Planned | Audit-firm hiring |
| **Ackee Blockchain** | Audit/education | ackee.xyz / X | Next | Runs School of Solana; education-native fit |
| **Immunefi** | Bug-bounty platform | immunefi.com / X | Next | Audience = exploit hunters; talent pipeline |
| **Cantina (Spearbit)** | Audit-contest platform | cantina.xyz | Bench | Recruits researchers |
| **Pyth** | Oracle | Mike Cahill @mdomcahill | Bench | Oracle-manipulation hook |
| **Switchboard** | Oracle + VRF | @switchboardxyz | Bench | VRF/randomness bug class |
| **Metaplex** | NFT tooling | Stephen Hess @meta_hess | Drafted, deprioritized | Core/cNFT init + plugin bugs |
| **Light Protocol** | ZK compression | @LightProtocol | Bench | ZK-compression accounts |
| **Helius** | RPC/dev infra | Mert @0xMert_ | Skipped ("doesn't reply") | Dev mindshare |
| **Drift / Kamino** | DeFi | @DriftProtocol / @KaminoFinance | Deprioritized | DeFi security hooks |
| **Solana Foundation / Colosseum** | Ecosystem grant | via Superteam internal | To pursue | Security-education mandate; likely biggest check |

**Key contacts:**
- OtterSec — **contact@osec.io**, **ctfs@osec.io** (fund), @osec_io; founder Robert Chen.
- Neodyme — **contact@neodyme.io**, @Neodyme; Jasper Slusallek @JasperCPS, lead Thomas Lambertz.
- Sec3 — @sec3dev, form at sec3.dev/contact.
- Squads — @SquadsProtocol, squads.com/contact-us; CEO **Stepan** Simkin.
- Pyth — @mdomcahill. Metaplex — @meta_hess. Drift — @cindyleowtt.
- **Verify before sending:** Zellic (@zellic_io), Jupiter (@weremeow), Switchboard founder.

**Sequencing:** audit firms + security-talent platforms (OtterSec, Neodyme, Sec3, Zellic, Ackee,
Immunefi) convert best — we sell *recruiting access*, not a favor. Then protocols for prize variety.
Pursue the Foundation/Superteam internal grant in parallel (largest, lowest-friction).

---

## Sent-message archive

### OtterSec — Save CTFs Fund reply (sent)
> i read the save ctfs fund post, and i agree. when we ran our ctf last year, we had concerns about AI
> usage. however, it was not a big issue since the capabilities were still limited. right now, our
> concern is not just better models, it is agentic ai usage. regardless of tweaking the difficulty or
> format of a challenge, agents can simply download anything from the web, write scripts to assist
> themselves, work with multi-media formats, crawl websites, read guides to solve a problem in
> real-time, and so on.
>
> the ctf we hosted last time, and the one we are going to host soon, both are a bit different from
> usual ctfs. our audience is not necessarily the most elite hackers, rather anyone who's interested in
> this solana ecosystem and wants get into security or just learn in general. the format is more like an
> event, with a break, food, merch etc. we show leaderboard in real time as well on a big screen to add
> to the competitive feel.
>
> the article also mentions relative scoring, and i really liked it because right after conducting our
> first ctf last year, one of the things that we had discussed was to move away from fixed points. for
> this ctf, we are implementing dynamic scoring, where we don't assign fixed difficulty score or points
> to any challenge, especially as it becomes increasingly difficult to classify "difficulty" with ai
> assistance. performance of other participants will determine value of one's points.
>
> apart from ensuring the challenges aren't purely jeopardy style, we also have some measures to make it
> "hard" for agentic ai to find solutions. we are not going to ban AI, but we will discourage agent use.
> which means if someone wants to ask chatgpt about something, they're allowed to. but we're going to
> state that letting agentic ai do the job -- that is prompting claude code or codex to just solve the
> problem and give them all permissions to do so -- is not allowed. after all, that completely defeats
> the point of learning. we obviously cannot enforce the ban, hence we are doing everything we can to
> make it "hard" for agents.
>
> currently we are supported by superteam, but we were looking for more sponsors. if this sounds like
> something osec would be interested in sponsoring, it will be awesome :)

### OtterSec — cold email (sent)
> Subject: OtterSec x Superteam — Solana security CTF
>
> Hi team,
> I'm a 2x Solana/Colosseum global hackathon winner and an early Superteam member since 2021. Last year,
> we ran the first-ever Solana security CTF. We had 50+ builders at Microsoft's office, and people loved
> it. We're building the next edition now. Details here: ctf.superteam.fun
>
> This time, we're putting together a serious set of challenges, not surface-level material. To solve
> them, participants have to actually think like auditors and dig into how these programs break. The
> room will be 50+ security-minded Solana developers, each hand-picked by us.
>
> We'd love to partner with you; OtterSec's name in that room speaks for itself. It could be sponsoring a
> bounty for a challenge, one of your researchers co-designing or judging one, or a small cash
> sponsorship. Let me know how that sounds :)
>
> Best,
> Aabis — aabis.dev

### Neodyme — to Jasper (sent)
> hi jasper! i'm an early superteam member since 2021. last year we ran first ever solana security CTF.
> we had 50+ builders at microsoft's office and people loved it. we're building the next edition now.
> details here: t.co/SngTRT51Jc
>
> we're putting together a serious set of challenges this time, not surface level stuff. to solve them,
> participants have to actually think like auditors and dig into how these programs break. the room is
> 50+ security-minded solana devs, each of them hand-picked by us.
>
> we'd love to do this with you guys, you know this space better than almost anyone. could be sponsoring
> a bounty for a challenge, one of your researchers co-designing or judging one, or a small cash
> sponsorship. lmk how that sounds :)

### Squads — to Stepan (sent, TG)
> hey stepan! i'm a 2x solana/colosseum global hackathon winner and early superteam member since 2021.
> last year we ran first ever solana security CTF, 50+ builders at microsoft's office and people loved
> it. building the next edition now, details here: ctf.superteam.fun
>
> this time we want to build a whole challenge around squads. to solve it participants have to actually
> go deep into smart accounts and navigate grid docs and more. so you'd get 50+ hand-picked security
> devs playing with squads api to solve a problem.
>
> would love to do this with you. could be a small bounty for the squads challenge, a co-tweet, or a
> small cash sponsorship. lmk how that sounds :)

### Umbra — to Kru (sent)
> hi kru! i'm bolt from superteam india. last year we ran first ever solana security CTF. we had 50+
> builders at microsoft's blr office and people loved it. we're building the next edition now.
>
> we are building a whole challenge around umbra. to solve it, every participant has to actually go
> through the docs and get local sdk setup. would require actual depth, not just surface level
> exploration of umbra. so you guys would get 50+ security-minded solana devs (each of them hand-picked
> by us) learning about umbra properly + honest feedback on the sdk and docs.
>
> we'd love to do this with you rather than just point at your docs. could be a small bounty for the
> umbra challenge, a co-tweet, or sponsoring a small cash prize. lmk how that sounds :)
>
> Context: a friend informally relayed a "not sponsoring right now" from Kru; this pitch is fresh and
> value-first, and does not reference that.

### Meteora — to Malcolm (drafted, warm via Praxis)
> hi malcolm! i'm bolt from superteam india — we've crossed paths before through praxis, so not a total
> cold msg :) last year we ran the first ever solana security CTF. we had 50+ builders at microsoft's blr
> office and people loved it. we're building the next edition now.
>
> we are building a whole challenge around meteora. to solve it, every participant has to actually go
> deep into how meteora works — DLMM bins, dynamic fees, the rounding/fee logic that's a real security
> surface in defi (safe + educational, not a live exploit). would require actual depth. so you guys would
> get 50+ security-minded solana devs (each hand-picked by us) studying meteora's design properly + a
> strong "we back protocol security" signal for your LPs.
>
> we'd love to do this with you rather than just build around your docs. could be a sponsored bounty for
> the meteora challenge, a co-tweet, or a small cash prize. lmk how that sounds :)

### Meteora — clarified challenge idea (draft for active chat)
> oh it won't be a problem people solve within meteora. it will be more of a CTF challenge where teams
> compete as searchers/liquidators in a DLMM-style market on devnet.
>
> for eg: we build a small DLMM-style program with local mints. teams can place liquidity across bins,
> swaps move the active bin, and a reward vault streams incentives to LPs whose liquidity is active.
> rewards should only accrue to liquidity that was active for the relevant time window, but the
> challenge program would have a subtle accounting bug around checkpoint updates when liquidity is
> added/removed around active-bin movement.
>
> so teams have to understand LP/reward mechanics, then write a script to exploit the issue in our
> devnet program in order to solve the challenge. thought it could be a good fit for meteora since the
> challenge is actually centered around DLMM-style mechanics instead of just being a generic solana bug
> with meteora branding.

**Internal notes for this pitch:**
- The concrete design name is `Reward Sniper`; full mechanics live in `04-flagship-design.md`.
- Do not describe this as hacking Meteora or solving a Meteora support problem.
- Do not overstate AI resistance. Static source + one bug is agent-solvable, so the live solve should
  not be source-first. The defensible version is: teams infer the issue through UI/simulator
  exploration, then script and compete.
- Anti-agent mechanics to keep in the spec: market-console gateway with short-lived execution vouchers,
  asymmetric telemetry cards, simple commit–reveal ticks, and 3 high-value Sniper Tickets per team.
  Avoid adding social negotiation as a dependency.
- Use devnet or a private local validator with local mints; no mainnet, no real Meteora liquidity.
- Value to Meteora: participants reason through DLMM-style active liquidity, bin movement, reward
  checkpoints, LP incentive accounting, and timing.

---

## Sources (outreach)

- OtterSec Save CTFs Fund: https://osec.io/blog/save-ctfs-fund/
- Umbra SDK: https://sdk.umbraprivacy.com/quickstart
- Meteora docs: https://docs.meteora.ag/ · DLMM formulas/liquidity mining/dynamic positions · DAMM v2 / DBC public repos
- Meteora: https://www.meteora.ag/ · https://defillama.com/protocol/meteora-damm-v2
- Solana security ecosystem study: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6552478
- Sec3: https://sec3.dev/audits · OtterSec: https://osec.io/ · Neodyme: https://neodyme.io
- Squads: https://solanacompass.com/projects/squads
- Solana Foundation security: https://solana.com/news/solana-ecosystem-security
