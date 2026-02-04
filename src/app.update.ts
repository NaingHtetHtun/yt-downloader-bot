import { Update, Start, On, Ctx, Action } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import * as fs from 'fs';
import { DownloaderService } from './downloader/downloader.service';

const TELEGRAM_MAX_FILE_MB = Number(process.env.TELEGRAM_MAX_FILE_MB ?? 50);
const TELEGRAM_MAX_FILE_BYTES = TELEGRAM_MAX_FILE_MB * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

@Update()
export class AppUpdate {
  constructor(private readonly downloaderService: DownloaderService) {}
  private readonly callbackStore = new Map<
    string,
    { url: string; createdAt: number }
  >();
  private readonly callbackTtlMs = 10 * 60 * 1000;

  private createCallbackKey(url: string): string {
    const key = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    this.callbackStore.set(key, { url, createdAt: Date.now() });
    return key;
  }

  private getCallbackUrl(key: string): string | null {
    const entry = this.callbackStore.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.callbackTtlMs) {
      this.callbackStore.delete(key);
      return null;
    }
    return entry.url;
  }

  private cleanupCallbacks() {
    const now = Date.now();
    for (const [key, value] of this.callbackStore.entries()) {
      if (now - value.createdAt > this.callbackTtlMs) {
        this.callbackStore.delete(key);
      }
    }
  }

  @Start()
  async startCommand(@Ctx() ctx: Context) {
    await ctx.reply(
      'YouTube Downloader Bot မှ ကြိုဆိုပါတယ်! \nLink တစ်ခု ပို့ပေးပါ။',
    );
  }

  @On('text')
  async onMessage(@Ctx() ctx: Context) {
    if (ctx.message && 'text' in ctx.message) {
      const url = ctx.message.text;
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        try {
          const info = await this.downloaderService.getVideoInfo(url);
          this.cleanupCallbacks();
          const key = this.createCallbackKey(url);

          await ctx.reply(
            `ဗီဒီယို: ${info.title}\nကြာချိန်: ${info.duration}\n\nQuality ရွေးချယ်ပေးပါ -`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback('720p Video', `dl_720_${key}`),
                Markup.button.callback('360p Video', `dl_360_${key}`),
              ],
              [Markup.button.callback('MP3 Audio', `dl_mp3_${key}`)],
            ]),
          );
        } catch (e: any) {
          console.log(e);
          const message =
            e instanceof Error && e.message ? e.message : 'Video ရှာမတွေ့ပါ။';
          await ctx.reply(`Error: ${message}`);
        }
      }
    }
  }
  @Action(/^dl_(.+)_(.+)$/)
  async onDownload(@Ctx() ctx: Context) {
    // ၁။ ctx.chat နဲ့ callback query ရှိမရှိကို Type Guard အနေနဲ့ အရင်စစ်မယ်
    if (!ctx.chat || !ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
      return;
    }

    const data = ctx.callbackQuery.data;
    const parts = data.split('_');
    const [, quality, key] = parts;
    const url = this.getCallbackUrl(key);
    if (!url) {
      try {
        await ctx.answerCbQuery('ဒီ link က အချိန်ကျော်သွားပါပြီ။');
      } catch (err) {
        // Callback might be expired or already answered; ignore to avoid crashing.
        console.warn('answerCbQuery failed (expired callback).', err);
      }
      await ctx.reply('ဒီ link က အချိန်ကျော်သွားပါပြီ။ ပြန်လည်ပို့ပေးပါ။');
      return;
    }

    try {
      await ctx.answerCbQuery('ဒေါင်းလုဒ်ဆွဲနေပါပြီ...');
    } catch (err) {
      // Callback might be expired or already answered; ignore to avoid crashing.
      console.warn('answerCbQuery failed (expired callback).', err);
    }

    // ၂။ 'as any' သို့မဟုတ် 'as Message.TextMessage' သုံးပြီး type ကို casting လုပ်ပေးပါ
    const statusMsg = await ctx.editMessageText(
      'ဗီဒီယိုအချက်အလက်များကို စစ်ဆေးနေသည်...',
    );

    try {
      const videoInfo = await this.downloaderService.getVideoInfo(url);

      // ၃။ statusMsg ထဲမှာ message_id တကယ်ပါလာမှ edit လုပ်မယ်
      if (typeof statusMsg === 'object' && 'message_id' in statusMsg) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `📥 "${videoInfo.title}" ကို ဒေါင်းလုဒ်ဆွဲနေပါသည်။`,
        );
      }
      const filePath = await this.downloaderService.downloadVideo(
        url,
        quality,
        videoInfo.title,
      );

      const fileSize = fs.statSync(filePath).size;
      if (fileSize > TELEGRAM_MAX_FILE_BYTES) {
        await ctx.reply(
          `ဖိုင်အရွယ်အစား ${formatBytes(
            fileSize,
          )} ဖြစ်လို့ Telegram Bot API က ပို့ခွင့်မပြုပါ။ ` +
            `လက်ရှိ bot အတွက် ခွင့်ပြုထားတဲ့ အများဆုံးက ${formatBytes(
              TELEGRAM_MAX_FILE_BYTES,
            )} ပါ။\n\n` +
            `နိမ့်တဲ့ quality ကို ရွေးပါ၊ ဒါမှမဟုတ် external link (Drive/Cloud) ပို့တဲ့နည်းကို သုံးပါ။`,
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return;
      }

      // File ပို့တဲ့အပိုင်း
      if (quality === 'mp3') {
        await ctx.replyWithAudio(
          { source: fs.createReadStream(filePath) },
          { title: videoInfo.title },
        );
      } else {
        await ctx.replyWithVideo(
          { source: fs.createReadStream(filePath) },
          { caption: `✅ ${videoInfo.title}` },
        );
      }

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Download Action Error:', error);
      const message = error instanceof Error ? error.message : '';
      if (message === 'MAX_FILESIZE') {
        await ctx.reply(
          `Telegram Bot API က ${formatBytes(
            TELEGRAM_MAX_FILE_BYTES,
          )} ထက်ကြီးတဲ့ဖိုင်ကို မပို့ခွင့်ပေးပါ။ ` +
            `နိမ့်တဲ့ quality ရွေးပါ၊ ဒါမှမဟုတ် external link (Drive/Cloud) ပို့ပါ။`,
        );
        return;
      }
      if (message === 'FILENAME_TOO_LONG') {
        await ctx.reply(
          'ဖိုင်နာမည်က အရမ်းရှည်နေပါတယ်။ စနစ်က မဖန်တီးနိုင်လို့ မအောင်မြင်ပါ။ ' +
            'ကျွန်ုပ်က အတိုချုံ့ပေးထားပြီး ပြန်လည်ဒေါင်းလုဒ်လုပ်ပေးပါ။',
        );
        return;
      }
      await ctx.reply(
        message
          ? `ဒေါင်းလုဒ်ဆွဲရာမှာ အမှားရှိပါတယ်: ${message}`
          : 'ဒေါင်းလုဒ်ဆွဲရာမှာ အမှားအယွင်းရှိသွားပါတယ်။',
      );
    }
  }
}
