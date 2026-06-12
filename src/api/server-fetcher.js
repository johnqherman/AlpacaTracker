import axios from 'axios';
import { sleep } from '../utils/utils.js';

class ServerFetcher {
    constructor(config) {
        this.apiUrl = config.apiUrl;
        this.maxRetries = config.maxRetries;
        this.retryDelay = config.retryDelay;
        this.consecutiveErrors = 0;
        this.firstErrorAt = null;
        this.lastSuccessAt = null;
    }

    async fetchServerInfo(retryCount = 0) {
        try {
            console.log(
                `Fetching server info (attempt ${retryCount + 1}/${this.maxRetries + 1})`
            );

            const { data } = await axios.get(this.apiUrl, {
                timeout: 15 * 1000,
                headers: { 'User-Agent': 'AlpacaTracker/1.0' }
            });

            this.consecutiveErrors = 0;
            this.firstErrorAt = null;
            this.lastSuccessAt = Date.now();
            return data;
        } catch (error) {
            console.error(`Failed to fetch server info: ${error.message}`);

            if (retryCount < this.maxRetries) {
                console.log(`Retrying in ${this.retryDelay / 1000}s...`);
                await sleep(this.retryDelay);
                return this.fetchServerInfo(retryCount + 1);
            }

            this.consecutiveErrors++;
            if (!this.firstErrorAt) this.firstErrorAt = Date.now();
            throw error;
        }
    }

    getConsecutiveErrors() {
        return this.consecutiveErrors;
    }

    getDownSince() {
        return this.firstErrorAt;
    }

    getLastSuccessAt() {
        return this.lastSuccessAt;
    }
}

export default ServerFetcher;
