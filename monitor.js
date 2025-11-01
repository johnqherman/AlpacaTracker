#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config();

const axios = require('axios');
const cron = require('node-cron');

/**
 * TF2 Server Monitor Discord Bot
 * Monitors TF2 server status and sends Discord notifications
 */
class TF2ServerMonitor {
    constructor() {
        // Environment configuration
        this.config = {
            serverApiUrl: process.env.SERVER_API_URL || 'https://api.raccoonlagoon.com/v1/server-info?ip=104.153.104.12:27015&g=tf2',
            discordWebhookUrls: this.parseWebhookUrls(),
            pollInterval: process.env.POLL_INTERVAL || '*/3 * * * *',
            maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
            retryDelay: parseInt(process.env.RETRY_DELAY) || 30000, // 30 seconds
        };

        // Validation
        if (!this.config.discordWebhookUrls || this.config.discordWebhookUrls.length === 0) {
            this.log('ERROR', 'At least one Discord webhook URL is required (DISCORD_WEBHOOK_URL or DISCORD_WEBHOOK_URLS)');
            process.exit(1);
        }

        // State tracking
        this.lastPlayerCount = null;
        this.lastNotificationTime = null;
        this.consecutiveErrors = 0;
        this.isRunning = false;
        this.lastMessageIds = new Map(); // Track last Discord message IDs for each webhook

        this.log('INFO', 'TF2 Server Monitor initialized');
        this.log('INFO', `Poll interval: ${this.config.pollInterval}`);
        this.log('INFO', `Server API: ${this.config.serverApiUrl}`);
        this.log('INFO', `Discord webhooks: ${this.config.discordWebhookUrls.length} configured`);
    }

    /**
     * Parse webhook URLs from environment variables
     * Supports both single URL (DISCORD_WEBHOOK_URL) and multiple URLs (DISCORD_WEBHOOK_URLS)
     */
    parseWebhookUrls() {
        const urls = [];

        // Check for single webhook URL (backward compatibility)
        if (process.env.DISCORD_WEBHOOK_URL) {
            urls.push(process.env.DISCORD_WEBHOOK_URL.trim());
        }

        // Check for multiple webhook URLs (comma-separated)
        if (process.env.DISCORD_WEBHOOK_URLS) {
            const multipleUrls = process.env.DISCORD_WEBHOOK_URLS
                .split(',')
                .map(url => url.trim())
                .filter(url => url.length > 0);
            urls.push(...multipleUrls);
        }

        // Remove duplicates
        return [...new Set(urls)];
    }

