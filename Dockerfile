FROM node:18-slim

# ၁။ လိုအပ်တဲ့ Tools တွေ အကုန်သွင်းမယ် (Python, FFmpeg, Curl)
RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    && ln -s /usr/bin/python3 /usr/bin/python

# ၂။ yt-dlp ကို code က ရှာနေတဲ့ နေရာအတိအကျမှာ သွားထားပေးမယ်
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# ၃။ pnpm ကို enable လုပ်ပြီး install ဆွဲမယ်
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ၄။ Project တစ်ခုလုံးကို copy ကူးပြီး build မယ်
COPY . .
RUN pnpm run build

# ၅။ Bot ကို စ run မယ်
CMD ["pnpm", "run", "start:prod"]