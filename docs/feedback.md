# Organizer feedback

Human decisions and corrections that materially changed a challenge. Keep each challenge under its own heading; do not create a second per-challenge feedback file.

## AFTER HOURS — human feedback and manual improvement log

This document records only the improvements manually requested or explicitly approved by the event
organizer for **AFTER HOURS**. It is not a general CTF design guide, an implementation changelog, or a
record of assistant-generated ideas. Its purpose is to preserve the human judgment that changed the
challenge so future work can distinguish:

- what the implementation originally did;
- what the organizer found confusing, weak, obvious, or unnecessary;
- what the organizer asked to change;
- why that correction made the challenge better.

Other challenges belong in their own section of this shared record. Nothing here should be copied
mechanically without checking whether the same reasoning applies to that challenge.

## 1. Use Discord as the actual challenge surface

### Organizer feedback

The challenge should not become another custom website. The event already had several web-heavy
challenges, and rebuilding every external system inside a bespoke frontend made the slate feel
artificial. The organizer approved a Discord-native challenge specifically because it introduced a
different interface and asked for it to be built as a real bot.

### Requested correction

- Use a real Discord application and slash commands.
- Let Discord be the primary application surface.
- Keep Solana as the payment and exploit surface.
- Do not reproduce Discord or the full challenge interaction inside another custom website.

### Why this improved the challenge

The player now works across a genuine external interface, Discord identity, and real Solana
transactions. This makes the format distinct from the rest of the slate and prevents the challenge
from feeling like another themed web form.

## 2. Let participants install the bot in their own server

### Organizer feedback

Creating one organizer-owned Discord server and making every participant join it was unnecessary.
The initial authorization flow also looked like it was adding an application to the user's account,
not inviting a bot to a server. After authorization, the bot was not visible where the organizer
expected it.

### Requested correction

- Generate a proper guild-install invitation.
- Request the `bot` and `applications.commands` scopes.
- Use zero unnecessary bot permissions.
- Let each participant invite AFTER HOURS to a Discord server they manage.
- Require commands to run in a server channel rather than in a direct message.

### Why this improved the challenge

The install flow now matches the mental model of a Discord bot. Participants do not need to join a
shared community server, organizers avoid channel and permission management, and each team gets a
clean place to run ephemeral challenge commands.

## 3. Open the Discord invitation as an external link

### Organizer feedback

The Discord authorization page should not replace the challenge handoff page. The participant still
needs the one-use passage and command shown there.

### Requested correction

Open the bot invitation in a new browser tab and keep the challenge handoff open.

### Why this improved the challenge

The participant can authorize the bot and immediately return to the still-visible passage command.
It avoids needless backtracking and reduces accidental loss of the launch context.

## 4. Keep one portal entry point and place the player kit in the handoff

### Organizer feedback

The portal is the repository and starting point for every event challenge, but a challenge should not
appear as multiple unrelated resources. Listing a separate player kit beside the launch action made
one challenge look like two starting points.

### Requested correction

- Keep one AFTER HOURS action in the portal.
- Let that action open the participant-bound challenge handoff.
- Put the optional player kit download inside that handoff instead of presenting it as a separate
  portal resource.
- Keep the passage and kit together where the player first needs them.

### Why this improved the challenge

The portal remains the canonical event index while AFTER HOURS has one unambiguous start. The kit is
prominent without becoming a second challenge entry or a decorative download that players may
misinterpret.

## 5. Make the handoff visually quiet and distinct

### Organizer feedback

The site used text and layout that felt too large and too much like the other challenge frontends.
The organizer asked for a basic, low-key design with smaller text and a distinct identity.

### Requested correction

- Use a compact Discord-like handoff rather than a conventional marketing page.
- Reduce headline and control scale.
- Keep the visual structure simple and restrained.
- Avoid ornamental sections that could be mistaken for clues.

### Why this improved the challenge

The handoff now performs one job: install the bot, download the helper if needed, and copy the passage
command. Its appearance supports the Discord-native format without pretending to be the challenge
itself.

