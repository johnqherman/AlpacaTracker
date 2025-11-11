#!/usr/bin/env node

import 'dotenv/config';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

import Config from './config/config.js';
import WebhookClient from './discord/webhook-client.js';
import EmbedBuilder from './discord/embed-builder.js';
import ServerFetcher from './api/server-fetcher.js';
import MessageStorage from './storage/message-storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AlpacaTracker {
    constructor() {
        this.config = new Config();
        this.messageStorage = new MessageStorage(
            path.join(__dirname, 'message-ids.json')
        );
        this.webhookClient = new WebhookClient(this.messageStorage);
        this.embedBuilder = new EmbedBuilder();
        this.serverFetcher = new ServerFetcher(this.config);

        this.lastPlayerCount = null;
        this.lastNotificationTime = null;
        this.isRunning = false;

        this.messageStorage.loadMessageIds();
        this.webhookClient.setLastMessageIds(
            this.messageStorage.getLastMessageIds()
        );
    }

    async sendErrorNotification(error) {
        const embed = this.embedBuilder.createErrorEmbed(
            error,
            this.serverFetcher.getConsecutiveErrors()
        );

        await this.webhookClient.sendDiscordNotification(
            this.config.webhookUrls,
            embed
        );

        console.log('Error notification sent to Discord');
    }

    async processServerData(serverData) {
        const playerCount = serverData.numHumans || 0;
        const maxPlayers = serverData.maxClients || 24;
        const capacityPercent = Math.round((playerCount / maxPlayers) * 100);

        console.log(
            `Server status: ${playerCount}/${maxPlayers} players (${capacityPercent}%)`
        );

        const embed = this.embedBuilder.createServerEmbed(serverData);

        const success = await this.webhookClient.sendDiscordNotification(
            this.config.webhookUrls,
            embed
        );

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
            const serverData = await this.serverFetcher.fetchServerInfo();
            await this.processServerData(serverData);
        } catch (error) {
            console.error(`Server check failed: ${error.message}`);
            if (this.serverFetcher.getConsecutiveErrors() >= 3) {
                await this.sendErrorNotification(error);
            }
        } finally {
            this.isRunning = false;
        }
    }

    start() {
        console.log('Starting...');

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
            `Tracker started with schedule: ${this.config.pollInterval}`
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
}

const tracker = new AlpacaTracker();
tracker.start();

export default AlpacaTracker;
