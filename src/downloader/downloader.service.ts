import { Injectable, OnModuleInit } from '@nestjs/common';
import { create, YtFlags } from 'yt-dlp-exec'; // library ကို import လုပ်တယ်
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

const downloader = create('/usr/local/bin/yt-dlp');
const TELEGRAM_MAX_FILE_MB = Number(process.env.TELEGRAM_MAX_FILE_MB ?? 50);

interface YtResponse {
  title: string;
  thumbnail: string;
  duration_string: string;
  formats?: Array<{ height?: number | null }>;
}

type YtFlagsExtended = YtFlags & {
  extractorArgs?: string;
  cookies?: string;
  cookiesFromBrowser?: string;
};
type JsonRecord = Record<string, unknown>;
const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' ? (value as JsonRecord) : null;
const parseJsonRecord = (raw: string): JsonRecord | null => {
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
};

@Injectable()
export class DownloaderService implements OnModuleInit {
  private readonly downloadPath = path.resolve(
    process.env.DOWNLOAD_DIR ?? path.join(process.cwd(), 'downloads_user'),
  );
  private readonly cookiePath = path.join(process.cwd(), 'cookies.txt');
  private readonly cookieTmpPath = path.join('/tmp', 'yt-cookies.txt');
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
      if (parsed.hostname.includes('tiktok.com')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] ?? 'video';
      }
      const id = parsed.searchParams.get('v');
      return id ?? 'video';
    } catch {
      return 'video';
    }
  }
  private isTikTokUrl(url: string): boolean {
    return (
      url.includes('tiktok.com') ||
      url.includes('vm.tiktok.com') ||
      url.includes('vt.tiktok.com')
    );
  }
  private getYouTubeIdFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('youtu.be')) {
        return parsed.pathname.replace('/', '') || null;
      }
      return parsed.searchParams.get('v');
    } catch {
      return null;
    }
  }
  private getTikTokIdFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] ?? null;
    } catch {
      return null;
    }
  }
  private normalizeThumbnail(thumbnailUrl: string, sourceUrl: string): string {
    if (!thumbnailUrl) return thumbnailUrl;
    if (thumbnailUrl.includes('vi_webp')) {
      const videoId = this.getYouTubeIdFromUrl(sourceUrl);
      if (videoId) {
        return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      }
    }
    if (thumbnailUrl.endsWith('.webp')) {
      return thumbnailUrl.replace(/\.webp($|\?)/, '.jpg');
    }
    return thumbnailUrl;
  }
  private extractTikTokJsonCandidates(html: string): JsonRecord[] {
    const candidates: JsonRecord[] = [];
    const sigiMatch = html.match(
      /<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (sigiMatch?.[1]) {
      const parsed = parseJsonRecord(sigiMatch[1]);
      if (parsed) candidates.push(parsed);
    }
    const windowMatch = html.match(
      /window\[['"]SIGI_STATE['"]\]\s*=\s*({[\s\S]*?})\s*;?/,
    );
    if (windowMatch?.[1]) {
      const parsed = parseJsonRecord(windowMatch[1]);
      if (parsed) candidates.push(parsed);
    }
    const nextMatch = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (nextMatch?.[1]) {
      const parsed = parseJsonRecord(nextMatch[1]);
      if (parsed) candidates.push(parsed);
    }
    return candidates;
  }
  private extractTikTokItem(
    data: JsonRecord,
    videoId: string | null,
  ): JsonRecord | null {
    const itemMap = asRecord(data.ItemModule);
    if (!itemMap) return null;
    if (videoId && Object.prototype.hasOwnProperty.call(itemMap, videoId)) {
      const entry = asRecord(itemMap[videoId]);
      return entry ?? null;
    }
    const firstKey = Object.keys(itemMap)[0];
    if (!firstKey) return null;
    return asRecord(itemMap[firstKey]);
  }
  private extractTikTokPhotoUrls(item: JsonRecord): string[] {
    const imagePost = asRecord(item.imagePost);
    if (!imagePost) return [];
    const images = imagePost.images;
    if (!Array.isArray(images)) return [];
    const urls: string[] = [];
    for (const img of images) {
      const record = asRecord(img);
      if (!record) continue;
      const imageURL = asRecord(record.imageURL);
      const displayImage = asRecord(record.displayImage);
      const urlList = Array.isArray(imageURL?.urlList)
        ? imageURL?.urlList
        : Array.isArray(displayImage?.urlList)
          ? displayImage?.urlList
          : undefined;
      const url = typeof urlList?.[0] === 'string' ? urlList[0] : undefined;
      if (typeof url === 'string') {
        urls.push(url);
      }
    }
    return urls;
  }
  private collectTikTokPhotoUrls(obj: unknown): string[] {
    const urls: string[] = [];
    const visit = (node: unknown) => {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      if (typeof node !== 'object') return;
      const record = asRecord(node);
      if (!record) return;
      if (record.imagePost) {
        urls.push(...this.extractTikTokPhotoUrls(record));
      }
      const images = record.images;
      if (Array.isArray(images)) {
        for (const img of images) {
          const imgRecord = asRecord(img);
          if (!imgRecord) continue;
          const imageURL = asRecord(imgRecord.imageURL);
          const displayImage = asRecord(imgRecord.displayImage);
          const urlList = Array.isArray(imageURL?.urlList)
            ? imageURL?.urlList
            : Array.isArray(displayImage?.urlList)
              ? displayImage?.urlList
              : Array.isArray(imgRecord.urlList)
                ? imgRecord.urlList
                : undefined;
          const url = typeof urlList?.[0] === 'string' ? urlList[0] : undefined;
          if (typeof url === 'string') urls.push(url);
        }
      }
      for (const value of Object.values(record)) {
        visit(value);
      }
    };
    visit(obj);
    return Array.from(new Set(urls));
  }

  private getCookieFlags(): Partial<YtFlagsExtended> {
    const cookieBase64 = process.env.YTDLP_COOKIES_B64?.trim();
    if (cookieBase64) {
      try {
        const decoded = Buffer.from(cookieBase64, 'base64').toString('utf-8');
        fs.writeFileSync(this.cookieTmpPath, decoded, { mode: 0o600 });
        return { cookies: this.cookieTmpPath };
      } catch (error) {
        console.warn('Failed to decode YTDLP_COOKIES_B64:', error);
      }
    }
    const cookieFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
    if (cookieFromBrowser) {
      return { cookiesFromBrowser: cookieFromBrowser };
    }
    const cookiePath =
      process.env.YTDLP_COOKIES_PATH?.trim() ??
      process.env.COOKIES_PATH?.trim();
    if (cookiePath) {
      if (fs.existsSync(cookiePath)) {
        return { cookies: cookiePath };
      }
      console.warn(`Cookie file not found: ${cookiePath}`);
      return {};
    }
    if (fs.existsSync(this.cookiePath)) {
      return { cookies: this.cookiePath };
    }
    return {};
  }

  async getTikTokPhotoPost(url: string): Promise<{
    title: string;
    images: string[];
    description?: string;
  }> {
    const response = await axios.get<string>(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        referer: 'https://www.tiktok.com/',
      },
      responseType: 'text',
    });
    const candidates = this.extractTikTokJsonCandidates(response.data);
    if (!candidates.length) {
      throw new Error('TIKTOK_PARSE_FAILED');
    }
    const itemId = this.getTikTokIdFromUrl(url) ?? null;
    for (const data of candidates) {
      const item = this.extractTikTokItem(data, itemId);
      if (item) {
        const images = this.extractTikTokPhotoUrls(item);
        if (images.length) {
          const desc =
            typeof item.desc === 'string'
              ? item.desc
              : typeof item.description === 'string'
                ? item.description
                : 'TikTok Photo';
          return { title: desc, images };
        }
      }
      const fallbackImages = this.collectTikTokPhotoUrls(data);
      if (fallbackImages.length) {
        return { title: 'TikTok Photo', images: fallbackImages };
      }
    }
    throw new Error('TIKTOK_IMAGES_NOT_FOUND');
  }
  private getBaseFlags(url: string): Record<string, unknown> {
    const baseFlags: Record<string, unknown> = {
      noCheckCertificate: true,
      noWarnings: true,
      pluginDirs: this.pluginPath,
      jsRuntimes: 'node',
      noPlaylist: true,
      ...this.getCookieFlags(),
    };
    // Use YouTube-specific extractor args only when needed.
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      baseFlags.extractorArgs = 'youtube:player_client=android,web';
    }
    return baseFlags;
  }

  async getVideoInfo(url: string) {
    const parseInfo = (result: unknown) => {
      const ytData = result as YtResponse;
      const thumbnail = this.normalizeThumbnail(ytData.thumbnail, url);
      const heights = Array.from(
        new Set(
          (ytData.formats ?? [])
            .map((format) => format.height)
            .filter(
              (height): height is number =>
                typeof height === 'number' && height > 0,
            ),
        ),
      ).sort((a, b) => a - b);
      return {
        title: ytData.title,
        duration: ytData.duration_string, // duration_string ကို duration အဖြစ် ပြောင်းပေးလိုက်တာ
        thumbnail: thumbnail,
        url: url,
        heights,
      };
    };
    try {
      const options: YtFlagsExtended = {
        ...this.getBaseFlags(url), // အပေါ်က flag တွေကို လှမ်းယူသုံးတာ
        dumpSingleJson: true,
      };
      try {
        const result = await downloader(url, options);
        return parseInfo(result);
      } catch (error) {
        const stderr =
          typeof (error as { stderr?: unknown }).stderr === 'string'
            ? ((error as { stderr?: string }).stderr ?? '')
            : '';
        const lowered = stderr.toLowerCase();
        // Some videos require a different client to list formats.
        if (
          this.isTikTokUrl(url) === false &&
          lowered.includes('requested format is not available')
        ) {
          const retryOptions: YtFlagsExtended = {
            ...options,
            extractorArgs: 'youtube:player_client=android,web',
          };
          const retryResult = await downloader(url, retryOptions);
          return parseInfo(retryResult);
        }
        throw error;
      }
    } catch (error: unknown) {
      console.error('Info Error:', error);
      const stderr =
        typeof (error as { stderr?: unknown }).stderr === 'string'
          ? ((error as { stderr?: string }).stderr ?? '')
          : '';
      const lowered = stderr.toLowerCase();
      if (lowered.includes('unsupported url') && this.isTikTokUrl(url)) {
        throw new Error(
          'TikTok photo post ကို မထောက်ပံ့သေးပါ။ Video link ပို့ပေးပါ။',
        );
      }
      if (
        lowered.includes('sign in to confirm') ||
        lowered.includes('not a bot') ||
        lowered.includes('use --cookies')
      ) {
        throw new Error(
          'YouTube က login လိုပါတယ်။ cookies ထည့်ပေးပြီး ပြန်စမ်းကြည့်ပါ။',
        );
      }
      if (lowered.includes('requested format is not available')) {
        throw new Error('Requested format မရှိပါ။ အခြား link နဲ့ စမ်းကြည့်ပါ။');
      }
      if (lowered.includes('private') || lowered.includes('members-only')) {
        throw new Error('ဒီဗီဒီယိုက private/members-only ဖြစ်ပါတယ်။');
      }
      if (
        lowered.includes('unavailable') ||
        lowered.includes('not available')
      ) {
        throw new Error('ဒီဗီဒီယိုကို မရနိုင်ပါ။');
      }
      throw new Error('Video info ရှာမတွေ့ပါဘူး။');
    }
  }
  async downloadVideo(
    url: string,
    quality: string,
    videoTitle: string,
    availableHeights: number[] = [],
  ): Promise<string> {
    // mp3 ဆိုရင် extension ကို .mp3 လို့ ပေးမယ်၊ မဟုတ်ရင် .mp4
    const isMp3 = quality === 'mp3';
    const safeTitle = this.sanitizeFilename(videoTitle);
    const videoId = this.getVideoIdFromUrl(url);
    const filename = `${safeTitle}_${videoId}_${Date.now()}.${isMp3 ? 'mp3' : 'mp4'}`;
    const outputPath = path.join(this.downloadPath, filename);

    try {
      let formatStr = '';
      const isTikTok = this.isTikTokUrl(url);
      const hasExact = (height: number) => availableHeights.includes(height);
      switch (quality) {
        case '720':
          formatStr = hasExact(720)
            ? 'bestvideo[height=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=720]+bestaudio/best[height=720]'
            : 'bestvideo[height<=720][height>480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720][height>480]+bestaudio/best[height<=720]';
          break;
        case '480':
          formatStr = hasExact(480)
            ? 'bestvideo[height=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=480]+bestaudio/best[height=480]'
            : 'bestvideo[height<=480][height>360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480][height>360]+bestaudio/best[height<=480]';
          break;
        case '360':
          formatStr = hasExact(360)
            ? 'bestvideo[height=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=360]+bestaudio/best[height=360]'
            : 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]';
          break;
        case 'best':
          formatStr = isTikTok
            ? 'best'
            : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
          break;
        case 'nowm':
          formatStr = 'download/best';
          break;
        case 'mp3':
          formatStr = 'bestaudio/best';
          break;
        default:
          formatStr = isTikTok
            ? 'best'
            : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
      }
      const options: YtFlagsExtended = {
        ...this.getBaseFlags(url), // ဒါလေး ထည့်ပေးလိုက်တာနဲ့ plugin setting တွေ အကုန်ပါသွားမယ်
        output: outputPath,
        format: formatStr,
        mergeOutputFormat: isMp3 ? undefined : 'mp4', // mp3 မဟုတ်ရင် mp4 အဖြစ် merge လုပ်မယ်
        maxFilesize: `${TELEGRAM_MAX_FILE_MB}M`,
      };
      if (isMp3) {
        options.extractAudio = true;
        options.audioFormat = 'mp3';
      }
      try {
        await downloader(url, options);
      } catch (error) {
        const stderr =
          typeof (error as { stderr?: unknown }).stderr === 'string'
            ? ((error as { stderr?: string }).stderr ?? '').toLowerCase()
            : '';
        if (stderr.includes('requested format is not available')) {
          // Retry with broader format + more compatible YouTube client
          const retryOptions: YtFlagsExtended = {
            ...options,
            format: isMp3 ? 'bestaudio/best' : 'bestvideo+bestaudio/best',
            extractorArgs: 'youtube:player_client=android,web',
          };
          await downloader(url, retryOptions);
        } else {
          throw error;
        }
      }

      return outputPath;
    } catch (error) {
      console.error('Download error:', error);
      const stderr =
        typeof (error as { stderr?: unknown }).stderr === 'string'
          ? ((error as { stderr?: string }).stderr ?? '').toLowerCase()
          : '';
      if (stderr.includes('max-filesize') || stderr.includes('max filesize')) {
        throw new Error('MAX_FILESIZE');
      }
      if (
        stderr.includes('sign in to confirm') ||
        stderr.includes('not a bot') ||
        stderr.includes('use --cookies')
      ) {
        throw new Error(
          'YouTube က login လိုပါတယ်။ cookies ထည့်ပေးပြီး ပြန်စမ်းကြည့်ပါ။',
        );
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