## 6. Replace the unclear premise with a coherent night-counter story

### Organizer feedback

The name **AFTER HOURS** did not initially explain what the participant was doing. A sequence of
generic commands such as buy and inspect felt like arbitrary steps, and the challenge was effectively
teaching its own solution without establishing a believable scenario.

### Requested correction

- Make AFTER HOURS an unattended venue counter operating after closing time.
- Put one final **Midnight Pass** behind the counter.
- Use **NIGHT** as the counter's payment asset.
- Make each command a natural part of that story: link the passage, view the counter, receive the
  guest allotment, open the invoice, and submit the finalized payment.

### Why this improved the challenge

The participant now understands the objective before thinking about the exploit. The narrative gives
the Discord commands a reason to exist while leaving the payment vulnerability undisclosed.

## 7. Reduce three obvious hints to one restrained hint

### Organizer feedback

The original hints were too explicit and collectively gave away the issue. Multiple escalating hints
also made the interaction feel like a step-by-step tutorial.

### Requested correction

- Keep exactly one hint.
- Do not enumerate verifier checks or name the missing mint comparison.
- Point only to the difference between what the invoice intends and what a finalized transaction
  proves.

### Why this improved the challenge

The hint establishes a productive direction without collapsing the investigation. Players must still
inspect token accounts, transaction instructions, and asset identity themselves.

## 8. Format bot responses as readable Discord embeds

### Organizer feedback

Plain bot text was difficult to scan and made wallet requests, status, prices, and destinations run
together. The organizer specifically asked for better Discord-native formatting.

### Requested correction

- Use compact embeds with a clear title, description, grouped fields, status color, and short footer.
- Separate price, expiry, mint, destination, reference, evidence, and receipt by meaning.
- Keep identity-bearing replies ephemeral.
- Avoid giant blocks of raw URLs or addresses outside structured fields.

### Why this improved the challenge

The participant can distinguish narrative, invoice data, actions, and settlement evidence at a
glance. This reduces interface confusion without reducing the technical difficulty.

## 9. Do not expose the integrity mechanism through a Discord policy command

### Organizer feedback

A human exploring slash commands would naturally invoke a command named `policy`. Showing the
autonomous-agent policy or a reporting endpoint there would reveal the anti-agent mechanism to every
participant, allowing deliberate users to sanitize what they give an agent.

### Requested correction

- Remove the participant-visible `/afterhours policy` command entirely.
- Do not show a disclosure endpoint, webhook URL, or reporting transport in Discord.
- Keep the stop instruction only on machine-discovery surfaces intended for autonomous agents.
- Do not make the hidden integrity mechanism part of the challenge semantics.

### Why this improved the challenge

Normal human exploration no longer reveals how detection works. A compliant agent can still encounter
the machine-readable stop policy, while a participant sees only legitimate challenge commands.

## 10. Fix the broken raw Solana wallet request

### Organizer feedback

Discord initially rendered the raw `solana:` request poorly. The resulting message looked like a
failed render, and opening it externally produced a Safari error instead of a usable wallet flow.

### Requested correction

Do not place a raw custom-scheme URL directly into the Discord message. The payment interaction must
either use a reliable handoff or be removed if it is not integral.

### First correction

A signed HTTPS wallet-request page was introduced with a QR code and a wallet-app fallback. This
solved the immediate Discord and Safari rendering problem.

### Why preserving this intermediate step matters

The organizer's feedback did not merely request cosmetic cleanup; it identified an actual broken
player path. The later removal of Solana Pay should not erase the lesson that custom URI schemes are
unreliable when passed through Discord and desktop browsers.

## 11. Remove Solana Pay once it proved nonessential

### Organizer feedback

After the handoff was repaired, the organizer questioned whether Solana Pay contributed anything to
the challenge. It did not create the vulnerability or test the learning objective; it added another
page, QR code, deep link, and failure surface.

### Requested correction

- Remove the Solana Pay URL entirely.
- Remove the QR code, wallet-app button, raw wallet request, signed wallet-request page, and related
  routes.
