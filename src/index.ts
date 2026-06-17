/**
 * gateway-91 — Telegram join-gate bot on Cloudflare Workers.
 *
 * Flow:
 *   t.me/<bot>?start=join
 *     -> /start: ask for phone (request_contact)
 *     -> contact: verify it's the sender's own number AND +91 -> ask location
 *     -> location: verify inside India bbox -> mark verified
 *     -> issue a single-use invite link to the private group
 *
 * Group must be PRIVATE and the bot must be ADMIN with "Invite Users via Link".
 */

import { Bot, Context, Keyboard, webhookCallback } from "grammy";

interface Env {
	/** Bot token from @BotFather. Set with: wrangler secret put BOT_TOKEN */
	BOT_TOKEN: string;
	/** Header secret guarding the webhook. wrangler secret put WEBHOOK_SECRET */
	WEBHOOK_SECRET: string;
	/** Target group chat id, e.g. -1001234567890 (var in wrangler.jsonc). */
	GROUP_CHAT_ID: string;
	/** KV namespace storing per-user verification state. */
	VERIF: KVNamespace;
}

/** Per-user record persisted in KV. */
interface UserState {
	phone: string;
	lat: number;
	lng: number;
	verified: boolean;
	ts: number;
}

// India bounding box (approx). lat 6..37 N, lng 68..98 E.
const INDIA = { latMin: 6, latMax: 37, lngMin: 68, lngMax: 98 };

const isIndiaPhone = (raw: string): boolean => {
	const d = raw.replace(/\D/g, "");
	// Telegram shares Indian numbers as 91XXXXXXXXXX (12 digits, no +).
	return d.startsWith("91") && d.length === 12;
};

const inIndia = (lat: number, lng: number): boolean =>
	lat >= INDIA.latMin &&
	lat <= INDIA.latMax &&
	lng >= INDIA.lngMin &&
	lng <= INDIA.lngMax;

const phoneKeyboard = new Keyboard()
	.requestContact("📱 Share my phone number")
	.resized()
	.oneTime();

const locationKeyboard = new Keyboard()
	.requestLocation("📍 Share my location")
	.resized()
	.oneTime();

/**
 * Create an invite link that produces a JOIN REQUEST (not instant join).
 * Every tap is gated by the chat_join_request handler, which approves only
 * verified user_ids — so a leaked/shared link cannot get anyone in.
 */
async function issueInviteLink(ctx: Context, env: Env): Promise<string> {
	const link = await ctx.api.createChatInviteLink(env.GROUP_CHAT_ID, {
		creates_join_request: true,
		name: `gate:${ctx.from?.id ?? "unknown"}`,
	});
	return link.invite_link;
}

