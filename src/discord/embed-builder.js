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

    getNextRefreshTimestamp() {
        return Math.floor((Date.now() + 60 * 1000) / 1000);
    }

    createServerEmbed(serverData) {
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
                    value: `**${playerCount}/${maxPlayers}** (${capacityPercent}%) - Refreshing <t:${this.getNextRefreshTimestamp()}:R>\n[Join Now](https://raccoonlagoon.com/connect/${serverIP})`,
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

    formatDowntime(seconds) {
        if (seconds < 60) return 'less than a minute';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        const parts = [];
        if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
        if (minutes > 0)
            parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

        return new Intl.ListFormat('en', {
            style: 'long',
            type: 'conjunction'
        }).format(parts);
    }

    createErrorEmbed(downSince, lastSuccessAt) {
        const downtimeSeconds = Math.floor((Date.now() - downSince) / 1000);

        const embed = {
            title: '🔴 Server Down',
            description: `The server has been down for **${this.formatDowntime(downtimeSeconds)}**.`,
            color: 0xff0000,
            fields: [],
            timestamp: new Date().toISOString()
        };

        if (lastSuccessAt) {
            embed.fields.push({
                name: 'Last Seen',
                value: `<t:${Math.floor(lastSuccessAt / 1000)}:R>`,
                inline: false
            });
        }

        return embed;
    }
}

export default EmbedBuilder;