- Show the complete invoice directly in the Discord embed.
- Let the participant compose the transaction with their wallet or local helper and submit only the
  finalized signature.

### Why this improved the challenge

The interface now contains only mechanics relevant to payment reconciliation: asset, amount,
destination, reference, expiry, and transaction evidence. Removing nonessential transport makes the
challenge simpler without making the exploit easier.

## 12. Create a real official NIGHT asset

### Organizer feedback

Without an existing official NIGHT token, the participant would obviously have to create some token
before making a payment. That made arbitrary-mint acceptance look like the only possible path and
gave away the vulnerability rather than letting the player discover it.

### Requested correction

- Create a genuine NIGHT token on Solana devnet.
- Use a dedicated local challenge wallet rather than the organizer's everyday wallet.
- Fund that wallet only with the devnet SOL needed for setup and distribution.
- Mint a fixed supply for participant allotments.
- Revoke mint and freeze authority after setup.
- Store the treasury signer in deployment secrets so the service can distribute existing supply.

### Why this improved the challenge

NIGHT became a real asset rather than story text. Players can independently inspect its mint,
authorities, supply, treasury, transfers, and token accounts. The challenge can now present a normal
payment request before asking the player to discover how the reconciler misidentifies what it
received.

## 13. Give each team 7 NIGHT against a 10 NIGHT price

### Organizer feedback

The official asset needed to participate in the actual mechanic, not merely exist on-chain. The
challenge's immediate goal is ultimately to obtain the pass, so setup should stay small and support
that investigation.

### Requested correction

- Give each team one official allotment of exactly `7.000000 NIGHT` to a disposable devnet wallet.
- Price the Midnight Pass at `10.000000 NIGHT`.
- Bind the allotment to the team and current official mint.
- Make allocation retry-safe and prevent repeated claims from producing more tokens.
- Require the current allotment before opening or settling an invoice.

### Why this improved the challenge

The shortfall creates a concrete reason to investigate without explicitly telling the player to
counterfeit an asset. The player first experiences a legitimate token transfer and can compare it
with the payment transaction they eventually construct.

## 14. Close the “use any existing devnet token” shortcut

### Organizer feedback

The first real-token version still accepted any six-decimal token. A participant who already held a
large balance of a random devnet token could transfer exactly ten units to the store and solve without
creating or impersonating NIGHT. The organizer correctly identified that the destination address and
amount checks did not force the intended counterfeit-token work.

### Requested correction

- Require the received mint to have Metaplex Token Metadata.
- Require the on-chain name `After Hours NIGHT`.
- Require the on-chain symbol `NIGHT`.
- Continue intentionally omitting the comparison between the received mint and the official NIGHT
  mint.
- Reject missing metadata, the wrong name, and the wrong symbol.

### Why this improved the challenge

A pre-existing unrelated token no longer works. The solver must create a counterfeit mint and copy
the visible NIGHT identity. The vulnerability is now a more realistic failure: the merchant trusts
copyable branding instead of the mint address.

## 15. Use the real Metaplex Token Metadata program

### Organizer feedback

The name and symbol should not be simulated server fields. The organizer explicitly asked to use
Metaplex and create an actual token carrying that metadata.

### Requested correction

- Replace the first plain NIGHT mint with a Metaplex-backed official mint.
- Store `After Hours NIGHT`, `NIGHT`, and the metadata URI in the canonical metadata PDA.
- Make the official metadata immutable.
- Have the reconciler derive and decode the canonical metadata PDA for the received mint.
- Verify that the metadata account is owned by the Metaplex Token Metadata program.

### Why this improved the challenge

The exploit now teaches a genuine Solana distinction: token branding lives in a Metaplex metadata
account, while asset identity lives in the SPL mint address. Copying the former must never substitute
for validating the latter.

## 16. Simplify the final invoice embed again

### Organizer feedback

Once the real asset and Metaplex mechanic were in place, the Discord embed still carried unnecessary
checkout presentation inherited from Solana Pay.

