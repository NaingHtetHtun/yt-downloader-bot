import { Injectable, OnModuleInit } from '@nestjs/common';
import { create, YtFlags } from 'yt-dlp-exec'; // library ကို import လုပ်တယ်
import * as path from 'path';
import * as fs from 'fs';

const downloader = create('/usr/local/bin/yt-dlp');
const TELEGRAM_MAX_FILE_MB = Number(process.env.TELEGRAM_MAX_FILE_MB ?? 50);

interface YtResponse {
  title: string;
  thumbnail: string;
  duration_string: string;
}

@Injectable()
export class DownloaderService implements OnModuleInit {
  private readonly downloadPath = path.resolve(
    process.env.DOWNLOAD_DIR ?? path.join(process.cwd(), 'downloads_user'),
  );
  private readonly cookiePath = path.join(process.cwd(), 'cookies.txt');
  private readonly pluginPath = path.join(process.cwd(), 'custom_plugins');
  onModuleInit() {
    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }
  }
  private sanitizeFilename(filename: string): string {
    // ဖိုင်နာမည်မှာ သုံးလို့မရတဲ့ character တွေကို ဖယ်ထုတ်တယ် (မြန်မာစာကို ခွင့်ပြုထားပါတယ်)
    let safe = filename.replace(/[\\/:*?"<>|]/g, '').trim();
    // OS path limit safety: keep it short to avoid "File name too long"
    const maxLength = 60;
    if (safe.length > maxLength) {
      safe = safe.slice(0, maxLength).trim();
    }
    return safe || 'video';
  }
  private getVideoIdFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('youtu.be')) {
        return parsed.pathname.replace('/', '') || 'video';
      }
      const id = parsed.searchParams.get('v');
      return id ?? 'video';
    } catch {
      return 'video';
    }
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
    const videoId = this.getVideoIdFromUrl(url);
    const filename = `${safeTitle}_${videoId}_${Date.now()}.${isMp3 ? 'mp3' : 'mp4'}`;
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
        maxFilesize: `${TELEGRAM_MAX_FILE_MB}M`,
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
      const stderr =
        typeof (error as { stderr?: unknown }).stderr === 'string'
          ? ((error as { stderr?: string }).stderr ?? '').toLowerCase()
          : '';
      if (
        stderr.includes('max-filesize') ||
        stderr.includes('max filesize')
      ) {
        throw new Error('MAX_FILESIZE');
      }
      if (
        stderr.includes('file name too long') ||
        stderr.includes('filename too long') ||
        stderr.includes('errno 36')
      ) {
        throw new Error('FILENAME_TOO_LONG');
      }
      throw new Error(
        'ဖိုင်ဒေါင်းလုဒ်ဆွဲရာမှာ အမှားအယွင်းရှိလို့ ပြန်စမ်းကြည့်ပေးပါ။',
      );
    }
  }
}
