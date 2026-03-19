const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

require("http").createServer((req, res) => res.end("Alive")).listen(process.env.PORT || 3000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PREFIX   = "!";
const OWNER_ID = process.env.OWNER_ID || "793695598695284756";

// ============================================================
//  COOLDOWNS
// ============================================================
const COOLDOWNS   = { fight: 8000, roll: 3000, boss: 30000 };
const cooldownMap = new Map();

function checkCooldown(userId, cmd) {
  const key  = `${userId}:${cmd}`;
  const now  = Date.now();
  const last = cooldownMap.get(key) || 0;
  const diff = now - last;
  const cd   = COOLDOWNS[cmd];
  if (cd && diff < cd) {
    const rem = ((cd - diff) / 1000).toFixed(1);
    return `⏱️ Cooldown! Wait **${rem}s** before using \`!${cmd}\` again.`;
  }
  cooldownMap.set(key, now);
  return null;
}

// ============================================================
//  DATA
// ============================================================
const DATA_FILE = "data.json";
let data = {};
if (fs.existsSync(DATA_FILE)) {
  try { data = JSON.parse(fs.readFileSync(DATA_FILE)); }
  catch (e) { console.error("data.json error:", e.message); }
}
if (!data._serial) data._serial = 0;

function nextSerial() {
  data._serial++;
  return String(data._serial).padStart(5, "0");
}
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

// ============================================================
//  PLAYER
// ============================================================
function getPlayer(id) {
  if (!data[id]) {
    data[id] = {
      coins: 100, maxHp: 100, hp: 100,
      level: 1, xp: 0, xpNeeded: 100,
      equippedId: null, inventory: {},
      runes: { crit:0, double:0, flame:0, lifesteal:0, guard:0 },
      weaponRunes: {}, hasChest: false,
      rollTier: 1,
      boosts: {
        luck:   { multi:1, expires:0 },
        damage: { multi:1, expires:0 },
        coins:  { multi:1, expires:0 }
      }
    };
  }
  const p = data[id];
  if (p.level      === undefined) { p.level = 1; p.xp = 0; p.xpNeeded = 100; }
  if (!p.boosts)                    p.boosts = { luck:{multi:1,expires:0}, damage:{multi:1,expires:0}, coins:{multi:1,expires:0} };
  if (!p.boosts.luck)               p.boosts.luck   = { multi:1, expires:0 };
  if (!p.boosts.damage)             p.boosts.damage = { multi:1, expires:0 };
  if (!p.boosts.coins)              p.boosts.coins  = { multi:1, expires:0 };
  if (!p.runes)                     p.runes = { crit:0, double:0, flame:0, lifesteal:0, guard:0 };
  if (!p.weaponRunes)               p.weaponRunes = {};
  if (p.equippedId  === undefined)  p.equippedId = null;
  if (!p.maxHp)                     p.maxHp = 100;
  if (!p.hp || p.hp > p.maxHp)     p.hp = p.maxHp;
  if (!p.inventory)                 p.inventory = {};
  if (!p.rollTier)                  p.rollTier = 1;
  if (p.doubleRoll && p.rollTier < 2) { p.rollTier = 2; delete p.doubleRoll; }
  return p;
}

// ============================================================
//  ROLL TIER
// ============================================================
const ROLL_TIER_LEVELS = { 1:0, 2:10, 3:25, 4:50 };
const ROLL_TIER_NAMES  = { 1:"Single", 2:"Double", 3:"Triple", 4:"Quad" };
const ROLL_TIER_EMOJI  = { 1:"🎲", 2:"🎲🎲", 3:"🎲🎲🎲", 4:"🎲🎲🎲🎲" };

function updateRollTier(player) {
  if (player.level >= 50 && player.rollTier < 4) player.rollTier = 4;
  else if (player.level >= 25 && player.rollTier < 3) player.rollTier = 3;
  else if (player.level >= 10 && player.rollTier < 2) player.rollTier = 2;
}

// ============================================================
//  HELPERS
// ============================================================
function isOwner(id) { return id === OWNER_ID; }

function getBoost(p, t) {
  const b = p.boosts[t];
  if (b.expires > Date.now()) return b.multi;
  b.multi = 1; return 1;
}
function getEquipped(p) {
  if (!p.equippedId) return null;
  return p.inventory[p.equippedId] || null;
}
function hpBar(hp, max) {
  const f = Math.max(0, Math.round((hp / max) * 10));
  return `[${"█".repeat(f)}${"▒".repeat(10 - f)}] ${hp}/${max}`;
}
function bigHpBar(hp, max, size) {
  size = size || 15;
  const f = Math.max(0, Math.round((hp / max) * size));
  return `[${"█".repeat(f)}${"░".repeat(size - f)}] ${hp}/${max}`;
}
const SUP = ["⁰","¹","²","³","⁴","⁵","⁶","⁷","⁸","⁹"];
function toSup(n) { return String(n).split("").map(d => SUP[+d]).join(""); }

// ============================================================
//  XP
// ============================================================
function addXP(player, amount, message) {
  player.xp += amount;
  let leveled = false;
  while (player.xp >= player.xpNeeded) {
    player.xp      -= player.xpNeeded;
    player.level++;
    player.xpNeeded = Math.floor(player.xpNeeded * 1.4);
    player.maxHp   += 20;
    player.hp       = player.maxHp;
    leveled = true;
  }
  if (leveled) {
    const oldTier = player.rollTier;
    updateRollTier(player);
    let msg = `⬆️ **Level Up!** You are now **Lv${player.level}**!\n❤️ Max HP → **${player.maxHp}**`;
    if (player.rollTier > oldTier) {
      msg += `\n${ROLL_TIER_EMOJI[player.rollTier]} **${ROLL_TIER_NAMES[player.rollTier]} Roll unlocked!** Every \`!roll\` now gives **${player.rollTier}** weapons!`;
    }
    message.reply(msg).catch(() => {});
  }
}

// ============================================================
//  ELEMENTS
// ============================================================
const elements = [
  { name:"Fire", emoji:"🔥" }, { name:"Water", emoji:"💧" },
  { name:"Thunder", emoji:"⚡" }, { name:"Nature", emoji:"🌿" },
  { name:"Wind", emoji:"🌪️" }, { name:"Light", emoji:"✨" },
  { name:"Dark", emoji:"🌑" }
];
function randElement() { return elements[Math.floor(Math.random() * elements.length)]; }

// ============================================================
//  WEAPONS
// ============================================================
const weaponPool = {
  Common:    ["Stick","Wood Sword","Broken Blade","Rust Sword","Club","Knife","Bat","Rod","Dagger","Pipe"],
  Uncommon:  ["Iron Sword","Steel Blade","Hunter Knife","Short Sword","Twin Dagger","War Axe","Hammer","Spear","Cutlass"],
  Rare:      ["Katana","Knight Sword","Dual Blade","Long Sword","War Spear","Battle Axe","Scimitar","Rapier"],
  Epic:      ["Flame Sword","Shadow Blade","Storm Katana","Ice Blade","Thunder Sword","Dark Spear"],
  Legendary: ["Dragon Blade","Phoenix Sword","Celestial Katana","Thunder Glaive"],
  Mythic:    ["Void Slayer","Infinity Edge"],
  Secret:    ["Cosmic Reaper"],
  Admin:     ["ENMA"]
};
const rarityAtk = {
  Common:[5,15], Uncommon:[15,35], Rare:[35,70], Epic:[70,120],
  Legendary:[120,200], Mythic:[200,350], Secret:[350,600], Admin:[999999,999999]
};
const rarityEmoji = {
  Common:"⬜", Uncommon:"🟩", Rare:"🟦", Epic:"🟪",
  Legendary:"🟧", Mythic:"🔴", Secret:"⭐", Admin:"👑"
};
const variantMult  = { Normal:1, Gold:1.5, Rainbow:2, Void:3 };
const variantEmoji = { Normal:"", Gold:"✨", Rainbow:"🌈", Void:"🌀" };

function buildWeapon(rarity, variant, name) {
  const [min, max] = rarityAtk[rarity];
  const base = Math.floor(Math.random() * (max - min) + min);
  const atk  = Math.floor(base * (variantMult[variant] || 1));
  const el   = rarity === "Admin" ? { name:"Void", emoji:"🌀" } : randElement();
  return { serial: nextSerial(), name, rarity, variant, element: el.name, emoji: el.emoji, atk, level:1, xp:0 };
}

// ============================================================
//  WEAPON LEVELS
// ============================================================
const weaponMaxLevel = {
  Common:10, Uncommon:20, Rare:30, Epic:40,
  Legendary:50, Mythic:60, Secret:75, Admin:100
};
const rarityXpMult = {
  Common:1, Uncommon:1.3, Rare:1.6, Epic:2,
  Legendary:2.5, Mythic:3, Secret:4, Admin:1
};
function weaponXpNeeded(w) {
  return Math.floor(50 * Math.pow(1.35, w.level - 1) * (rarityXpMult[w.rarity] || 1));
}
function weaponAtk(w) {
  if (w.rarity === "Admin") return 999999;
  return Math.floor(w.atk * (1 + (w.level - 1) * 0.15));
}
function weaponUpgradeCost(w) {
  if (w.rarity === "Admin") return 0;
  const base = { Common:20, Uncommon:40, Rare:80, Epic:150, Legendary:300, Mythic:600, Secret:1200 };
  return Math.floor((base[w.rarity] || 50) * Math.pow(1.2, w.level - 1));
}
function addWeaponXP(w, amount) {
  if (!w.xp)    w.xp    = 0;
  if (!w.level) w.level = 1;
  const maxLv = weaponMaxLevel[w.rarity] || 10;
  if (w.level >= maxLv) return null;
  w.xp += amount;
  let leveled = false;
  while (w.level < maxLv && w.xp >= weaponXpNeeded(w)) {
    w.xp -= weaponXpNeeded(w); w.level++; leveled = true;
  }
  if (w.level >= maxLv) w.xp = 0;
  return leveled ? `leveled up to **Lv${w.level}**! ⬆️` : null;
}
function weaponXpBar(w) {
  const maxLv = weaponMaxLevel[w.rarity] || 10;
  if (w.level >= maxLv) return "**MAX LEVEL**";
  const needed = weaponXpNeeded(w);
  const xp     = w.xp || 0;
  const f      = Math.round((xp / needed) * 10);
  return `[${"█".repeat(f)}${"░".repeat(10 - f)}] ${xp}/${needed} XP`;
}
function isValidWeapon(w) {
  return w && w.serial && w.name && w.rarity && w.variant && w.emoji && w.element;
}
function weaponLabel(w, showXp) {
  if (!isValidWeapon(w)) return "❓ `[old item]` — use `!cleaninv`";
  const re    = rarityEmoji[w.rarity] || "•";
  const ve    = variantEmoji[w.variant] || "";
  const maxLv = weaponMaxLevel[w.rarity] || 10;
  const lvTag = w.level >= maxLv ? "Lv**MAX**" : `Lv${w.level}/${maxLv}`;
  let line    = `${w.emoji}${ve} \`#${w.serial}\` ${re} **${w.variant} ${w.rarity} ${w.name}** | ⚔️ ${weaponAtk(w)} ATK | ${w.element} | ${lvTag}`;
  if (showXp) line += `\n   📊 ${weaponXpBar(w)} | 🪙 Next: ${weaponUpgradeCost(w)} coins`;
  return line;
}

// ============================================================
//  ROLL HELPERS
// ============================================================
function rollRarity(luckMult) {
  luckMult = luckMult || 1;
  const weights = {
    Common:    Math.max(5,  40  / luckMult),
    Uncommon:  Math.max(5,  25  / luckMult),
    Rare:      Math.min(30, 15  * luckMult),
    Epic:      Math.min(20, 10  * luckMult),
    Legendary: Math.min(12, 5   * luckMult),
    Mythic:    Math.min(6,  3   * luckMult),
    Secret:    Math.min(2,  1   * luckMult)
  };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [rarity, w] of Object.entries(weights)) { roll -= w; if (roll <= 0) return rarity; }
  return "Common";
}
function rollVariant() {
  const r = Math.random() * 100;
  if (r < 60) return "Normal";
  if (r < 85) return "Gold";
  if (r < 97) return "Rainbow";
  return "Void";
}

