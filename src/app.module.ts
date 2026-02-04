import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegrafModule } from 'nestjs-telegraf';
import { AppUpdate } from './app.update';
import { DownloaderService } from './downloader/downloader.service';

const botToken = process.env.BOT_TOKEN ?? '';
if (!botToken) {
  throw new Error('BOT_TOKEN is required');
}

const telegramApiUrl = process.env.TELEGRAM_API_URL ?? 'http://localhost:8081';
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
  providers: [AppService, AppUpdate, DownloaderService],
})
export class AppModule {}