function buildBot(env: Env): Bot {
	const bot = new Bot(env.BOT_TOKEN);

	// Allow private-chat flow + group join requests; ignore other group chatter.
	bot.use(async (ctx, next) => {
		if (ctx.chatJoinRequest) return next();
		if (ctx.chat?.type === "private") return next();
		// ignore everything else
	});

	// The actual gate: approve a join request only if the user is verified.
	bot.on("chat_join_request", async (ctx) => {
		const req = ctx.chatJoinRequest;
		if (String(req.chat.id) !== String(env.GROUP_CHAT_ID)) return;
		const state = await env.VERIF.get<UserState>(`user:${req.from.id}`, "json");
		if (state?.verified) {
			await ctx.api.approveChatJoinRequest(req.chat.id, req.from.id);
		} else {
			await ctx.api.declineChatJoinRequest(req.chat.id, req.from.id);
		}
	});

	bot.command("start", async (ctx) => {
		const id = String(ctx.from!.id);
		const existing = await env.VERIF.get<UserState>(`user:${id}`, "json");
		if (existing?.verified) {
			const link = await issueInviteLink(ctx, env);
			await ctx.reply(`✅ Already verified.\n\nTap to join (auto-approved):\n${link}`, {
				reply_markup: { remove_keyboard: true },
			});
			return;
		}
		await ctx.reply(
			"Welcome 👋\n\nTo join the group you must verify:\n1️⃣ Phone number (must be +91 / India)\n2️⃣ Your location (must be in India)\n\nTap the button below to share your phone.",
			{ reply_markup: phoneKeyboard },
		);
	});

	// Step 1: contact.
	bot.on("message:contact", async (ctx) => {
		const contact = ctx.message.contact;
		// Anti-spoof: the shared contact must belong to the sender.
		if (contact.user_id !== ctx.from.id) {
			await ctx.reply("❌ Share your *own* number, not someone else's.", {
				parse_mode: "Markdown",
				reply_markup: phoneKeyboard,
			});
			return;
		}
		if (!isIndiaPhone(contact.phone_number)) {
			await ctx.reply("❌ Only +91 (India) numbers are allowed. Access denied.", {
				reply_markup: { remove_keyboard: true },
			});
			return;
		}
		const id = String(ctx.from.id);
		await env.VERIF.put(
			`user:${id}`,
			JSON.stringify({
				phone: contact.phone_number,
				lat: 0,
				lng: 0,
				verified: false,
				ts: Date.now(),
			} satisfies UserState),
		);
		await ctx.reply("✅ Phone OK.\n\nNow share your location.", {
			reply_markup: locationKeyboard,
		});
	});

	// Step 2: location.
	bot.on("message:location", async (ctx) => {
		const id = String(ctx.from.id);
		const state = await env.VERIF.get<UserState>(`user:${id}`, "json");
		if (!state || !state.phone) {
			await ctx.reply("Start with /start and share your phone first.", {
				reply_markup: phoneKeyboard,
			});
			return;
		}
		const { latitude, longitude } = ctx.message.location;
		if (!inIndia(latitude, longitude)) {
			await ctx.reply("❌ Location is outside India. Access denied.", {
				reply_markup: { remove_keyboard: true },
			});
			return;
		}
		state.lat = latitude;
		state.lng = longitude;
		state.verified = true;
		state.ts = Date.now();
		await env.VERIF.put(`user:${id}`, JSON.stringify(state));

		const link = await issueInviteLink(ctx, env);
		await ctx.reply(
			`✅ Verified!\n\nTap to request to join — you'll be approved instantly:\n${link}`,
			{ reply_markup: { remove_keyboard: true } },
		);
	});

	// Nudge anything else back into the flow.
	bot.on("message", async (ctx) => {
		await ctx.reply("Tap a button below, or send /start to begin.", {
			reply_markup: phoneKeyboard,
		});
	});

	return bot;
}

// Cache the bot across requests within the same isolate (init getMe only once).
let cachedBot: Bot | undefined;

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/") {
			return new Response("gateway-91 ok");
		}

		// One-time helper to register the webhook (and the non-default
		// chat_join_request update). Guard with ?secret=<WEBHOOK_SECRET>.
		if (request.method === "GET" && url.pathname === "/registerWebhook") {
			const e = env as unknown as Env;
			if (url.searchParams.get("secret") !== e.WEBHOOK_SECRET) {
				return new Response("forbidden", { status: 403 });
			}
			if (!cachedBot) cachedBot = buildBot(e);
			const hookUrl = `${url.origin}/webhook`;
			await cachedBot.api.setWebhook(hookUrl, {
				secret_token: e.WEBHOOK_SECRET,
				allowed_updates: ["message", "chat_join_request"],
			});
			return new Response(`webhook set -> ${hookUrl}`);
		}

		if (url.pathname === "/webhook") {
			if (!cachedBot) cachedBot = buildBot(env as unknown as Env);
			if (!cachedBot.isInited()) await cachedBot.init();
			return webhookCallback(cachedBot, "cloudflare-mod", {
				secretToken: (env as unknown as Env).WEBHOOK_SECRET,
			})(request);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
