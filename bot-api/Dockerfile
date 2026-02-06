FROM divideprojects/docker-telegram-bot-api:latest

# လိုအပ်တဲ့ folder တွေကို ဆောက်ပေးရပါမယ်
USER root
RUN mkdir -p /var/lib/telegram-bot-api /tmp/telegram-bot-api
RUN chmod -R 777 /var/lib/telegram-bot-api /tmp/telegram-bot-api

EXPOSE 8081

# Command ကို ပိုပြီး ရှင်းအောင် ရေးပါမယ်
ENTRYPOINT ["telegram-bot-api"]
CMD ["--http-port", "8081", "--dir=/var/lib/telegram-bot-api", "--temp-dir=/tmp/telegram-bot-api"]