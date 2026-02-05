import { Update, Start, On, Ctx, Action, Command } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import * as fs from 'fs';
import { DownloaderService } from './downloader/downloader.service';
import { MovieService, MovieSearchItem } from './movie/movie.service';

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
  constructor(
    private readonly downloaderService: DownloaderService,
    private readonly movieService: MovieService,
  ) {}
  private readonly callbackStore = new Map<
    string,
    { url: string; createdAt: number }
  >();
  private readonly callbackTtlMs = 10 * 60 * 1000;
  private readonly movieStore = new Map<
    number,
    { query: string; items: MovieSearchItem[]; createdAt: number }
  >();
  private readonly movieTtlMs = 10 * 60 * 1000;

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
  private cleanupMovieStore() {
    const now = Date.now();
    for (const [key, value] of this.movieStore.entries()) {
      if (now - value.createdAt > this.movieTtlMs) {
        this.movieStore.delete(key);
      }
    }
  }

  private isYouTubeUrl(url: string): boolean {
    return url.includes('youtube.com') || url.includes('youtu.be');
  }

  private isTikTokUrl(url: string): boolean {
    return (
      url.includes('tiktok.com') ||
      url.includes('vm.tiktok.com') ||
      url.includes('vt.tiktok.com')
    );
  }
  private isTikTokPhotoUrl(url: string): boolean {
    return this.isTikTokUrl(url) && url.includes('/photo/');
  }

  @Start()
  async startCommand(@Ctx() ctx: Context) {
    await ctx.reply(
      'YouTube/TikTok Downloader Bot မှ ကြိုဆိုပါတယ်! \nLink တစ်ခု ပို့ပေးပါ။\n/help မှာ အသေးစိတ်ကြည့်နိုင်ပါတယ်။',
    );
  }

  @Command('help')
  async helpCommand(@Ctx() ctx: Context) {
    await ctx.reply(
      [
        'အသုံးပြုနည်း',
        '- YouTube/TikTok link တစ်ခုကို တိုက်ရိုက်ပို့ပါ။',
        '- Quality / Audio ကို ခလုတ်နဲ့ ရွေးပါ။',
        '- Movie ရှာချင်ရင် /movie <movie name> လို့ရိုက်ပါ။',
        '',
        'ရနိုင်သော အင်္ဂါရပ်များ',
        '- YouTube: 720p, 480p, 360p, Best Video, MP3',
        '- TikTok: Video, MP3',
        '- TikTok Photo: Images (up to 10)',
        '- Movie: အမည်နဲ့ ရှာပြီး Top results ပြမယ်',
        '- Movie details: /movie details <number>',
        '',
        'မှတ်ချက်',
        '- Telegram က ဖိုင်ဆိုဒ်ကန့်သတ်ချက်ရှိပါတယ်။',
        '- Movie search အတွက် TMDB API key လိုအပ်ပါတယ်။',
      ].join('\n'),
    );
  }

  @Command('movie')
  async movieCommand(@Ctx() ctx: Context) {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const query = text.replace(/^\/movie(@\w+)?\s*/i, '').trim();
    if (!query) {
      await ctx.reply('အသုံးပြုနည်း: /movie <movie name>');
      return;
    }
    const lowered = query.toLowerCase();
    if (lowered.startsWith('details')) {
      const parts = query.split(/\s+/);
      const index = Number(parts[1]);
      if (!Number.isFinite(index) || index < 1) {
        await ctx.reply('အသုံးပြုနည်း: /movie details <number>');
        return;
      }
      if (!ctx.chat) {
        await ctx.reply('Chat info မရလို့ details မပြနိုင်ပါ။');
        return;
      }
      this.cleanupMovieStore();
      const stored = this.movieStore.get(ctx.chat.id);
      if (!stored) {
        await ctx.reply('အရင် /movie <name> ကို ရှာပြီးမှ details ကြည့်ပါ။');
        return;
      }
      if (index > stored.items.length) {
        await ctx.reply(
          `ရွေးထားတဲ့ number မမှန်ပါ။ 1 - ${stored.items.length} အတွင်းရွေးပါ။`,
        );
        return;
      }
      const item = stored.items[index - 1];
      const overview = item.overview || 'No overview.';
      const caption = `${item.title} (${item.year}) ⭐ ${item.rating}\n\n${overview}`;
      if (item.posterUrl) {
        try {
          await ctx.replyWithPhoto(item.posterUrl, { caption });
          return;
        } catch (err) {
          console.warn('movie poster send failed, fallback to text', err);
        }
      }
      await ctx.reply(caption);
      return;
    }

    try {
      const results = await this.movieService.searchMovies(query);
      if (!results.length) {
        await ctx.reply(`"${query}" ကို မတွေ့ပါ။ နာမည်ကို စစ်ပြီး ပြန်ရှာပါ။`);
        return;
      }

      const lines: string[] = [];
      lines.push(`Results for "${query}":`);
      results.forEach((item, idx) => {
        const overview = item.overview
          ? item.overview.length > 140
            ? `${item.overview.slice(0, 140)}...`
            : item.overview
          : 'No overview.';
        lines.push(
          `${idx + 1}. ${item.title} (${item.year}) ⭐ ${item.rating}`,
        );
        lines.push(overview);
      });
      for (const item of results) {
        if (!item.posterUrl) continue;
        const caption = `${item.title} (${item.year}) ⭐ ${item.rating}`;
        try {
          await ctx.replyWithPhoto(item.posterUrl, { caption });
        } catch (err) {
          console.warn('movie poster send failed, continue', err);
        }
      }

      await ctx.reply(lines.join('\n'));
      if (ctx.chat) {
        this.cleanupMovieStore();
        this.movieStore.set(ctx.chat.id, {
          query,
          items: results,
          createdAt: Date.now(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'TMDB_API_KEY_MISSING') {
        await ctx.reply(
          'TMDB API key မရှိသေးပါ။ `TMDB_API_KEY` ကို env မှာ ထည့်ပေးပါ။',
        );
        return;
      }
      console.error('Movie search error:', error);
      await ctx.reply('Movie ရှာရာမှာ အမှားရှိပါတယ်။ နောက်မှ ပြန်စမ်းပါ။');
    }
  }

  @On('text')
  async onMessage(@Ctx() ctx: Context) {
    if (ctx.message && 'text' in ctx.message) {
      const url = ctx.message.text;
      if (this.isYouTubeUrl(url) || this.isTikTokUrl(url)) {
        if (this.isTikTokPhotoUrl(url)) {
          try {
            const info = await this.downloaderService.getTikTokPhotoPost(url);
            const images = info.images.slice(0, 10);
            const media = images.map((imageUrl, idx) => ({
              type: 'photo' as const,
              media: imageUrl,
              caption: idx === 0 ? `TikTok Photo: ${info.title}` : undefined,
            }));
            try {
              await ctx.replyWithMediaGroup(media);
            } catch {
              // Fallback: send one by one if media group fails.
              for (let i = 0; i < images.length; i += 1) {
                await ctx.replyWithPhoto(images[i], {
                  caption: i === 0 ? `TikTok Photo: ${info.title}` : undefined,
                });
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : '';
            if (message === 'TIKTOK_PARSE_FAILED') {
              await ctx.reply(
                'TikTok photo post ကို ဖတ်မရပါ။ Link ကို စစ်ပြီး ပြန်ပို့ပါ။',
              );
            } else if (message === 'TIKTOK_IMAGES_NOT_FOUND') {
              await ctx.reply(
                'TikTok photo images မတွေ့ပါ။ Video link ပို့ပေးပါ။',
              );
            } else {
              await ctx.reply(
                'TikTok photo ကို ဆွဲယူရာမှာ အမှားရှိပါတယ်။ နောက်မှ ပြန်စမ်းပါ။',
              );
            }
          }
          return;
        }
        if (
          this.isYouTubeUrl(url) &&
          url.includes('list=') &&
          !url.includes('v=')
        ) {
          await ctx.reply(
            'ဒီ link က playlist ဖြစ်နေတာပါ။ Single video link (v= ပါတဲ့ link) ကိုပို့ပေးပါ။',
          );
          return;
        }
        try {
          const info = await this.downloaderService.getVideoInfo(url);
          this.cleanupCallbacks();
          const key = this.createCallbackKey(url);
          const isTikTok = this.isTikTokUrl(url);
          const buttons = Markup.inlineKeyboard(
            isTikTok
              ? [
                  [Markup.button.callback('Video', `dl_best_${key}`)],
                  [Markup.button.callback('MP3 Audio', `dl_mp3_${key}`)],
                ]
              : [
                  [
                    Markup.button.callback('720p Video', `dl_720_${key}`),
                    Markup.button.callback('480p Video', `dl_480_${key}`),
                  ],
                  [Markup.button.callback('360p Video', `dl_360_${key}`)],
                  [Markup.button.callback('Best Video', `dl_best_${key}`)],
                  [Markup.button.callback('MP3 Audio', `dl_mp3_${key}`)],
                ],
          );

          const caption = `ဗီဒီယို: ${info.title}\nကြာချိန်: ${info.duration}\n\nQuality ရွေးချယ်ပေးပါ -`;
          if (info.thumbnail) {
            try {
              await ctx.replyWithPhoto(info.thumbnail, {
                caption,
                ...buttons,
              });
            } catch (err) {
              console.warn('thumbnail send failed, fallback to text', err);
              await ctx.reply(caption, buttons);
            }
          } else {
            await ctx.reply(caption, buttons);
          }
        } catch (e: any) {
          console.log(e);
          const message =
            e instanceof Error && e.message ? e.message : 'Video ရှာမတွေ့ပါ။';
          await ctx.reply(`Error: ${message}`);
        }
      } else {
        await ctx.reply(
          'YouTube/TikTok link ပဲ လက်ခံပါတယ်။ Link ကို စစ်ပြီး ပြန်ပို့ပေးပါ။',
        );
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

    let statusMessageId: number | undefined;
    try {
      // Always send a new text status message to avoid edit errors on photo/caption.
      const msg = await ctx.reply('ဗီဒီယိုအချက်အလက်များကို စစ်ဆေးနေသည်...');
      if (typeof msg === 'object' && 'message_id' in msg) {
        statusMessageId = msg.message_id;
      }
    } catch (replyErr) {
      console.warn('status reply failed', replyErr);
    }

    try {
      const videoInfo = await this.downloaderService.getVideoInfo(url);

      // ၃။ status message ကို update (fallback အနေနဲ့သာ)
      if (statusMessageId) {
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMessageId,
            undefined,
            `📥 "${videoInfo.title}" ကို ဒေါင်းလုဒ်ဆွဲနေပါသည်။`,
          );
        } catch (err) {
          console.warn('status edit failed', err);
        }
      }
      let chosenQuality = quality;
      const heights = Array.isArray(videoInfo.heights) ? videoInfo.heights : [];
      if (this.isYouTubeUrl(url) && heights.length) {
        const requestedMap: Record<string, number> = {
          '720': 720,
          '480': 480,
          '360': 360,
        };
        const requested = requestedMap[quality];
        if (requested) {
          const eligible = heights.filter((h) => h <= requested);
          const selected = eligible.length ? Math.max(...eligible) : null;
          if (!selected) {
            await ctx.reply(`${requested}p မရနိုင်ပါ။ Best Video ကိုရွေးပါ။`);
            chosenQuality = 'best';
          } else if (selected < requested) {
            await ctx.reply(
              `${requested}p မရနိုင်လို့ ${selected}p နဲ့ ဆက်ဒေါင်းလုဒ်လုပ်မယ်။`,
            );
            chosenQuality = String(selected);
          } else {
            chosenQuality = quality;
          }
        }
      }
      const filePath = await this.downloaderService.downloadVideo(
        url,
        chosenQuality,
        videoInfo.title,
        heights,
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