    /**
     * Logging utility with timestamps
     */
    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level}] ${message}`;

        if (level === 'ERROR') {
            console.error(logMessage, data || '');
        } else {
            console.log(logMessage, data || '');
        }
    }

    /**
     * Fetch server information from API with retry logic
     */
    async fetchServerInfo(retryCount = 0) {
        try {
            this.log('DEBUG', `Fetching server info (attempt ${retryCount + 1}/${this.config.maxRetries + 1})`);

            const response = await axios.get(this.config.serverApiUrl, {
                timeout: 15000, // 15 second timeout
                headers: {
                    'User-Agent': 'TF2-Server-Monitor-Bot/1.0'
                }
            });

            if (response.status !== 200) {
                throw new Error(`API returned status ${response.status}`);
            }

            this.consecutiveErrors = 0;
            return response.data;
        } catch (error) {
            this.log('ERROR', `Failed to fetch server info: ${error.message}`);

            if (retryCount < this.config.maxRetries) {
                this.log('INFO', `Retrying in ${this.config.retryDelay / 1000} seconds...`);
                await this.sleep(this.config.retryDelay);
                return this.fetchServerInfo(retryCount + 1);
            }

            this.consecutiveErrors++;
            if (this.consecutiveErrors >= 3) {
                await this.sendErrorNotification(error);
            }

            throw error;
        }
    }

    /**
     * Send Discord notification to a single webhook (edit if possible, otherwise post new)
     */
    async sendToSingleWebhook(webhookUrl, embed) {
        try {
            const payload = {
                embeds: [embed]
            };

            let response;
            const lastMessageId = this.lastMessageIds.get(webhookUrl);

            // Try to edit existing message first
            if (lastMessageId) {
                try {
                    const editUrl = `${webhookUrl}/messages/${lastMessageId}`;
                    response = await axios.patch(editUrl, payload, {
                        timeout: 10000,
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    this.log('DEBUG', `Discord message updated successfully for webhook: ${this.maskWebhookUrl(webhookUrl)}`);
                    return true;
                } catch (editError) {
                    this.log('DEBUG', `Failed to edit message (${editError.message}), posting new message for webhook: ${this.maskWebhookUrl(webhookUrl)}`);
                    // Fall through to post new message
                    this.lastMessageIds.delete(webhookUrl);
                }
            }

            // Post new message if edit failed or no previous message
            response = await axios.post(webhookUrl + '?wait=true', payload, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            // Store message ID for future edits
            if (response.data && response.data.id) {
                this.lastMessageIds.set(webhookUrl, response.data.id);
                this.log('DEBUG', `Stored message ID for webhook: ${this.maskWebhookUrl(webhookUrl)}`);
            }

            return true;
        } catch (error) {
            this.log('ERROR', `Failed to send Discord notification to ${this.maskWebhookUrl(webhookUrl)}: ${error.message}`);
            return false;
        }
    }

    /**
     * Send Discord notification to all configured webhooks
     */
    async sendDiscordNotification(embed) {
        const results = await Promise.allSettled(
            this.config.discordWebhookUrls.map(webhookUrl =>
                this.sendToSingleWebhook(webhookUrl, embed)
            )
        );

        const successCount = results.filter(result =>
            result.status === 'fulfilled' && result.value === true
        ).length;

        const totalCount = this.config.discordWebhookUrls.length;

        if (successCount > 0) {
            this.log('INFO', `Discord notifications sent successfully to ${successCount}/${totalCount} webhooks`);
            return true;
        } else {
            this.log('ERROR', `Failed to send Discord notifications to all ${totalCount} webhooks`);
            return false;
        }
    }

    /**
     * Mask webhook URL for logging (security)
     */
    maskWebhookUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            if (pathParts.length >= 5) {
                // Mask the webhook ID and token
                pathParts[4] = pathParts[4].substring(0, 4) + '***';
                pathParts[5] = '***';
                urlObj.pathname = pathParts.join('/');
            }
            return urlObj.toString();
        } catch {
            return 'invalid-webhook-url';
        }
    }

    /**
     * Create rich embed for server status
     */
    createServerEmbed(serverData) {
        const playerCount = serverData.numHumans || 0;
        const maxPlayers = serverData.maxClients || 24;
        const serverName = serverData.serverName || 'TF2 Server';
        const serverIP = serverData.serverIP || 'Unknown';
        const map = serverData.currentMap || 'Unknown';
        const botCount = serverData.numBots || 0;
        const totalClients = serverData.numClients || 0;

        // Calculate capacity percentage based on human players
        const capacityPercent = Math.round((playerCount / maxPlayers) * 100);

        // Use consistent orange color
        const color = 0xf8ab27;

        // Create progress bar visualization
        const progressBarLength = 40;
        const filledBars = Math.round((playerCount / maxPlayers) * progressBarLength);
        const emptyBars = progressBarLength - filledBars;
        const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);

        // Calculate next refresh time based on poll interval
        const nextRefreshTime = this.getNextRefreshTimestamp();

        const embed = {
            title: '',
            color: color,
            fields: [
                                                {
                                        name: '',
                                        value: `${progressBar}`,
                                        inline: false
                                },
                {
                    name: 'Online Players',
                    value: `**${playerCount}/${maxPlayers}** (${capacityPercent}%) - Refreshing <t:${nextRefreshTime}:R>\n[Join Now](https://raccoonlagoon.com/connect/${serverIP})`,
                    inline: false
                },

            ],
            timestamp: new Date().toISOString(),
            footer: {
                text: `api.raccoonlagoon.com`,
                icon_url: `https://raw.githubusercontent.com/JohnQHerman/fast-dl/main/images/raccoon_lagoon.png`
            }
        };

        // Add bot information if there are bots
        if (botCount > 0) {
            embed.fields.push({
                name: 'Bots',
                value: `${botCount} bot${botCount !== 1 ? 's' : ''} online`,
                inline: true
            });
        }

        // Add player list if available and server has players
        if (serverData.humanData && Array.isArray(serverData.humanData) && serverData.humanData.length > 0) {
            // Filter out players without names (still connecting) and sort by score
            const namedPlayers = serverData.humanData.filter(player =>
                player.name && player.name.trim() !== ''
            );

            const connectingCount = serverData.humanData.length - namedPlayers.length;

            if (namedPlayers.length > 0) {
                // Sort players by score (descending), with special handling for 0-point players
                const sortedPlayers = namedPlayers
                    .sort((a, b) => {
                        const scoreA = a.score || 0;
                        const scoreB = b.score || 0;
                        const timeA = a.time || 0;
                        const timeB = b.time || 0;

                        // Primary sort: higher score wins
                        if (scoreB !== scoreA) {
                            return scoreB - scoreA;
                        }

                        // Special case: if both players have 0 points, higher time wins (more dedication)
                        if (scoreA === 0 && scoreB === 0) {
                            return timeB - timeA;
                        }

                        // Tiebreaker for non-zero scores: lower time wins (more efficient player)
                        return timeA - timeB;
                    });

                // Create three separate columns: Names, Scores, Times
                const names = sortedPlayers.map(player => player.name).join('\n');
                const scores = sortedPlayers.map(player => `${player.score || 0}`).join('\n');
                const times = sortedPlayers.map(player => this.formatTime(player.time || 0)).join('\n');

                // Add the three table columns as inline fields
                embed.fields.push(
                    {
                        name: 'Name',
                        value: names,
                        inline: true
                    },
                    {
                        name: 'Score',
                        value: scores,
                        inline: true
                    },
                    {
                        name: 'Time Played',
                        value: times,
                        inline: true
                    },
                );

                // Add connecting players info if any (full width field)
                if (connectingCount > 0) {
                    embed.fields.push({
                        name: '\u200b', // Invisible character for spacing
                        value: `🔄 ${connectingCount} player${connectingCount !== 1 ? 's' : ''} connecting...`,
                        inline: false
                    });
                }
            } else if (connectingCount > 0) {
                // Only connecting players, no named players yet
                embed.fields.push({
                    name: '🎯 Players Online',
                    value: `🔄 ${connectingCount} player${connectingCount !== 1 ? 's' : ''} connecting...`,
                    inline: false
                });
            }
        }

        return embed;
    }

    /**
     * Create error notification embed
     */
    createErrorEmbed(error) {
        return {
            title: '⚠️ Error',
            description: `Failed to fetch server information after ${this.consecutiveErrors} consecutive attempts.`,
            color: 0xff0000, // Red
            fields: [
                {
                    name: '❌ Error Details',
                    value: error.message.substring(0, 1000), // Truncate long error messages
                    inline: false
                },
                {
                    name: '🔄 Status',
                    value: 'Monitoring will continue automatically',
                    inline: false
                }
            ],
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Send error notification to Discord
     */
    async sendErrorNotification(error) {
        const errorEmbed = this.createErrorEmbed(error);
        await this.sendDiscordNotification(errorEmbed);
        this.log('INFO', 'Error notification sent to Discord');
    }

    /**
     * Process server data and determine if notification should be sent
     */
    async processServerData(serverData) {
        const playerCount = serverData.numHumans || 0;
        const maxPlayers = serverData.maxClients || 24;
        const capacityPercent = Math.round((playerCount / maxPlayers) * 100);
        const botCount = serverData.numBots || 0;

        this.log('INFO', `Server status: ${playerCount}/${maxPlayers} players (${capacityPercent}%)${botCount > 0 ? `, ${botCount} bots` : ''}`);

        // Always send embed regardless of player count
        const embed = this.createServerEmbed(serverData);
        const success = await this.sendDiscordNotification(embed);
        
        if (success) {
            this.lastNotificationTime = Date.now();
            this.log('DEBUG', `Embed sent: ${playerCount === 0 ? 'Server empty' : `${playerCount} players online`}`);
        }

        this.lastPlayerCount = playerCount;
    }

    /**
     * Determine if a periodic update should be sent (every hour when players are online)
     */
    shouldSendPeriodicUpdate() {
        if (!this.lastNotificationTime) return true;

        const oneHour = 60 * 60 * 1000;
        return (Date.now() - this.lastNotificationTime) > oneHour;
    }

    /**
     * Main monitoring function
     */
    async checkServer() {
        if (this.isRunning) {
            this.log('DEBUG', 'Previous check still running, skipping...');
            return;
        }

        this.isRunning = true;

        try {
            this.log('DEBUG', 'Starting server check...');
            const serverData = await this.fetchServerInfo();
            await this.processServerData(serverData);
        } catch (error) {
            this.log('ERROR', `Server check failed: ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Start the monitoring service
     */
    start() {
        this.log('INFO', 'Starting TF2 Server Monitor...');

        // Schedule the monitoring task
        const task = cron.schedule(this.config.pollInterval, () => {
            this.checkServer();
        }, {
            scheduled: false,
            timezone: 'UTC'
        });

        // Start the cron job
        task.start();
        this.log('INFO', `Monitor started with schedule: ${this.config.pollInterval}`);

        // Run an initial check
        setTimeout(() => {
            this.checkServer();
        }, 5000); // Wait 5 seconds before first check

        // Graceful shutdown handling
        process.on('SIGINT', () => {
            this.log('INFO', 'Shutting down gracefully...');
            task.stop();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            this.log('INFO', 'Shutting down gracefully...');
            task.stop();
            process.exit(0);
        });
    }

    /**
     * Calculate next refresh timestamp based on poll interval
     */
    getNextRefreshTimestamp() {
        // Parse the cron expression to get interval in minutes
        const cronParts = this.config.pollInterval.split(' ');
        
        // Default to 3 minutes if parsing fails
        let intervalMinutes = 3;
        
        // Check if it's a simple */X format for minutes
        if (cronParts[0].startsWith('*/')) {
            intervalMinutes = parseInt(cronParts[0].substring(2)) || 3;
        }
        
        // Calculate next refresh time (1 second shorter than the actual interval)
        const now = new Date();
        const nextRefresh = new Date(now.getTime() + (intervalMinutes * 60 * 1000));
        
        // Return Unix timestamp
        return Math.floor(nextRefresh.getTime() / 1000);
    }

    /**
     * Format time in seconds to readable format (1h 2m 3s)
     */
    formatTime(seconds) {
        if (!seconds || seconds === 0) return '0s';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);

        return parts.join(' ');
    }

    /**
     * Utility function for delays
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize and start the monitor if this file is run directly
if (require.main === module) {
    const monitor = new TF2ServerMonitor();
    monitor.start();
}

module.exports = TF2ServerMonitor;
