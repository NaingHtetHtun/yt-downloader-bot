import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegrafModule } from 'nestjs-telegraf';
import { AppUpdate } from './app.update';
import { DownloaderService } from './downloader/downloader.service';
import { MovieService } from './movie/movie.service';

const botToken = process.env.BOT_TOKEN ?? '';
if (!botToken) {
  throw new Error('BOT_TOKEN is required');
}

const telegramApiUrl =
  process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org';
@Module({
  imports: [
    TelegrafModule.forRoot({
      token: botToken,
      options: {
        telegram: {
          apiRoot: telegramApiUrl,
        },
        handlerTimeout: Infinity,
      },
      launchOptions: {
        dropPendingUpdates: true,
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, AppUpdate, DownloaderService, MovieService],
})
export class AppModule {}
