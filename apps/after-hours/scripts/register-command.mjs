import { COMMAND_DEFINITION } from "../src/discord.mjs";

const applicationId = required("DISCORD_APPLICATION_ID");
const guildId = required("DISCORD_GUILD_ID");
const token = required("DISCORD_BOT_TOKEN");
const url = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
const response = await fetch(url, {
  method: "POST",
  headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
  body: JSON.stringify(COMMAND_DEFINITION),
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(result.message || `Discord returned HTTP ${response.status}`);
console.log(`Registered /${result.name} in guild ${guildId} (${result.id})`);

function required(name) {
  const value = String(process.env[name] || "");
  if (!value) throw new Error(`${name} is required`);
  return value;
}