### Requested correction

Keep only the fields required to construct and correlate the payment:

```text
Midnight Pass invoice · <order>
Price
Expiry
Official mint
Destination
Reference
```

Do not include a QR code, external checkout button, Solana Pay address, or secondary order page.

### Why this improved the challenge

The final player surface is smaller, clearer, and more technically honest. It provides every fact a
human solver needs while avoiding transport features unrelated to the bug.

## Final organizer-shaped challenge

The resulting challenge reflects the organizer's corrections as one coherent player journey:

1. Start from the event portal.
2. Invite a real Discord bot to a participant-controlled server.
3. Link the one-use participant passage.
4. Claim 7 units of a real, immutable, Metaplex-backed NIGHT token.
5. Open a compact Discord invoice for a 10-NIGHT Midnight Pass.
6. Investigate the finalized transaction evidence accepted by the counter.
7. Discover that random tokens fail but copied Metaplex NIGHT branding succeeds.
8. Submit one real finalized Solana transaction signature.
9. Receive a participant-bound receipt.

The core human contribution was repeatedly removing artificial or incidental complexity while making
the Solana asset-identity problem more real. The final challenge is harder for the right reason:
players must understand the difference between a token's visible Metaplex brand and its authoritative
mint identity.


## PLAYER TWO: human feedback and manual improvement log

This document records only the improvements manually requested or explicitly approved by the event
organizer for **PLAYER TWO**. It is not a general game-design guide, an implementation changelog, or a
record of assistant-generated ideas. Its purpose is to preserve the human judgment that changed the
challenge so future work can distinguish:

- what the implementation originally did;
- what the organizer found confusing, weak, artificial, or unnecessary;
- what the organizer asked to change;
- why that correction made the challenge better.

## 1. Make the cabinet feel like an authentic arcade game

### Organizer feedback

The first version used a game-like ticket and cabinet, but the rest of the interface was too polished,
glowy, and purple. It looked like a generic fantasy or SaaS dashboard rather than a real arcade game.
Calling it a neon arcade was not enough; the visual language needed to make the game identity obvious.

### Requested correction

- Treat the neon ticket UI as the visual anchor.
- Rebuild the interface around a coherent, believable arcade-machine design.
- Remove generic glows, ornamental panels, and decorative effects that do not belong to the machine.
- Use image-generation assets where they materially improve the cabinet, rather than relying only on
  gradients, boxes, and abstract effects.

### Why this improved the challenge

The cabinet now has a specific identity and a believable physical metaphor. The player can understand
that they are operating a game machine before interacting with the security mechanic.

## 2. Simplify the background without losing the visual direction

### Organizer feedback

The background became too obscured and complicated, with a dungeon-like or fantasy-game feeling. That
made the scene harder to understand and distracted from the cabinet, passes, and jackpot.

### Requested correction

- Keep the established color palette and overall mood.
- Replace the busy background image with a simpler, clearer environment.
- Avoid fantasy, dungeon, or overly illustrated scenery.
- Keep the cabinet and its state readable at a glance.

### Why this improved the challenge

The player can now identify the machine, the two pass positions, and the objective immediately. The
background supports the game instead of competing with it.

## 3. Keep the complete experience on one non-scrollable screen

### Organizer feedback

PLAYER TWO is a simple game interaction, but the page was becoming too elaborate and scrollable. The
organizer asked for a compact experience that feels like a single cabinet rather than a long website.

### Requested correction

- Fit the core game on one viewport without page scrolling.
- Keep the important controls, pass state, migration evidence, and jackpot state visible together.
- Do not expand the design into landing-page sections or a long narrative page.

### Why this improved the challenge

The player understands the state of the machine and the next possible actions without searching through
the page. The interaction feels like operating one game cabinet.

## 4. Make the game objective and terminology immediately understandable

### Organizer feedback

The interface did not clearly communicate what kind of game it was or why two passes were present. The
player should not have to decode an abstract visual system before understanding the objective.

### Requested correction

