import fs from 'fs';

class MessageStorage {
    constructor(filePath) {
        this.messageIdsFile = filePath;
        this.lastMessageIds = new Map();
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

    getLastMessageIds() {
        return this.lastMessageIds;
    }

    setMessageId(webhookUrl, messageId) {
        this.lastMessageIds.set(webhookUrl, messageId);
        this.saveMessageIds();
    }

    deleteMessageId(webhookUrl) {
        this.lastMessageIds.delete(webhookUrl);
        this.saveMessageIds();
    }
}

export default MessageStorage;