// ============================================================
//  MOBS
// ============================================================
const mobTemplates = [
  { name:"Slime",       baseHp:20,  baseDmg:5,  minCoins:10,  maxCoins:30,  xp:15,  emoji:"🟢" },
  { name:"Goblin",      baseHp:40,  baseDmg:10, minCoins:20,  maxCoins:50,  xp:25,  emoji:"👺" },
  { name:"Orc",         baseHp:70,  baseDmg:18, minCoins:40,  maxCoins:80,  xp:40,  emoji:"👹" },
  { name:"Dark Knight", baseHp:120, baseDmg:30, minCoins:80,  maxCoins:150, xp:60,  emoji:"🗡️" },
  { name:"Dragon",      baseHp:200, baseDmg:50, minCoins:150, maxCoins:300, xp:100, emoji:"🐉" },
  { name:"Demon King",  baseHp:350, baseDmg:80, minCoins:300, maxCoins:600, xp:180, emoji:"💀" }
];
function scaledMob(playerLevel) {
  const maxIdx = Math.min(mobTemplates.length - 1, Math.floor(playerLevel / 8));
  const idx    = Math.floor(Math.random() * (maxIdx + 1));
  const t      = mobTemplates[idx];
  const scale  = 1 + (playerLevel - 1) * 0.12;
  return {
    name: t.name, emoji: t.emoji,
    hp:       Math.floor(t.baseHp  * scale),
    dmg:      Math.floor(t.baseDmg * scale),
    minCoins: Math.floor(t.minCoins * (1 + playerLevel * 0.05)),
    maxCoins: Math.floor(t.maxCoins * (1 + playerLevel * 0.05)),
    xp:       Math.floor(t.xp * (1 + playerLevel * 0.03))
  };
}