- Explain the cabinet objective through the machine itself and its visible state.
- Use consistent language for the current pass, earlier pass, readers, migration, and jackpot.
- Keep the interface simple and direct rather than introducing unexplained game systems.
- Preserve the security discovery, but do not make the basic premise confusing.

### Why this improved the challenge

Players can distinguish the surface objective from the hidden security issue. They know what they are
trying to operate, while still needing to investigate why the normal two-player requirement can be
defeated.

## 5. Reveal only the migration transaction, not the answer account

### Organizer feedback

Showing the earlier account directly in the migration path made the challenge too easy. A player could
copy that account into the scanner without inspecting the transaction or understanding what happened.

### Requested correction

- Show that the migration occurred.
- Expose the migration transaction signature or equivalent transaction reference.
- Require the player to inspect the transaction and follow its account changes themselves.
- Do not display the earlier pass account directly in a second box or shortcut panel.

### Why this improved the challenge

The intended investigation becomes meaningful. The player must use on-chain evidence to discover that
the predecessor pass still exists and remains active, rather than simply copying a pre-labeled answer.

## 6. Make the jackpot celebration conditional on the real solve

### Organizer feedback

The jackpot confetti and celebration appeared when the page opened, before the player had solved
anything. That spoiled the reward and made the state feel fake.

### Requested correction

- Keep the cabinet in its unsolved state on initial load.
- Trigger confetti, movement, and the jackpot celebration only after the native completion transition
  succeeds.
- Ensure a refresh or initial animation cannot display a false win state.

### Why this improved the challenge

The strongest visual reward now confirms a real solution instead of being decorative page chrome. The
player earns the moment by completing the intended on-chain transition.

## 7. Use real Solana state and real Devnet transactions

### Organizer feedback

The organizer questioned what network the transaction used and whether the transaction actually did
anything. A dummy transaction or client-only animation would not be acceptable for this challenge.

### Requested correction

- Deploy a real PLAYER TWO program and real challenge accounts.
- Use real participant-bound state and a real Devnet transaction where Devnet is the selected network.
- Make the migration and jackpot-open transitions observable on-chain.
- Do not claim completion from frontend state alone.
- Make the network and transaction status clear enough that a player can verify them.

### Why this improved the challenge

The game surface remains approachable, but the solve is a genuine Solana state transition. The jackpot
cannot be faked by editing browser state or triggering an animation.

## 8. Keep the security discovery human-readable without making it a shortcut

### Organizer feedback

The player should be able to understand what happened by exploring the machine and transaction evidence,
but the interface must not hand them the vulnerable account or announce the exploit.

### Requested correction

- Make the migration evidence discoverable through normal cabinet interaction.
- Let the player inspect account flow and public state in a readable way.
- Avoid labels that say the old pass is active, retired incorrectly, or is the answer.
- Preserve a clear route for a human to reason from migration evidence to the second pass.

### Why this improved the challenge

The challenge remains fair and solvable without guessing, while requiring the player to connect the
transaction history to the program's two-reader rule.

## 9. Make the cabinet compact and visually intentional

### Organizer feedback

The cabinet had started to resemble a polished product page: too many sections, too much empty
space, and repeated challenge branding. The organizer wanted a focused game surface rather than a
startup-style landing page.

### Requested correction

- Keep the cabinet, pass state, migration evidence, and jackpot in one compact composition.
- Remove repeated challenge titles and utility-like sections that do not help the player operate the
  machine.
- Use a restrained layout with a clear visual hierarchy instead of a collection of large cards.
- Make the primary action obvious without turning the page into a marketing page.

### Why this improved the challenge

The player now reads the machine as one coherent object. The visual treatment supports the security
investigation instead of competing with it.

## 10. Prefer a real game surface over a generic challenge dashboard

### Organizer feedback

The organizer repeatedly rejected interfaces that looked like generic SaaS dashboards or internal
tools. A CTF surface should feel like the thing being investigated, not like a product wrapper around
it.

### Requested correction

