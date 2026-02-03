import { Injectable, OnModuleInit } from '@nestjs/common';
import { create, YtFlags } from 'yt-dlp-exec'; // library ကို import လုပ်တယ်
import * as path from 'path';
import * as fs from 'fs';

const downloader = create('/usr/local/bin/yt-dlp');

interface YtResponse {
  title: string;
  thumbnail: string;
  duration_string: string;
}

@Injectable()
export class DownloaderService implements OnModuleInit {
  private readonly downloadPath = path.join(process.cwd(), 'downloads');
  private readonly cookiePath = path.join(process.cwd(), 'cookies.txt');
  private readonly pluginPath = path.join(process.cwd(), 'custom_plugins');
  onModuleInit() {
    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }
  }
  private sanitizeFilename(filename: string): string {
    // ဖိုင်နာမည်မှာ သုံးလို့မရတဲ့ character တွေကို ဖယ်ထုတ်တယ် (မြန်မာစာကို ခွင့်ပြုထားပါတယ်)
    return filename.replace(/[\\/:*?"<>|]/g, '').trim();
  }
  private getBaseFlags(): Record<string, any> {
    return {
      noCheckCertificate: true,
      noWarnings: true,
      pluginDirs: this.pluginPath,
      jsRuntimes: 'node',
      extractorArgs: 'youtube:player_client=web',
    };
  }

  async getVideoInfo(url: string) {
    try {
      const options = {
        ...this.getBaseFlags(), // အပေါ်က flag တွေကို လှမ်းယူသုံးတာ
        dumpSingleJson: true,
      };
      const result = await downloader(url, options as YtFlags);
      // 'downloader' ကို သုံးပါ
      // const result = await downloader(url, {
      //   dumpSingleJson: true,
      //   noCheckCertificate: true,
      //   noWarnings: true,
      //   cookies: fs.existsSync(this.cookiePath) ? this.cookiePath : undefined,
      //   jsRuntimes: 'node',
      // } as YtFlags);
      const ytData = result as unknown as YtResponse;
      return {
        title: ytData.title,
        duration: ytData.duration_string, // duration_string ကို duration အဖြစ် ပြောင်းပေးလိုက်တာ
        thumbnail: ytData.thumbnail,
        url: url,
      };
    } catch (error: unknown) {
      console.error('Info Error:', error);
      throw new Error('Video info ရှာမတွေ့ပါဘူး။');
    }
  }
  async downloadVideo(
    url: string,
    quality: string,
    videoTitle: string,
  ): Promise<string> {
    // mp3 ဆိုရင် extension ကို .mp3 လို့ ပေးမယ်၊ မဟုတ်ရင် .mp4
    const isMp3 = quality === 'mp3';
    const safeTitle = this.sanitizeFilename(videoTitle);
    const filename = `${safeTitle}_${Date.now()}.${isMp3 ? 'mp3' : 'mp4'}`;
    const outputPath = path.join(this.downloadPath, filename);

    try {
      let formatStr = '';

      // Quality အလိုက် format ကို ရွေးချယ်ခြင်း
      switch (quality) {
        case '720':
          // 720p ရှိရင် ယူမယ်၊ မရှိရင် အကောင်းဆုံး mp4 ကို ယူမယ်
          formatStr =
            'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best';
          break;
        case '360':
          // 360p အနီးစပ်ဆုံးကို ယူမယ်
          formatStr =
            'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best';
          break;
        case 'mp3':
          // Audio ပဲ ယူမယ်
          formatStr = 'bestaudio/best';
          break;
        default:
          formatStr =
            'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
      }
      const options: YtFlags = {
        ...this.getBaseFlags(), // ဒါလေး ထည့်ပေးလိုက်တာနဲ့ plugin setting တွေ အကုန်ပါသွားမယ်
        output: outputPath,
        format: formatStr,
      } as YtFlags;
      // const options: YtFlags = {
      //   output: outputPath,
      //   format: formatStr,
      //   noCheckCertificate: true,
      //   cookies: fs.existsSync(this.cookiePath) ? this.cookiePath : undefined,
      // };
      // (options as Record<string, unknown>)['jsRuntimes'] = 'node';
      // MP3 ဆိုရင် audio extract လုပ်ဖို့ flag ထည့်ပေးရမယ်
      if (isMp3) {
        options.extractAudio = true;
        options.audioFormat = 'mp3';
      }

      await downloader(url, options);

      return outputPath;
    } catch (error) {
      console.error('Download error:', error);
      throw new Error(
        'ဖိုင်ဒေါင်းလုဒ်ဆွဲရာမှာ အမှားအယွင်းရှိလို့ ပြန်စမ်းကြည့်ပေးပါ။',
      );
    }
  }
}
