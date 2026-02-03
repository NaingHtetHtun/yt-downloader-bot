import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegrafModule } from 'nestjs-telegraf';
import { AppUpdate } from './app.update';
import { DownloaderService } from './downloader/downloader.service';
@Module({
  imports: [
    TelegrafModule.forRoot({
      token: '7299953702:AAF6Ipmg_4cAtFi5DGRj-taaPJDcvsZm0bc',
      options: {
        telegram: {
          apiRoot: 'http://localhost:8081',
        },
        handlerTimeout: Infinity, // ၅ မိနစ်အထိ တိုးလိုက်ပါ
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, AppUpdate, DownloaderService],
})
export class AppModule {}