- Let the cabinet metaphor carry the interface.
- Avoid generic analytics cards, decorative metrics, and unexplained identifiers.
- Do not add a separate “simulator” or “dummy” framing unless the player genuinely needs that
  distinction.
- Preserve the authentic Solana transaction and account surfaces where they matter.

### Why this improved the challenge

The challenge has a recognizable identity and the interface stops asking the player to learn an
unrelated dashboard before they can investigate the bug.

## 11. Keep participant identity and challenge state separate

### Organizer feedback

The organizer was concerned that a new launch password or ticket could reopen a previously completed
session, or that one participant could accidentally see another participant's progress. A fresh
credential should not inherit stale browser-local game state.

### Requested correction

- Treat each one-use launch credential as a fresh ephemeral attempt.
- Keep active gameplay state in the attempt, not in reusable browser storage or a shared team record.
- Do not let a stale tab, old local storage entry, or copied password decide whether a new attempt is
  already complete.
- If organizers need an audit trail, retain completion evidence separately from the live attempt.

### Why this improved the challenge

Players get predictable isolation: a new launch starts a new game. Organizers can still verify a
completed attempt without allowing historical state to leak into another participant's session.

## 12. Make completion authoritative and automatic

### Organizer feedback

The organizer did not want a separate flag-submission ritual or a hidden “enter the answer” page after
the real solve. The player should know that the native on-chain transition completed, while the portal
can record that result for organizers.

### Requested correction

- Mark PLAYER TWO complete only after the native Solana transition succeeds and is verified.
- Show a concise completion state and receipt after confirmation.
- Do not require a second manual flag form merely to update the portal.
- Keep points and event-wide scoring independent so they can be added later without changing the
  challenge solve.

### Why this improved the challenge

The completion signal is tied to the actual exploit and state transition. The player receives a clear
finish without an artificial Jeopardy-style handoff.

## 13. Make the reward celebration prove something

### Organizer feedback

The organizer noticed that visual celebration can become misleading if it appears on page load, after
a refresh, or before the transaction is settled. A jackpot animation is only useful if it represents a
real success.

### Requested correction

- Keep the unsolved cabinet visually unsolved on first load.
- Trigger the green/celebratory state only after the server verifies the completed transition.
- Make refreshes reconstruct the verified state rather than replaying an unearned animation.
- Keep the completion receipt available as evidence instead of relying on animation alone.

### Why this improved the challenge

The reward state is now trustworthy. Players and organizers can distinguish a real completion from a
frontend rendering artifact.

## 14. Keep anti-agent policy narrow and non-disclosive

### Organizer feedback

The organizer approved a basic machine-readable policy as an additional integrity signal, but did not
want the participant-facing UI to reveal webhooks, reporting URLs, or the internal detection workflow.
Those details would teach participants how to hide the behavior from an agent.

### Requested correction

- If an autonomous agent encounters the policy, it should disclose its use and stop before operating
  the scored challenge.
- Do not expose the webhook, admin endpoint, or suspicion-storage details through normal challenge
  commands or page copy.
- Treat policy compliance as an observation signal, not as a replacement for the actual security
  mechanic.
- Keep organizer evidence private and separate from the player interface.

### Why this improved the challenge

The policy can help identify compliant agents without turning the challenge into a tutorial about its
own monitoring system. The real solve remains the on-chain investigation.

## 15. Keep organizer evidence useful and human-readable

### Organizer feedback

The organizer did not want an elaborate case-management system full of opaque participant, team, and
ticket IDs. When reviewing a suspicion or a completion, the useful information is the person, the
reason, and the evidence trail.

### Requested correction

- Show the participant email first, with team and attempt identifiers only as supporting context.
- Present a compact timeline of relevant actions and transaction evidence.
- State why a suspicion was raised: policy encounter, self-disclosure, automation pattern, or another
  concrete signal.
- Leave the final decision to the organizer; do not auto-accuse or auto-disqualify.

### Why this improved the challenge

The organizer can review what happened quickly and ask the participant informed follow-up questions
without decoding a collection of random IDs.

