class Config {
    constructor() {
        this.apiUrl =
            'https://api.raccoonlagoon.com/v1/server-info?ip=104.153.104.12:27015&g=tf2';
        this.webhookUrls = this.parseWebhookUrls();
        this.pollInterval = '58 * * * * *';
        this.maxRetries = 3;
        this.retryDelay = 30 * 1000;
    }

    parseWebhookUrls() {
        return process.env.DISCORD_WEBHOOK_URLS
            ? [
                  ...new Set(
                      process.env.DISCORD_WEBHOOK_URLS.split(',')
                          .map(url => url.trim())
                          .filter(Boolean)
                  )
              ]
            : [];
    }
}

export default Config;
