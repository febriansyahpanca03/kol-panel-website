// Kirim pesan ke Telegram lewat bot milik pemilik dashboard.
//
// Env var: TELEGRAM_BOT_TOKEN (dari @BotFather) dan TELEGRAM_CHAT_ID (chat
// pribadi atau grup tujuan). Token hanya ada di server, tidak pernah di
// halaman.

export function telegramConfig() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    return token && chatId ? { token, chatId } : null;
}

export async function kirimTelegram(cfg, text) {
    const r = await fetch('https://api.telegram.org/bot' + cfg.token + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true })
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || out.ok === false) throw new Error(out.description || ('HTTP ' + r.status));
    return out;
}