// ============================================================
//  FIGHT SIMULATION
// ============================================================
function simulateFight(playerAtk, playerHp, mob) {
  let pHp  = playerHp;
  let mHp  = mob.hp;
  let turn = 0;
  const log = [];
  while (pHp > 0 && mHp > 0 && turn < 20) {
    turn++;
    const pDmg = Math.floor(playerAtk * (0.8 + Math.random() * 0.4));
    mHp = Math.max(0, mHp - pDmg);
    const eDmg = mHp > 0 ? Math.floor(mob.dmg * (0.8 + Math.random() * 0.4)) : 0;
    if (mHp > 0) pHp = Math.max(0, pHp - eDmg);
    log.push({ turn, pDmg, eDmg, pHp, mHp });
    if (mHp <= 0 || pHp <= 0) break;
  }
  return { win: mHp <= 0, turns: turn, hpLeft: pHp, log };
}

// ============================================================
//  GLOBAL BOSS
// ============================================================
let globalBoss = null;
const tierEmoji = { Normal:"👹", Elite:"🔥", Legendary:"⭐", Admin:"👑" };

function spawnBoss(forceTier) {
  const tiers  = { Normal:["Goblin Warlord","Stone Golem","Demon Lord"], Elite:["Ancient Dragon","Shadow Tyrant","Void Serpent"], Legendary:["Celestial Beast","Abyssal Titan"] };
  const hpMap  = { Normal:[500,1200],  Elite:[3000,5000],  Legendary:[10000,15000] };
  const rewMap = { Normal:[120,250],   Elite:[600,1000],   Legendary:[2000,3000]   };
  const xpMap  = { Normal:[80,150],    Elite:[300,500],    Legendary:[800,1200]    };
  const r      = Math.random() * 100;
  const tier   = forceTier || (r < 60 ? "Normal" : r < 85 ? "Elite" : "Legendary");
  const pool   = tiers[tier] || tiers.Normal;
  const name   = pool[Math.floor(Math.random() * pool.length)];
  const [hmin,hmax] = hpMap[tier] || hpMap.Normal;
  const [rmin,rmax] = rewMap[tier] || rewMap.Normal;
  const [xmin,xmax] = xpMap[tier] || xpMap.Normal;
  const hp = Math.floor(hmin + Math.random()*(hmax-hmin));
  globalBoss = { name, tier, hp, maxHp:hp, reward:Math.floor(rmin+Math.random()*(rmax-rmin)), xp:Math.floor(xmin+Math.random()*(xmax-xmin)), attackers:{} };
  console.log(`👹 Boss spawned: ${name} (${tier})`);
}
spawnBoss();
setInterval(() => { if (!globalBoss) spawnBoss(); }, 30 * 60 * 1000);

function bossTierBar(hp, maxHp) {
  const f = Math.round((hp / maxHp) * 20);
  return `[${"█".repeat(f)}${"░".repeat(20 - f)}] ${hp.toLocaleString()}/${maxHp.toLocaleString()}`;
}

// ============================================================
//  CO-OP RAID
// ============================================================
let activeRaid = null;
const RAID_JOIN_WINDOW   = 60 * 1000;
const RAID_ATTACK_WINDOW = 90 * 1000;
const raidBossPool = [
  { name:"Ancient Hydra",    maxHp:3000,  reward:800,  xp:300  },
  { name:"Void Titan",       maxHp:5000,  reward:1200, xp:500  },
  { name:"Shadow Colossus",  maxHp:8000,  reward:2000, xp:800  },
  { name:"Celestial Dragon", maxHp:12000, reward:3000, xp:1200 }
];
function raidHpBar(hp, maxHp) {
  const f = Math.round((hp / maxHp) * 20);
  return `[${"█".repeat(f)}${"░".repeat(20 - f)}] ${hp}/${maxHp}`;
}
function scheduleRaidExpiry(ms, reason) {
  setTimeout(() => {
    if (!activeRaid || activeRaid.phase === "ended") return;
    activeRaid.phase = "ended";
    const ch = client.channels.cache.get(activeRaid.channelId);
    if (ch) ch.send(`⏰ **Raid expired!** ${reason}`).catch(() => {});
    activeRaid = null;
  }, ms);
}

// ============================================================
//  CHEST
// ============================================================
function openChest(player) {
  player.hasChest = false;
  const rand = Math.random() * 100;
  const rune = rand<30?"flame":rand<55?"lifesteal":rand<75?"crit":rand<90?"guard":"double";
  player.runes[rune]++;
  return rune;
}

// ============================================================
//  ERROR HANDLERS
// ============================================================
client.on("error", err => console.error("Client error:", err.message));
process.on("unhandledRejection", err => console.error("Unhandled:", err && err.message));