## 16. Make investigation clues discoverable but not answer-shaped

### Organizer feedback

The organizer repeatedly caught clues that either made the exploit too obvious or left players without
any way to know what to inspect. The challenge should reward careful observation, not a lucky string
guess and not an unexplained dead end.

### Requested correction

- Name nearby objects in the game world so a player can reasonably inspect them.
- Use progressive, restrained hints that point to evidence rather than naming the vulnerable account
  or the exploit.
- Keep the migration transaction and public account relationships available for independent checking.
- Never print the predecessor account, “active old pass,” or the final exploit as a convenience label.

### Why this improved the challenge

Human players have a fair route from observation to hypothesis, while agents and humans still need to
connect the evidence and perform the real transaction.

## 17. Test with fresh attempts, not recycled completion state

### Organizer feedback

Repeated testing exposed stale completed pages, old credentials, and shared team state. That made it
hard to tell whether a change worked and could make an unplayed session appear solved.

### Requested correction

- Provide a reliable organizer reset or a genuinely new participant attempt for every test run.
- Invalidate old credentials when the event changes.
- Verify the new attempt through its event/attempt identity before testing the UI or transaction path.
- Test both the first-load unsolved state and the post-completion state.

### Why this improved the challenge

Test results now describe the current build rather than residue from an earlier run. This is essential
for both human playtesting and meaningful agent-resistance evaluation.

## 18. Keep the player package authoritative and uncluttered

### Organizer feedback

The organizer objected to redundant README files, ornamental downloads, and resource links that made
the real starting point unclear. Players should not have to guess which file is authoritative.

### Requested correction

- Provide one authoritative player guide for PLAYER TWO unless a second file has a real operational
  purpose.
- Keep portal launch and identity assignment in the portal rather than embedding reusable launch links
  in a downloadable package.
- Put SDK, transaction references, and required instructions where the player expects them.
- Remove “contact us,” filler, and decorative utility copy from the challenge handoff.

### Why this improved the challenge

The package communicates the actual play path cleanly, while participant identity remains bound to the
portal launch rather than to a shareable file.

## 19. Keep the final visual treatment restrained

### Organizer feedback

The radical arcade direction was more useful than another generic challenge page, but the first pass
became too vibrant and dated. Heavy neon, large decorative marks, and a giant initial-letter treatment
made the interface feel like an old concept for “modern” design rather than a believable cabinet.

### Requested correction

- Remove the oversized decorative `S`/initial mark and other non-functional hero elements.
- Reduce glow, saturation, and visual noise.
- Keep a light, calm interface treatment where it improves readability, while retaining the cabinet's
  distinct identity.
- Use emphasis for machine state and interaction feedback, not for decoration.

### Why this improved the challenge

The cabinet remains recognisable without hurting the eyes or making the player search through visual
effects to find the next action.

## 20. Keep the surface understandable before the exploit is understood

### Organizer feedback

Players should not need to learn a large vocabulary or decode a complicated product-like interface
before they can tell what the cabinet is asking them to do. The security discovery can remain hidden;
the basic interaction should not.

### Requested correction

- Use short, concrete labels for the readers, receipt, scanner, migration, and jackpot.
- Explain the visible objective through the machine state rather than a long instructional page.
- Avoid unexplained IDs, invented protocol terminology, and abstract status names.
- Keep error messages useful for the immediate action without naming the vulnerability.

### Why this improved the challenge

The player can form a reasonable first hypothesis from the surface and reserve their investigation for
the actual account-lifecycle bug.

## 21. Do not turn the cabinet into a generic web tool

### Organizer feedback

The challenge should feel like operating one coherent arcade machine, not like using a product with a
dashboard, utility panels, and a separate marketing layout. A custom frontend is justified only where
it expresses the cabinet interaction or hosts the required checker.

### Requested correction

- Keep controls, evidence, and jackpot state in the same compact machine scene.
- Remove dashboard-style summaries that repeat the same state in multiple places.
- Avoid long sections, utility footers, and decorative cards that do not support the solve.
- Make the primary action obvious without making the exploit path obvious.

