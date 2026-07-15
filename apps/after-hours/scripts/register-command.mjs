import { COMMAND_DEFINITION } from "../src/discord.mjs";

const applicationId = required("DISCORD_APPLICATION_ID");
const token = required("DISCORD_BOT_TOKEN");
const url = `https://discord.com/api/v10/applications/${applicationId}/commands`;
const response = await fetch(url, {
  method: "PUT",
  headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
  body: JSON.stringify([COMMAND_DEFINITION]),
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(result.message || `Discord returned HTTP ${response.status}`);
const command = result.find((candidate) => candidate.name === COMMAND_DEFINITION.name);
if (!command) throw new Error("Discord did not return the AFTER HOURS command");
console.log(`Registered global /${command.name} for Discord server installation (${command.id})`);

function required(name) {
  const value = String(process.env[name] || "");
  if (!value) throw new Error(`${name} is required`);
  return value;
}
