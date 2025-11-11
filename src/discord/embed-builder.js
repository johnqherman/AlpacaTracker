class EmbedBuilder {
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

    getNextRefreshTimestamp(pollInterval) {
        const cronParts = pollInterval.split(' ');
        const intervalMinutes = cronParts[0].startsWith('*/')
            ? parseInt(cronParts[0].substring(2)) || 3
            : 3;

        return Math.floor((Date.now() + intervalMinutes * 60 * 1000) / 1000);
    }

    createServerEmbed(serverData, pollInterval) {
        const playerCount = serverData.numHumans || 0;
        const maxPlayers = serverData.maxClients || 24;
        const serverIP = serverData.serverIP || 'Unknown';
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
                    value: `**${playerCount}/${maxPlayers}** (${capacityPercent}%) - Refreshing <t:${this.getNextRefreshTimestamp(pollInterval)}:R>\n[Join Now](https://raccoonlagoon.com/connect/${serverIP})`,
                    inline: false
                }
            ],
            timestamp: new Date().toISOString(),
            footer: {
                text: 'api.raccoonlagoon.com',
                icon_url:
                    'https://static.raccoonlagoon.com/images/raccoon_lagoon.png'
            }
        };

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

    createErrorEmbed(error, consecutiveErrors) {
        return {
            title: '⚠️ Error',
            description: `Failed to fetch server information after ${consecutiveErrors} consecutive attempts.`,
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
}

export default EmbedBuilder;