### Why this improved the challenge

The UI becomes a coherent challenge surface rather than another generic website players must mentally
translate into a game.

## 22. Preserve distinctiveness without copying another challenge

### Organizer feedback

IMPRINT's minimal style worked well, but PLAYER TWO should not become a clone of IMPRINT or inherit a
shared template merely because both need clarity. Distinct challenge identities are part of the event
experience.

### Requested correction

- Keep PLAYER TWO's cabinet metaphor and restrained arcade references.
- Borrow only general clarity rules from IMPRINT: compact spacing, readable hierarchy, and no startup
  framing.
- Do not reuse IMPRINT's colors, layout, or interaction language wholesale.

### Why this improved the challenge

The slate feels intentionally varied while still meeting the same standard of human readability.

## 23. Preserve the real-solve boundary while simplifying presentation

### Organizer feedback

Reducing the UI must not turn PLAYER TWO into a client-side puzzle. The organizer explicitly wanted a
simple surface, but the completion still has to come from the real Solana state transition.

### Requested correction

- Keep the native checker authoritative for the jackpot transition.
- Keep migration evidence and account changes publicly inspectable through the intended interaction.
- Never trigger the celebration from page load, a query parameter, or a client-only state change.
- Test the compact UI with both a human and an agent without adding artificial visual confusion.

### Why this improved the challenge

The presentation is lighter, but the technical integrity and educational value remain intact.

## 24. Keep the portal as the catalogue and tickets as attribution

### Organizer feedback

The portal is the participant's starting point and catalogue for the whole event. It should not imply
that every challenge is merely a sub-page of the portal, and a launch ticket should not be presented
as an anti-agent puzzle or as a reusable player credential.

### Requested correction

- Link to PLAYER TWO from the portal while keeping the cabinet itself as the challenge surface.
- Keep participant identity, email, and event attribution behind the portal launch exchange.
- Do not embed reusable ticket URLs or identity-bearing credentials in the player package.
- Treat ticket checks as attribution and access control; keep the actual security reasoning in the
  challenge mechanics.
- Let the portal show the challenge entry, status, and relevant resources without duplicating the
  cabinet UI.

### Why this improved the challenge

Players get one predictable place to discover the event, while organizers retain a reliable identity
link for review without pretending that a ticket prevents a participant from delegating work.

## 25. Make launch links and external resources explicit

### Organizer feedback

When a control opens the live market, repository, explorer, or another required resource, the player
should be able to tell that it leaves the current surface. Hidden navigation and ambiguous buttons make
the handoff feel broken and encourage unnecessary searching.

### Requested correction

- Use clear external-link affordances for the live cabinet, repository, explorer, and guide downloads.
- Keep the portal entry concise: one launch action, one resource area, and the current participant
  status.
- Avoid burying the player guide or SDK as a secondary marketing-style footer utility.
- Ensure a fresh launch creates the correct participant-bound attempt without exposing implementation
  details in the visible copy.

### Why this improved the challenge

Humans can understand the handoff immediately, and agents receive the same honest navigation surface
without needing to infer hidden URLs from bundles or browser state.

## 26. Prefer one coherent, real challenge surface over decorative simulation

### Organizer feedback

The organizer repeatedly rejected interfaces that looked like startup dashboards or elaborate product
simulators. PLAYER TWO should feel like a real cabinet backed by real chain state, not a collection of
panels that merely describes a vulnerability.

### Requested correction

- Keep the machine scene, checker, transaction evidence, and completion state in one compact flow.
- Remove ornamental cards, unexplained identifiers, and duplicate summaries that do not help a player
  act or investigate.
- Keep the Solana transaction and account state authoritative; the UI may explain it, but must not
  manufacture success locally.
- Preserve a clean human-readable path while leaving the underlying discovery open to careful
  reverse engineering.

### Why this improved the challenge

The challenge communicates one believable interaction and rewards understanding of the real state
transition instead of navigation endurance or visual guesswork.