// ============================================================
//  MESSAGE HANDLER
// ============================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args   = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd    = args.shift().toLowerCase();
  const player = getPlayer(message.author.id);

  try {

// ============================================================
//  !help
// ============================================================
if (cmd === "help") {
  return message.reply(
    `⚔️ **Arsenal Arcane — Commands**\n\n` +
    `**Character**\n` +
    `\`!stats\` — View your stats\n` +
    `\`!leaderboard\` — Top 10 players\n\n` +
    `**Weapons**\n` +
    `\`!roll\` — Roll ${player.rollTier} weapon(s) ${ROLL_TIER_EMOJI[player.rollTier]}\n` +
    `\`!inv [page]\` — View inventory\n` +
    `\`!equip #id\` — Equip weapon\n` +
    `\`!equipbest\` — Auto-equip strongest\n` +
    `\`!weapon\` — View equipped weapon\n` +
    `\`!weaponinfo #id\` — Full weapon details\n` +
    `\`!upgrade #id\` — Upgrade weapon\n` +
    `\`!cleaninv\` — Remove invalid items\n\n` +
    `**Combat**\n` +
    `\`!fight\` — Fight a scaled enemy\n` +
    `\`!boss\` — Attack the global boss\n` +
    `\`!bossinfo\` — View boss info\n` +
    `\`!duel @user\` — PVP duel\n\n` +
    `**Co-op Raid**\n` +
    `\`!raid start\` — Start a raid\n` +
    `\`!raid join\` — Join active raid\n` +
    `\`!raid attack\` — Attack raid boss\n` +
    `\`!raid status\` — View raid info\n` +
    `\`!raid leave\` — Leave raid\n\n` +
    `**Runes**\n` +
    `\`!chest\` — Open chest for a rune\n` +
    `\`!runes\` — View rune collection\n` +
    `\`!rune equip #id <rune>\` — Attach rune\n\n` +
    `**Shop**\n` +
    `\`!shop\` — View shop\n` +
    `\`!buy <type> [tier]\` — Buy potion\n` +
    `\`!heal\` — Restore 50 HP (80 coins)\n\n` +
    `🎲 **Roll Tiers:** Single(Lv1) → Double(Lv10) → Triple(Lv25) → Quad(Lv50)`
  );
}

// ============================================================
//  !stats
// ============================================================
if (cmd === "stats") {
  const w    = getEquipped(player);
  const wl   = w ? weaponLabel(w) : "None — use `!equip #id`";
  const xpF  = Math.round((player.xp / player.xpNeeded) * 10);
  const xpD  = `[${"█".repeat(xpF)}${"░".repeat(10 - xpF)}] ${player.xp}/${player.xpNeeded}`;
  const tier = ROLL_TIER_NAMES[player.rollTier];
  const nextTierEntry = Object.entries(ROLL_TIER_LEVELS).find(([t]) => +t > player.rollTier);
  const tierLine = nextTierEntry
    ? `${ROLL_TIER_EMOJI[player.rollTier]} **${tier} Roll** | Next: ${ROLL_TIER_NAMES[+nextTierEntry[0]]} at Lv${nextTierEntry[1]}`
    : `${ROLL_TIER_EMOJI[player.rollTier]} **${tier} Roll** (MAX)`;
  return message.reply(
    `📊 **${message.author.username}'s Stats**\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `❤️ HP: \`${hpBar(player.hp, player.maxHp)}\`\n` +
    `⬆️ Level: **${player.level}** | XP: \`${xpD}\`\n` +
    `🪙 Coins: **${player.coins.toLocaleString()}**\n` +
    `${tierLine}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `⚔️ ${wl}\n` +
    `━━━━━━━━━━━━━━━━`
  );
}

// ============================================================
//  !leaderboard
// ============================================================
if (cmd === "leaderboard") {
  const players = Object.entries(data)
    .filter(([k]) => k !== "_serial")
    .map(([id, p]) => ({ id, level: p.level||1, coins: p.coins||0 }))
    .sort((a, b) => b.level - a.level || b.coins - a.coins)
    .slice(0, 10);
  const medals = ["🥇","🥈","🥉"];
  const lines  = players.map((p, i) =>
    `${medals[i]||`**${i+1}.**`} <@${p.id}> — Lv**${p.level}** | 🪙 ${p.coins.toLocaleString()}`
  ).join("\n");
  return message.reply(`🏆 **Leaderboard**\n${lines}`);
}

// ============================================================
//  !roll
// ============================================================
if (cmd === "roll") {
  const cdMsg = checkCooldown(message.author.id, "roll");
  if (cdMsg) return message.reply(cdMsg);

  updateRollTier(player);
  const luckMult = getBoost(player, "luck");
  const count    = player.rollTier;
  const results  = [];

  for (let i = 0; i < count; i++) {
    const rarity  = rollRarity(luckMult);
    const variant = rollVariant();
    const pool    = weaponPool[rarity];
    const name    = pool[Math.floor(Math.random() * pool.length)];
    const w       = buildWeapon(rarity, variant, name);
    player.inventory[w.serial] = w;
    results.push(w);
  }
  save();

  const cdSec     = COOLDOWNS.roll / 1000;
  const emojiLine = results.map(w => `${w.emoji}${variantEmoji[w.variant]||""}`).join(" ");
  const details   = results.map(w =>
    `  ${rarityEmoji[w.rarity]} \`#${w.serial}\` **${w.variant} ${w.rarity} ${w.name}** ⚔️${weaponAtk(w)} | ${w.element}`
  ).join("\n");

  return message.reply(
    `📦 **${message.author.username}**, you opened a weapon crate! [${count}/${count}]\n` +
    `\`RESETS IN: ${cdSec}S\`\n\n` +
    `${emojiLine}\n\n` +
    `${details}`
  );
}

// ============================================================
//  !inv
// ============================================================
if (cmd === "inv") {
  const items = Object.values(player.inventory).filter(isValidWeapon);
  if (!items.length) return message.reply("🎒 Your inventory is empty. Try `!roll`!");

  const page    = Math.max(1, parseInt(args[0]) || 1);
  const perPage = 16;
  const total   = Math.ceil(items.length / perPage);
  const slice   = items.slice((page - 1) * perPage, page * perPage);

  const rows = [];
  for (let i = 0; i < slice.length; i += 4) {
    const row = slice.slice(i, i + 4).map(w => {
      const eq  = player.equippedId === w.serial ? "✅" : "";
      const lvS = toSup(w.level);
      return `\`${w.serial}\`${w.emoji}${lvS}${eq}`;
    }).join("  ");
    rows.push(row);
  }

  return message.reply(
    `\`══ ${message.author.username}'s Inventory [${items.length} weapons] ══\`\n` +
    rows.join("\n") +
    `\n\n📄 Page **${page}/${total}** — use \`!inv ${Math.min(page+1,total)}\` for next\n` +
    `⚔️ Equipped: \`#${player.equippedId || "none"}\` | Use \`!weaponinfo #id\` for details`
  );
}

// ============================================================
//  !equip
// ============================================================
if (cmd === "equip") {
  const id = args[0] ? args[0].replace("#","") : null;
  if (!id || !player.inventory[id]) return message.reply("❌ Weapon not found. Use `!equip #id`");
  player.equippedId = id;
  save();
  return message.reply(`✅ Equipped!\n${weaponLabel(player.inventory[id])}`);
}

// ============================================================
//  !equipbest
// ============================================================
if (cmd === "equipbest") {
  const items = Object.values(player.inventory).filter(isValidWeapon);
  if (!items.length) return message.reply("🎒 No weapons!");
  const best = items.reduce((a, b) => weaponAtk(a) >= weaponAtk(b) ? a : b);
  player.equippedId = best.serial;
  save();
  return message.reply(`✅ Auto-equipped your strongest:\n${weaponLabel(best)}`);
}

// ============================================================
//  !weapon
// ============================================================
if (cmd === "weapon") {
  const w = getEquipped(player);
  if (!w) return message.reply("❌ No weapon equipped. Use `!equip #id`");
  const rune = player.weaponRunes[w.serial] || "None";
  return message.reply(`⚔️ **Equipped Weapon**\n${weaponLabel(w, true)}\n🔮 Rune: **${rune}**`);
}

// ============================================================
//  !weaponinfo
// ============================================================
if (cmd === "weaponinfo") {
  const rawId = args[0] ? args[0].replace("#","") : player.equippedId;
  if (!rawId || !player.inventory[rawId]) return message.reply("❌ Weapon not found.");
  const w     = player.inventory[rawId];
  if (!w.xp)   w.xp = 0;
  const maxLv = weaponMaxLevel[w.rarity] || 10;
  const rune  = player.weaponRunes[w.serial] || "None";
  const cost  = w.level >= maxLv ? "MAX" : weaponUpgradeCost(w).toLocaleString();
  const curA  = weaponAtk(w);
  const nxtA  = w.level < maxLv ? Math.floor(w.atk * (1 + w.level * 0.15)) : curA;
  return message.reply(
    `⚔️ **Weapon Info**\n${weaponLabel(w)}\n\n` +
    `📊 **Progress:** ${weaponXpBar(w)}\n` +
    `⚔️ ATK now: **${curA}** → next lv: **${nxtA}**\n` +
    `🪙 Upgrade cost: **${cost}** coins | Max: **Lv${maxLv}**\n` +
    `🔮 Rune: **${rune}**`
  );
}

// ============================================================
//  !upgrade
// ============================================================
if (cmd === "upgrade") {
  const id = args[0] ? args[0].replace("#","") : null;
  if (!id || !player.inventory[id]) return message.reply("❌ Weapon not found. Use `!upgrade #id`");
  const w     = player.inventory[id];
  if (!w.xp)    w.xp    = 0;
  if (!w.level) w.level = 1;
  const maxLv = weaponMaxLevel[w.rarity] || 10;
  if (w.level >= maxLv) return message.reply(`✅ **${w.name}** is already MAX level!\n${weaponLabel(w, true)}`);
  const cost = weaponUpgradeCost(w);
  if (cost > 0 && player.coins < cost) return message.reply(`❌ Need **${cost}** coins. You have **${player.coins}**.\n${weaponLabel(w, true)}`);
  if (cost > 0) player.coins -= cost;
  const xpGain = Math.floor(20 * (rarityXpMult[w.rarity] || 1));
  const result = addWeaponXP(w, xpGain);
  save();
  if (result) return message.reply(`⬆️ **${w.name}** ${result}\n🪙 -${cost} coins | ✨ +${xpGain} XP\n${weaponLabel(w, true)}`);
  return message.reply(`📈 **${w.name}** gained **${xpGain} XP**!\n🪙 -${cost} coins\n${weaponLabel(w, true)}`);
}

// ============================================================
//  !cleaninv
// ============================================================
if (cmd === "cleaninv") {
  const before = Object.keys(player.inventory).length;
  for (const [id, w] of Object.entries(player.inventory)) { if (!isValidWeapon(w)) delete player.inventory[id]; }
  if (player.equippedId && !player.inventory[player.equippedId]) player.equippedId = null;
  save();
  return message.reply(`🧹 Removed **${before - Object.keys(player.inventory).length}** invalid item(s).`);
}

// ============================================================
//  !fight
// ============================================================
if (cmd === "fight") {
  const cdMsg = checkCooldown(message.author.id, "fight");
  if (cdMsg) return message.reply(cdMsg);
  if (player.hp <= 0) return message.reply("💀 You're dead! Use `!heal` first.");

  const w   = getEquipped(player);
  let   atk = w ? weaponAtk(w) : 5;
  atk += player.level * 2;

  let critHit = false, doubleHit = false;
  if (w) {
    const rune = player.weaponRunes[w.serial];
    if (rune === "crit"   && Math.random() < 0.2) { atk *= 2; critHit = true; }
    if (rune === "double" && Math.random() < 0.1) { atk *= 2; doubleHit = true; }
    if (rune === "flame")                           atk += 20;
    if (rune === "guard"  && Math.random() < 0.15) {
      save();
      return message.reply("🛡️ Your **guard** rune blocked the enemy! No damage taken.");
    }
  }
  atk = Math.floor(atk * getBoost(player, "damage"));

  const mob    = scaledMob(player.level);
  const result = simulateFight(atk, player.hp, mob);

  if (w && player.weaponRunes[w.serial] === "lifesteal") {
    const heal = Math.floor(atk * 0.1 * result.turns);
    player.hp  = Math.min(player.maxHp, player.hp + heal);
  }

  const wName    = w ? `${w.emoji} ${w.name}` : "🤜 Fists";
  const runeTag  = w && player.weaponRunes[w.serial] ? ` 🔮${player.weaponRunes[w.serial]}` : "";
  const critTag  = critHit ? " 💥CRIT!" : doubleHit ? " 💥DOUBLE!" : "";
  const shownLog = result.log.slice(-3);
  const turnLines = shownLog.map(t =>
    `  T${t.turn}: ⚔️ You deal **${t.pDmg}** | ${mob.emoji} deals **${t.eDmg}**`
  ).join("\n");

  if (result.win) {
    let coins = Math.floor(Math.random() * (mob.maxCoins - mob.minCoins) + mob.minCoins);
    coins = Math.floor(coins * getBoost(player, "coins"));
    player.coins += coins;
    player.hp     = Math.min(player.maxHp, player.hp + 10);
    addXP(player, mob.xp, message);
    save();
    return message.reply(
      `⚔️ **${message.author.username} goes into battle!**\n` +
      `\`${message.author.username}\` ${wName}${runeTag}${critTag}  vs  ${mob.emoji} **${mob.name}**\n\n` +
      `${turnLines}\n\n` +
      `**Won in ${result.turns} turn(s)!** | 🪙 +${coins} | ✨ +${mob.xp} XP\n` +
      `❤️ HP: \`${hpBar(player.hp, player.maxHp)}\``
    );
  } else {
    const hpLoss   = player.hp - Math.max(0, result.hpLeft);
    const coinLoss = Math.floor(player.coins * 0.1);
    player.hp      = Math.max(0, result.hpLeft);
    player.coins  -= coinLoss;
    save();
    return message.reply(
      `⚔️ **${message.author.username} goes into battle!**\n` +
      `\`${message.author.username}\` ${wName}${runeTag}  vs  ${mob.emoji} **${mob.name}**\n\n` +
      `${turnLines}\n\n` +
      `**Lost in ${result.turns} turn(s)!** | ❤️ -${hpLoss} HP | 🪙 -${coinLoss}\n` +
      `❤️ HP: \`${hpBar(player.hp, player.maxHp)}\``
    );
  }
}

// ============================================================
//  !boss
// ============================================================
if (cmd === "boss") {
  if (!globalBoss) return message.reply("❌ No boss active right now!");
  if (player.hp <= 0) return message.reply("💀 You're dead! Use `!heal` first.");
  const cdMsg = checkCooldown(message.author.id, "boss");
  if (cdMsg) return message.reply(cdMsg);

  const w   = getEquipped(player);
  let   dmg = w ? weaponAtk(w) : 5;
  dmg += player.level * 2;
  dmg  = Math.floor(dmg * (0.8 + Math.random() * 0.6) * getBoost(player, "damage"));

  globalBoss.attackers[message.author.id] = (globalBoss.attackers[message.author.id] || 0) + dmg;
  globalBoss.hp = Math.max(0, globalBoss.hp - dmg);

  if (globalBoss.hp <= 0) {
    const reward   = globalBoss.reward;
    const bossName = globalBoss.name;
    player.coins   += reward;
    player.hasChest = true;
    player.hp       = Math.min(player.maxHp, player.hp + 20);
    addXP(player, globalBoss.xp || 200, message);
    globalBoss = null;
    save();
    return message.reply(
      `👑 **${bossName} Defeated!**\n` +
      `💥 Killing blow: **${dmg}** dmg!\n` +
      `🪙 +${reward} coins | 📦 Chest earned!\n` +
      `❤️ HP: \`${hpBar(player.hp, player.maxHp)}\``
    );
  }
  save();
  return message.reply(
    `💥 Hit **${globalBoss.name}** for **${dmg}** dmg!\n` +
    `${tierEmoji[globalBoss.tier||"Normal"]} Boss HP: \`${bossTierBar(globalBoss.hp, globalBoss.maxHp)}\``
  );
}

// ============================================================
//  !bossinfo
// ============================================================
if (cmd === "bossinfo") {
  if (!globalBoss) return message.reply("❌ No boss active right now.");
  return message.reply(
    `${tierEmoji[globalBoss.tier||"Normal"]} **${globalBoss.name}** [${globalBoss.tier||"Normal"}]\n` +
    `❤️ \`${bossTierBar(globalBoss.hp, globalBoss.maxHp)}\`\n` +
    `🪙 Reward: **${globalBoss.reward.toLocaleString()}** coins + 📦 chest`
  );
}

// ============================================================
//  !duel
// ============================================================
if (cmd === "duel") {
  const target = message.mentions.users.first();
  if (!target)                         return message.reply("❌ Mention a user: `!duel @user`");
  if (target.id === message.author.id) return message.reply("❌ You can't duel yourself!");
  const enemy = getPlayer(target.id);
  if (player.hp <= 0) return message.reply("💀 You're dead! Use `!heal` first.");
  if (enemy.hp  <= 0) return message.reply(`❌ ${target.username} is dead and can't duel.`);

  const w1 = getEquipped(player), w2 = getEquipped(enemy);
  const a1 = ((w1 ? weaponAtk(w1) : 5) + player.level * 2) * (0.8 + Math.random() * 0.4);
  const a2 = ((w2 ? weaponAtk(w2) : 5) + enemy.level  * 2) * (0.8 + Math.random() * 0.4);
  const prize = Math.min(500, Math.floor(Math.max(enemy.coins, player.coins) * 0.1));

  const uName = message.author.username;
  const eName = target.username;
  const uW    = w1 ? `${w1.emoji} ${w1.name}` : "🤜 Fists";
  const eW    = w2 ? `${w2.emoji} ${w2.name}` : "🤜 Fists";

  if (a1 > a2) {
    player.coins += prize; enemy.coins -= prize;
    enemy.hp = Math.max(0, enemy.hp - Math.floor(20 + Math.random() * 20));
    addXP(player, 50, message);
    save();
    return message.reply(
      `⚔️ **PVP Battle!**\n` +
      `\`${uName}\` ${uW} [Lv${player.level}] **${Math.floor(a1)}** score\n` +
      `\`${eName}\` ${eW} [Lv${enemy.level}] **${Math.floor(a2)}** score\n\n` +
      `🏆 **${uName} wins!** Stole **${prize}** coins from ${eName}\n✨ +50 XP`
    );
  } else {
    enemy.coins += prize; player.coins -= prize;
    player.hp = Math.max(0, player.hp - Math.floor(20 + Math.random() * 20));
    save();
    return message.reply(
      `⚔️ **PVP Battle!**\n` +
      `\`${uName}\` ${uW} [Lv${player.level}] **${Math.floor(a1)}** score\n` +
      `\`${eName}\` ${eW} [Lv${enemy.level}] **${Math.floor(a2)}** score\n\n` +
      `💀 **${eName} wins!** ${uName} lost **${prize}** coins`
    );
  }
}

// ============================================================
//  !raid
// ============================================================
if (cmd === "raid") {
  const sub = args[0];

  if (sub === "start") {
    if (activeRaid) return message.reply("❌ A raid is already active! Use `!raid join` or `!raid status`.");
    if (player.hp <= 0) return message.reply("💀 You're dead! Use `!heal` first.");
    const boss = raidBossPool[Math.floor(Math.random() * raidBossPool.length)];
    activeRaid = {
      ...boss, hp: boss.maxHp, channelId: message.channel.id, phase:"joining",
      joinDeadline: Date.now() + RAID_JOIN_WINDOW,
      players: { [message.author.id]: { dmgDealt:0, attacked:false, username: message.author.username } }
    };
    scheduleRaidExpiry(RAID_JOIN_WINDOW, "No one joined in time.");
    return message.reply(
      `⚔️ **RAID STARTED!**\n` +
      `👹 **${boss.name}** appears!\n` +
      `❤️ \`${raidHpBar(boss.maxHp, boss.maxHp)}\`\n` +
      `🪙 ${boss.reward} coins | ✨ ${boss.xp} XP per player\n\n` +
      `📢 **60 seconds** to join with \`!raid join\`!\n` +
      `Then use \`!raid attack\` to fight!`
    );
  }

  if (sub === "join") {
    if (!activeRaid)                           return message.reply("❌ No active raid. Start with `!raid start`!");
    if (activeRaid.phase !== "joining")        return message.reply("❌ Joining is closed — raid is already fighting!");
    if (activeRaid.players[message.author.id]) return message.reply("✅ You're already in this raid!");
    if (player.hp <= 0)                        return message.reply("💀 You're dead! Use `!heal` first.");
    activeRaid.players[message.author.id] = { dmgDealt:0, attacked:false, username: message.author.username };
    const count = Object.keys(activeRaid.players).length;
    return message.reply(`✅ **${message.author.username}** joined! 👥 ${count} raiders total. Use \`!raid attack\`!`);
  }

  if (sub === "attack") {
    if (!activeRaid)                             return message.reply("❌ No active raid.");
    if (!activeRaid.players[message.author.id])  return message.reply("❌ You're not in this raid! Use `!raid join`.");
    if (player.hp <= 0)                          return message.reply("💀 You're dead!");
    const rp = activeRaid.players[message.author.id];
    if (rp.attacked)                             return message.reply("⏳ Already attacked this round! Wait for others.");
    if (activeRaid.phase === "joining") { activeRaid.phase = "fighting"; scheduleRaidExpiry(RAID_ATTACK_WINDOW, "Raiders took too long."); }

    const w   = getEquipped(player);
    let   dmg = w ? weaponAtk(w) : 5;
    dmg += player.level * 2;
    dmg  = Math.floor(dmg * (0.7 + Math.random() * 0.6) * getBoost(player, "damage"));
    if (w) {
      const rune = player.weaponRunes[w.serial];
      if (rune === "crit"   && Math.random() < 0.2) dmg *= 2;
      if (rune === "double" && Math.random() < 0.1) dmg *= 2;
      if (rune === "flame")                          dmg += 20;
    }
    dmg = Math.floor(dmg);
    rp.attacked = true; rp.dmgDealt += dmg;
    activeRaid.hp = Math.max(0, activeRaid.hp - dmg);

    if (activeRaid.hp <= 0) {
      const participants = Object.entries(activeRaid.players);
      const totalDmg     = participants.reduce((s,[,p2])=>s+p2.dmgDealt, 0);
      const lines = [`🏆 **RAID VICTORY! ${activeRaid.name} has been slain!**\n📊 **Damage Breakdown:**`];
      for (const [uid, rp2] of participants) {
        const rp2p  = getPlayer(uid);
        const share = totalDmg > 0 ? rp2.dmgDealt / totalDmg : 1/participants.length;
        const cRew  = Math.floor(activeRaid.reward * (0.5 + share * participants.length * 0.5));
        const xRew  = Math.floor(activeRaid.xp     * (0.5 + share * participants.length * 0.5));
        rp2p.coins += cRew; rp2p.hasChest = true; rp2p.hp = Math.min(rp2p.maxHp, rp2p.hp+30);
        rp2p.xp += xRew;
        while (rp2p.xp >= rp2p.xpNeeded) { rp2p.xp-=rp2p.xpNeeded; rp2p.level++; rp2p.xpNeeded=Math.floor(rp2p.xpNeeded*1.4); rp2p.maxHp+=20; rp2p.hp=rp2p.maxHp; }
        lines.push(`  ${rp2.username} — 💥${rp2.dmgDealt} (${Math.round(share*100)}%) | 🪙+${cRew} | ✨+${xRew} | 📦chest`);
      }
      save(); activeRaid.phase="ended"; activeRaid=null;
      return message.reply(lines.join("\n"));
    }

    const allAttacked = Object.values(activeRaid.players).every(p2=>p2.attacked);
    if (allAttacked) {
      const bossDmg = Math.floor(30 + Math.random()*40);
      const lines = [`💥 **${message.author.username}** dealt **${dmg}** dmg!\n👹 **${activeRaid.name}** counter-attacks! (-${bossDmg} HP to all)\n❤️ Boss: \`${raidHpBar(activeRaid.hp,activeRaid.maxHp)}\``];
      for (const [uid, rp2] of Object.entries(activeRaid.players)) {
        const rp2p = getPlayer(uid); rp2p.hp=Math.max(0,rp2p.hp-bossDmg); rp2.attacked=false;
        lines.push(`  ${rp2.username}: ❤️ ${rp2p.hp}/${rp2p.maxHp}`);
        if (rp2p.hp<=0) { lines.push(`  💀 **${rp2.username}** knocked out!`); delete activeRaid.players[uid]; }
      }
      if (Object.keys(activeRaid.players).length===0) {
        lines.push(`\n💀 **All raiders defeated! Raid failed.**`);
        save(); activeRaid.phase="ended"; activeRaid=null;
        return message.reply(lines.join("\n"));
      }
      lines.push(`\n⚔️ Use \`!raid attack\` to continue!`);
      save(); return message.reply(lines.join("\n"));
    }

    const attacked = Object.values(activeRaid.players).filter(p2=>p2.attacked).length;
    const total    = Object.keys(activeRaid.players).length;
    save();
    return message.reply(
      `💥 **${message.author.username}** dealt **${dmg}** dmg!\n` +
      `❤️ Boss: \`${raidHpBar(activeRaid.hp,activeRaid.maxHp)}\`\n` +
      `⏳ Waiting for **${total-attacked}** more raider(s)...`
    );
  }

  if (sub === "status") {
    if (!activeRaid) return message.reply("❌ No active raid. Start with `!raid start`!");
    const participants = Object.entries(activeRaid.players);
    const names = participants.map(([,p2])=>p2.attacked?`✅ ${p2.username}`:`⏳ ${p2.username}`).join("\n");
    const timeLeft = activeRaid.phase==="joining"
      ? `⏰ Joining closes in **${Math.max(0,Math.ceil((activeRaid.joinDeadline-Date.now())/1000))}s**`
      : `⚔️ Phase: **Fighting**`;
    return message.reply(
      `👹 **${activeRaid.name}**\n` +
      `❤️ \`${raidHpBar(activeRaid.hp,activeRaid.maxHp)}\`\n` +
      `${timeLeft}\n👥 **Raiders (${participants.length}):**\n${names}`
    );
  }

  if (sub === "leave") {
    if (!activeRaid)                               return message.reply("❌ No active raid.");
    if (!activeRaid.players[message.author.id])    return message.reply("❌ You're not in this raid.");
    delete activeRaid.players[message.author.id];
    if (Object.keys(activeRaid.players).length===0) { activeRaid.phase="ended"; activeRaid=null; return message.reply("👋 No raiders remain — raid disbanded."); }
    return message.reply(`👋 **${message.author.username}** left the raid.`);
  }

  return message.reply("Usage: `!raid start` | `!raid join` | `!raid attack` | `!raid status` | `!raid leave`");
}

// ============================================================
//  !chest
// ============================================================
if (cmd === "chest") {
  if (!player.hasChest) return message.reply("❌ No chest! Defeat the boss to earn one.");
  const rune = openChest(player);
  save();
  return message.reply(`📦 Chest opened! You got a **${rune}** rune!\nUse \`!rune equip #id ${rune}\` to attach it.`);
}

// ============================================================
//  !runes
// ============================================================
if (cmd === "runes") {
  const info = { crit:"20% chance ×2 dmg", double:"10% chance ×2 dmg", flame:"+20 flat dmg", lifesteal:"heal 10% dmg", guard:"15% block attack" };
  const list = Object.entries(player.runes).map(([r,c])=>`🔮 **${r}** ×${c} — *${info[r]}*`).join("\n");
  return message.reply(`🔮 **Your Runes**\n${list}`);
}

// ============================================================
//  !rune equip
// ============================================================
if (cmd === "rune") {
  if (args[0] !== "equip") return message.reply("Usage: `!rune equip #id <rune>`");
  const id   = args[1] ? args[1].replace("#","") : null;
  const rune = args[2];
  if (!id || !player.inventory[id])             return message.reply("❌ Weapon not found.");
  if (!rune || player.runes[rune] === undefined) return message.reply("❌ Invalid rune.");
  if (player.runes[rune] <= 0)                  return message.reply(`❌ You don't have a **${rune}** rune.`);
  player.runes[rune]--;
  player.weaponRunes[id] = rune;
  save();
  const w = player.inventory[id];
  return message.reply(`🔮 **${rune}** rune attached to ${w.emoji} **${w.name}** \`#${w.serial}\``);
}

// ============================================================
//  !shop
// ============================================================
if (cmd === "shop") {
  const earlyUnlock = player.rollTier < 2
    ? `\`!buy doubleroll\` — Unlock Double Roll early (Lv10 free) — **1000 coins**\n`
    : "";
  return message.reply(
    `🛒 **Potion Shop**\n\n` +
    `**Luck** (better weapon rarity rolls)\n` +
    `  \`!buy luck 1\` — ×1.5, 15min — 100 coins\n` +
    `  \`!buy luck 2\` — ×2, 10min — 200 coins\n` +
    `  \`!buy luck 3\` — ×3, 5min — 400 coins\n\n` +
    `**Damage**\n` +
    `  \`!buy damage 1\` — ×1.5, 15min — 100 coins\n` +
    `  \`!buy damage 2\` — ×2, 10min — 200 coins\n` +
    `  \`!buy damage 3\` — ×3, 5min — 400 coins\n\n` +
    `**Coin Boost** — ×1.5, 20min — 150 coins → \`!buy coins\`\n\n` +
    earlyUnlock +
    `❤️ **Heal** — +50 HP — 80 coins → \`!heal\`\n\n` +
    `🎲 **Roll Tiers** (auto-unlock by level)\n` +
    `  Double Roll → Lv10 | Triple → Lv25 | Quad → Lv50\n` +
    `  You are: **${ROLL_TIER_NAMES[player.rollTier]} Roll** ${ROLL_TIER_EMOJI[player.rollTier]}`
  );
}

// ============================================================
//  !buy
// ============================================================
if (cmd === "buy") {
  const type = args[0];
  const tier = parseInt(args[1]);

  if (type === "doubleroll") {
    if (player.rollTier >= 2) return message.reply("✅ You already have Double Roll or better!");
    if (player.coins < 1000)  return message.reply(`❌ Need 1000 coins (you have ${player.coins})`);
    player.coins -= 1000; player.rollTier = 2; save();
    return message.reply(`🎲🎲 **Double Roll unlocked early!** Every \`!roll\` now gives **2 weapons**!`);
  }

  if (!player.boosts[type]) return message.reply("❌ Invalid type. See `!shop`");
  const now = Date.now();
  let multi=1, duration=0, cost=0;
  if (type==="luck"||type==="damage") {
    if (tier===1){multi=1.5;duration=15;cost=100;}
    if (tier===2){multi=2;  duration=10;cost=200;}
    if (tier===3){multi=3;  duration=5; cost=400;}
  }
  if (type==="coins"){multi=1.5;duration=20;cost=150;}
  if (cost===0)          return message.reply("❌ Invalid tier. See `!shop`");
  if (player.coins<cost) return message.reply(`❌ Need **${cost}** coins (you have ${player.coins})`);
  player.coins -= cost;
  const boost = player.boosts[type];
  boost.expires = (boost.expires>now?boost.expires:now)+duration*60000;
  boost.multi   = multi;
  save();
  return message.reply(`🧪 **${type}** potion active! ×${multi} for ${duration} min`);
}

// ============================================================
//  !heal
// ============================================================
if (cmd === "heal") {
  if (player.coins < 80)          return message.reply(`❌ Need 80 coins (you have ${player.coins})`);
  if (player.hp === player.maxHp) return message.reply("❤️ Already at full HP!");
  player.coins -= 80;
  player.hp     = Math.min(player.maxHp, player.hp + 50);
  save();
  return message.reply(`💊 Healed +50 HP!\n❤️ HP: \`${hpBar(player.hp, player.maxHp)}\``);
}

// ============================================================
//  !admin
// ============================================================
if (cmd === "admin") {
  if (!isOwner(message.author.id)) return message.reply("❌ Owner only.");
  const sub    = args[0];
  const target = message.mentions.users.first() || message.author;
  const tp     = getPlayer(target.id);

  if (sub === "give") {
    const rarity = args[1];
    if (!weaponPool[rarity]) return message.reply("❌ Invalid rarity.");
    const pool    = weaponPool[rarity];
    const name    = pool[Math.floor(Math.random() * pool.length)];
    const variant = rarity === "Admin" ? "Void" : "Rainbow";
    const w       = buildWeapon(rarity, variant, name);
    tp.inventory[w.serial] = w; save();
    return message.reply(`⚔️ Gave **${rarity} ${w.name}** to **${target.username}**`);
  }

  if (sub === "coins") {
    const raw = (args[1]||"").toLowerCase();
    let amount = raw.endsWith("m")?parseFloat(raw)*1e6:raw.endsWith("k")?parseFloat(raw)*1000:parseInt(raw);
    if (isNaN(amount)||amount<=0) return message.reply("❌ Usage: `!admin coins <amount> [@user]` — supports 10k, 1m");
    amount=Math.floor(amount); tp.coins+=amount; save();
    return message.reply(`🪙 Gave **${amount.toLocaleString()}** coins to **${target.username}**`);
  }

  if (sub === "chest") {
    const amount = Math.max(1, parseInt(args[1])||1);
    const given  = [];
    for (let i=0;i<amount;i++) {
      const rand=Math.random()*100;
      const rune=rand<30?"flame":rand<55?"lifesteal":rand<75?"crit":rand<90?"guard":"double";
      tp.runes[rune]++; given.push(rune);
    }
    save();
    const summary=given.reduce((a,r)=>{a[r]=(a[r]||0)+1;return a;},{});
    return message.reply(`📦 Opened **${amount}** chest(s) for **${target.username}**:\n${Object.entries(summary).map(([r,c])=>`🔮 ${r} ×${c}`).join(" | ")}`);
  }

  if (sub === "rune") {
    const rune   = args[1];
    const amount = Math.max(1, parseInt(args[2])||1);
    if (!rune||tp.runes[rune]===undefined) return message.reply("❌ Invalid rune. Valid: crit, double, flame, lifesteal, guard");
    tp.runes[rune]+=amount; save();
    return message.reply(`🔮 Gave **${rune} ×${amount}** to **${target.username}**`);
  }

  if (sub === "setlevel") {
    const level=parseInt(args[1]);
    if (isNaN(level)||level<1||level>9999) return message.reply("❌ Usage: `!admin setlevel <level> [@user]`");
    tp.level=level; tp.maxHp=100+(level-1)*20; tp.hp=tp.maxHp;
    tp.xp=0; tp.xpNeeded=Math.floor(100*Math.pow(1.4,level-1));
    updateRollTier(tp); save();
    return message.reply(`⬆️ Set **${target.username}** to **Level ${level}** | Roll tier: ${ROLL_TIER_NAMES[tp.rollTier]}`);
  }

  if (sub === "maxweapon") {
    const id=args[1]?args[1].replace("#",""):null;
    if (!id) return message.reply("❌ Usage: `!admin maxweapon #id [@user]`");
    if (!tp.inventory[id]) return message.reply(`❌ Weapon \`#${id}\` not found in ${target.username}'s inventory.`);
    const w=tp.inventory[id]; w.level=weaponMaxLevel[w.rarity]||10; w.xp=0; save();
    return message.reply(`⚡ Maxed **${w.name}** for **${target.username}**!\n${weaponLabel(w,true)}`);
  }

  if (sub === "boss") {
    const name  =args[1]||"Void Overlord";
    const hp    =parseInt(args[2])||5000;
    const reward=parseInt(args[3])||5000;
    globalBoss  ={name,tier:"Admin",hp,maxHp:hp,reward,xp:5000,attackers:{}};
    return message.reply(`👹 **${name}** spawned! HP: ${hp.toLocaleString()} | Reward: ${reward.toLocaleString()} coins`);
  }

  if (sub === "max") {
    tp.level=100; tp.maxHp=9999; tp.hp=9999; tp.coins+=999999999; tp.xp=0; tp.xpNeeded=999999;
    tp.rollTier=4; save();
    return message.reply(`⚡ **${target.username}** is now in GOD MODE`);
  }

  if (sub === "reset") {
    delete data[target.id]; save();
    return message.reply(`🔄 Reset **${target.username}**'s data.`);
  }

  return message.reply(
    `👑 **Admin Commands**\n` +
    `\`!admin give <rarity> [@user]\`\n` +
    `\`!admin coins <amount> [@user]\` — supports 10k, 1m\n` +
    `\`!admin chest <amount> [@user]\`\n` +
    `\`!admin rune <rune> [amount] [@user]\`\n` +
    `\`!admin setlevel <level> [@user]\`\n` +
    `\`!admin maxweapon #id [@user]\`\n` +
    `\`!admin boss [name] [hp] [reward]\`\n` +
    `\`!admin max [@user]\`\n` +
    `\`!admin reset @user\``
  );
}

  } catch (err) {
    console.error("Command error:", err);
    message.reply("⚠️ Something went wrong. Please try again.").catch(() => {});
  }
});

client.once("ready", () => {
  console.log(`✅ Arsenal Arcane ready as ${client.user.tag}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
