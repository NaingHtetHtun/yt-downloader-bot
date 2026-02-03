import { Update, Start, On, Ctx, Action } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import * as fs from 'fs';
import { DownloaderService } from './downloader/downloader.service';

@Update()
export class AppUpdate {
  constructor(private readonly downloaderService: DownloaderService) {}

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

          await ctx.reply(
            `ဗီဒီယို: ${info.title}\nကြာချိန်: ${info.duration}\n\nQuality ရွေးချယ်ပေးပါ -`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback('720p Video', `dl_720_${url}`),
                Markup.button.callback('360p Video', `dl_360_${url}`),
              ],
              [Markup.button.callback('MP3 Audio', `dl_mp3_${url}`)],
            ]),
          );
        } catch (e: any) {
          console.log(e);
          await ctx.reply('Error: Video ရှာမတွေ့ပါ။');
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
    const [, quality, ...urlParts] = parts;
    const url = urlParts.join('_');

    await ctx.answerCbQuery('ဒေါင်းလုဒ်ဆွဲနေပါပြီ...');

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
      await ctx.reply('ဒေါင်းလုဒ်ဆွဲရာမှာ အမှားအယွင်းရှိသွားပါတယ်။');
    }
  }
}
