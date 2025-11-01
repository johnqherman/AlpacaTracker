#!/usr/bin/env node

import 'dotenv/config';
import axios from 'axios';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const __basename = path.basename(__filename);

const apiUrl =
    'https://api.raccoonlagoon.com/v1/server-info?ip=104.153.104.12:27015&g=tf2';

class AlpacaTracker {
    constructor() {
        this.config = {
            apiUrl: apiUrl,
            webhookUrls: this.parseWebhookUrls(),
            pollInterval: '*/1 * * * *',
            maxRetries: 3,
            retryDelay: 30 * 1000
        };

        this.lastPlayerCount = null;
        this.lastNotificationTime = null;
        this.consecutiveErrors = 0;
        this.isRunning = false;
        this.lastMessageIds = new Map();
        this.messageIdsFile = path.join(__dirname, 'message-ids.json');

        this.loadMessageIds();
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

    loadMessageIds() {
        try {
            if (fs.existsSync(this.messageIdsFile)) {
                const data = fs.readFileSync(this.messageIdsFile, 'utf8');
                const messageIds = JSON.parse(data);

                for (const [webhookUrl, messageId] of Object.entries(
                    messageIds
                )) {
                    this.lastMessageIds.set(webhookUrl, messageId);
                }

                console.log(
                    `Loaded ${this.lastMessageIds.size} message IDs from storage`
                );
            }
        } catch (error) {
            console.warn(`Failed to load message IDs: ${error.message}`);
        }
    }

    saveMessageIds() {
        try {
            const messageIds = Object.fromEntries(this.lastMessageIds);
            fs.writeFileSync(
                this.messageIdsFile,
                JSON.stringify(messageIds, null, 2)
            );
        } catch (error) {
            console.warn(`Failed to save message IDs: ${error.message}`);
        }
    }

    async fetchServerInfo(retryCount = 0) {
        try {
            console.log(
                `Fetching server info (attempt ${retryCount + 1}/${this.config.maxRetries + 1})`
            );

            const { data } = await axios.get(this.config.apiUrl, {
                timeout: 15 * 1000,
                headers: { 'User-Agent': 'AlpacaTracker/1.0' }
            });

            this.consecutiveErrors = 0;
            return data;
        } catch (error) {
            console.error(`Failed to fetch server info: ${error.message}`);

            if (retryCount < this.config.maxRetries) {
                console.log(`Retrying in ${this.config.retryDelay / 1000}s...`);
                await this.sleep(this.config.retryDelay);
                return this.fetchServerInfo(retryCount + 1);
            }

            if (++this.consecutiveErrors >= 3) {
                await this.sendErrorNotification(error);
            }
            throw error;
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
                    this.saveMessageIds();
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
                this.saveMessageIds();
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

    async sendDiscordNotification(embed) {
        const results = await Promise.allSettled(
            this.config.webhookUrls.map(url => this.sendToWebhook(url, embed))
        );

        const successCount = results.filter(
            r => r.status === 'fulfilled' && r.value
        ).length;
        const total = this.config.webhookUrls.length;

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

    createServerEmbed(serverData) {
        const playerCount = serverData.numHumans || 0;
        const maxPlayers = serverData.maxClients || 24;
        const serverIP = serverData.serverIP || 'Unknown';
        const botCount = serverData.numBots || 0;
        const capacityPercent = Math.round((playerCount / maxPlayers) * 100);

        const progressBarLength = 40;
        const filledBars = Math.round(
            (playerCount / maxPlayers) * progressBarLength
        );
        const progressBar =
            '█'.repeat(filledBars) + '░'.repeat(progressBarLength - filledBars);

        const embed = {
            title: '',
            color: 0xf8ab27,
            fields: [
                { name: '', value: progressBar, inline: false },
                {
                    name: 'Online Players',
                    value: `**${playerCount}/${maxPlayers}** (${capacityPercent}%) - Refreshing <t:${this.getNextRefreshTimestamp()}:R>\n[Join Now](https://raccoonlagoon.com/connect/${serverIP})`,
                    inline: false
                }
            ],
            timestamp: new Date().toISOString(),
            footer: {
                text: 'api.raccoonlagoon.com',
                icon_url:
                    'https://raw.githubusercontent.com/JohnQHerman/fast-dl/main/images/raccoon_lagoon.png'
            }
        };

        if (botCount > 0) {
            embed.fields.push({
                name: 'Bots',
                value: `${botCount} bot${botCount !== 1 ? 's' : ''} online`,
                inline: true
            });
        }

        const players =
            serverData.humanData?.filter?.(p => p.name?.trim()) || [];

        if (players.length > 0) {
            const sortedPlayers = players.sort((a, b) => {
                const [scoreA, scoreB] = [a.score || 0, b.score || 0];
                const [timeA, timeB] = [a.time || 0, b.time || 0];

                if (scoreB !== scoreA) return scoreB - scoreA;
                return scoreA === 0 && scoreB === 0
                    ? timeB - timeA
                    : timeA - timeB;
            });

            embed.fields.push(
                {
                    name: 'Name',
                    value: sortedPlayers.map(p => p.name).join('\n'),
                    inline: true
                },
                {
                    name: 'Score',
                    value: sortedPlayers.map(p => p.score || 0).join('\n'),
                    inline: true
                },
                {
                    name: 'Time Played',
                    value: sortedPlayers
                        .map(p => this.formatTime(p.time || 0))
                        .join('\n'),
                    inline: true
                }
            );
        }

        return embed;
    }

    createErrorEmbed(error) {
        return {
            title: '⚠️ Error',
            description: `Failed to fetch server information after ${this.consecutiveErrors} consecutive attempts.`,
            color: 0xff0000,
            fields: [
                {
                    name: '❌ Error Details',
                    value: error.message.substring(0, 1000),
                    inline: false
                },
                {
                    name: '🔄 Status',
                    value: 'Monitoring will continue automatically',
                    inline: false
                }
            ],
            timestamp: new Date().toISOString()
        };
    }

    async sendErrorNotification(error) {
        await this.sendDiscordNotification(this.createErrorEmbed(error));
        console.log('Error notification sent to Discord');
    }

    async processServerData(serverData) {
        const playerCount = serverData.numHumans || 0;
        const maxPlayers = serverData.maxClients || 24;
        const capacityPercent = Math.round((playerCount / maxPlayers) * 100);
        const botCount = serverData.numBots || 0;

        console.log(
            `Server status: ${playerCount}/${maxPlayers} players (${capacityPercent}%)${botCount > 0 ? `, ${botCount} bots` : ''}`
        );

        const embed = this.createServerEmbed(serverData);
        const success = await this.sendDiscordNotification(embed);

        if (success) {
            this.lastNotificationTime = Date.now();
            console.log(
                `Embed sent: ${playerCount === 0 ? 'Server empty' : `${playerCount} players online`}`
            );
        }

        this.lastPlayerCount = playerCount;
    }

    async checkServer() {
        if (this.isRunning) {
            console.log('Previous check still running, skipping...');
            return;
        }

        this.isRunning = true;
        try {
            console.log('Starting server check...');
            const serverData = await this.fetchServerInfo();
            await this.processServerData(serverData);
        } catch (error) {
            console.error(`Server check failed: ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    start() {
        console.log('Starting TF2 Server Monitor...');

        const task = cron.schedule(
            this.config.pollInterval,
            () => this.checkServer(),
            {
                scheduled: false,
                timezone: 'UTC'
            }
        );

        task.start();
        console.log(
            `Monitor started with schedule: ${this.config.pollInterval}`
        );

        setTimeout(() => this.checkServer(), 5000);

        const shutdown = () => {
            console.log('Shutting down gracefully...');
            task.stop();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }

    getNextRefreshTimestamp() {
        const cronParts = this.config.pollInterval.split(' ');
        const intervalMinutes = cronParts[0].startsWith('*/')
            ? parseInt(cronParts[0].substring(2)) || 3
            : 3;

        return Math.floor((Date.now() + intervalMinutes * 60 * 1000) / 1000);
    }

    formatTime(seconds) {
        if (!seconds) return '0s';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (remainingSeconds > 0 || parts.length === 0)
            parts.push(`${remainingSeconds}s`);

        return parts.join(' ');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const monitor = new AlpacaTracker();
monitor.start();

export default AlpacaTracker;
