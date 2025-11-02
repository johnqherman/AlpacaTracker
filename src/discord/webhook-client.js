import axios from 'axios';
import { URL } from 'url';

class WebhookClient {
    constructor(messageStorage = null) {
        this.messageStorage = messageStorage;
        this.lastMessageIds = new Map();
    }

    setMessageStorage(messageStorage) {
        this.messageStorage = messageStorage;
    }

    setLastMessageIds(messageIdsMap) {
        this.lastMessageIds = messageIdsMap;
    }

    getLastMessageIds() {
        return this.lastMessageIds;
    }

    maskWebhookUrl(url) {
        try {
            const urlObj = new URL(url);
            const parts = urlObj.pathname.split('/');
            if (parts.length >= 5) {
                parts[4] = parts[4].substring(0, 4) + '***';
                parts[5] = '***';
                urlObj.pathname = parts.join('/');
            }
            return urlObj.toString();
        } catch {
            return 'invalid-webhook-url';
        }
    }

    async sendToWebhook(webhookUrl, embed) {
        const payload = { embeds: [embed] };
        const lastMessageId = this.lastMessageIds.get(webhookUrl);

        try {
            if (lastMessageId) {
                try {
                    await axios.patch(
                        `${webhookUrl}/messages/${lastMessageId}`,
                        payload,
                        {
                            timeout: 10 * 1000,
                            headers: { 'Content-Type': 'application/json' }
                        }
                    );
                    console.log(
                        `Message updated: ${this.maskWebhookUrl(webhookUrl)}`
                    );
                    return true;
                } catch {
                    this.lastMessageIds.delete(webhookUrl);
                    if (this.messageStorage) {
                        this.messageStorage.deleteMessageId(webhookUrl);
                    }
                }
            }

            const { data } = await axios.post(
                `${webhookUrl}?wait=true`,
                payload,
                {
                    timeout: 10 * 1000,
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (data?.id) {
                this.lastMessageIds.set(webhookUrl, data.id);
                if (this.messageStorage) {
                    this.messageStorage.setMessageId(webhookUrl, data.id);
                }
                console.log(
                    `New message posted: ${this.maskWebhookUrl(webhookUrl)}`
                );
            }
            return true;
        } catch (error) {
            console.error(
                `Webhook failed ${this.maskWebhookUrl(webhookUrl)}: ${error.message}`
            );
            return false;
        }
    }

    async sendDiscordNotification(webhookUrls, embed) {
        const results = await Promise.allSettled(
            webhookUrls.map(url => this.sendToWebhook(url, embed))
        );

        const successCount = results.filter(
            r => r.status === 'fulfilled' && r.value
        ).length;
        const total = webhookUrls.length;

        if (successCount > 0) {
            console.log(
                `Discord notifications sent: ${successCount}/${total} webhooks`
            );
            return true;
        } else {
            console.error(
                `All Discord notifications failed (${total} webhooks)`
            );
            return false;
        }
    }
}

export default WebhookClient;
